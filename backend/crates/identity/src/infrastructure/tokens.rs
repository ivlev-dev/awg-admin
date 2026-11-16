use std::sync::{Arc, Mutex};

use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{Store, Table};

use crate::domain::{
    AuthClaims, IssuedTokens, RefreshRecord, RefreshSession, SessionMetadata, TokenIssuer,
    TokenKind, User,
};

const LEEWAY_SECS: u64 = 30;
const MAX_USER_AGENT_LEN: usize = 256;
const MAX_IP_LEN: usize = 64;

pub struct JwtIssuer {
    encoding: EncodingKey,
    decoding: DecodingKey,
    access_ttl: Duration,
    refresh_ttl: Duration,
    issuer: String,
    audience: String,
    store: Arc<Store>,
    rotate_lock: Mutex<()>,
}

impl JwtIssuer {
    pub fn new(
        secret: &[u8],
        access_ttl_secs: u64,
        refresh_ttl_secs: u64,
        issuer: &str,
        audience: &str,
        store: Arc<Store>,
    ) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret),
            decoding: DecodingKey::from_secret(secret),
            access_ttl: Duration::seconds(access_ttl_secs as i64),
            refresh_ttl: Duration::seconds(refresh_ttl_secs as i64),
            issuer: issuer.to_string(),
            audience: audience.to_string(),
            store,
            rotate_lock: Mutex::new(()),
        }
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.rotate_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn issue_one(&self, user: &User, kind: TokenKind) -> CoreResult<(String, AuthClaims)> {
        let now = Utc::now();
        let ttl = match kind {
            TokenKind::Access => self.access_ttl,
            TokenKind::Refresh => self.refresh_ttl,
        };
        let claims = AuthClaims {
            sub: user.id,
            role: user.role,
            iss: self.issuer.clone(),
            aud: self.audience.clone(),
            exp: (now + ttl).timestamp() as usize,
            nbf: now.timestamp() as usize,
            iat: now.timestamp() as usize,
            jti: Uuid::new_v4(),
            kind,
        };
        let token = encode(&Header::new(Algorithm::HS256), &claims, &self.encoding)
            .map_err(|e| CoreError::Crypto(format!("token encode failed: {e}")))?;
        Ok((token, claims))
    }

    fn decode_claims(&self, token: &str) -> CoreResult<AuthClaims> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = true;
        validation.validate_nbf = true;
        validation.leeway = LEEWAY_SECS;
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_audience(&[self.audience.as_str()]);
        decode::<AuthClaims>(token, &self.decoding, &validation)
            .map(|data| data.claims)
            .map_err(|_| CoreError::Forbidden("invalid or expired token".into()))
    }

    fn store_record(
        &self,
        claims: &AuthClaims,
        family_id: Uuid,
        metadata: &SessionMetadata,
    ) -> CoreResult<()> {
        let now = Utc::now();
        let record = RefreshRecord {
            user_id: claims.sub,
            family_id,
            created_at: now,
            expires_at: now + self.refresh_ttl,
            revoked: false,
            used: false,
            user_agent: sanitize(metadata.user_agent.as_deref(), MAX_USER_AGENT_LEN),
            ip: sanitize(metadata.ip.as_deref(), MAX_IP_LEN),
        };
        self.store
            .put(Table::RefreshTokens, &claims.jti.to_string(), &record)
            .map_err(|e| CoreError::Crypto(e.to_string()))
    }

    fn issue_pair(
        &self,
        user: &User,
        family_id: Uuid,
        metadata: &SessionMetadata,
    ) -> CoreResult<IssuedTokens> {
        let (access_token, _) = self.issue_one(user, TokenKind::Access)?;
        let (refresh_token, refresh_claims) = self.issue_one(user, TokenKind::Refresh)?;
        self.store_record(&refresh_claims, family_id, metadata)?;
        Ok(IssuedTokens {
            access_token,
            refresh_token,
            access_expires_in: self.access_ttl.num_seconds().max(0) as u64,
        })
    }

    fn record(&self, jti: Uuid) -> CoreResult<Option<RefreshRecord>> {
        self.store
            .get(Table::RefreshTokens, &jti.to_string())
            .map_err(|e| CoreError::Crypto(e.to_string()))
    }

    fn save_record(&self, jti: Uuid, record: &RefreshRecord) -> CoreResult<()> {
        self.store
            .put(Table::RefreshTokens, &jti.to_string(), record)
            .map_err(|e| CoreError::Crypto(e.to_string()))
    }

    fn revoke_family(&self, family_id: Uuid) -> CoreResult<usize> {
        self.revoke_where(|record| record.family_id == family_id && !record.revoked)
    }

    fn revoke_where(&self, predicate: impl Fn(&RefreshRecord) -> bool) -> CoreResult<usize> {
        let keys = self
            .store
            .keys(Table::RefreshTokens)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;
        let mut revoked = 0;
        for key in keys {
            let Ok(jti) = Uuid::parse_str(&key) else {
                continue;
            };
            let Some(record) = self.record(jti)? else {
                continue;
            };
            if !predicate(&record) {
                continue;
            }
            let mut record = record;
            record.revoked = true;
            self.save_record(jti, &record)?;
            revoked += 1;
        }
        Ok(revoked)
    }
}

impl TokenIssuer for JwtIssuer {
    fn issue(&self, user: &User, metadata: &SessionMetadata) -> CoreResult<IssuedTokens> {
        let _guard = self.guard();
        self.issue_pair(user, Uuid::new_v4(), metadata)
    }

    fn inspect_refresh(&self, token: &str) -> CoreResult<AuthClaims> {
        let claims = self.decode_claims(token)?;
        if claims.kind != TokenKind::Refresh {
            return Err(CoreError::Forbidden("expected a refresh token".into()));
        }
        Ok(claims)
    }

    fn rotate(
        &self,
        token: &str,
        user: &User,
        metadata: &SessionMetadata,
    ) -> CoreResult<IssuedTokens> {
        let claims = self.inspect_refresh(token)?;
        if claims.sub != user.id {
            return Err(CoreError::Forbidden(
                "refresh token subject mismatch".into(),
            ));
        }
        let _guard = self.guard();
        let Some(record) = self.record(claims.jti)? else {
            return Err(CoreError::Forbidden(
                "refresh token is unknown or expired".into(),
            ));
        };
        if record.revoked || record.used {
            self.revoke_family(record.family_id)?;
            return Err(CoreError::Forbidden(
                "refresh token reuse detected; the session family was revoked".into(),
            ));
        }
        if record.expires_at <= Utc::now() {
            return Err(CoreError::Forbidden("refresh token is expired".into()));
        }
        let family_id = record.family_id;
        let mut record = record;
        record.used = true;
        self.save_record(claims.jti, &record)?;
        self.issue_pair(user, family_id, metadata)
    }

    fn verify_access(&self, token: &str) -> CoreResult<AuthClaims> {
        let claims = self.decode_claims(token)?;
        if claims.kind != TokenKind::Access {
            return Err(CoreError::Forbidden("expected an access token".into()));
        }
        Ok(claims)
    }

    fn revoke(&self, token: &str) -> CoreResult<()> {
        let Ok(claims) = self.decode_claims(token) else {
            return Ok(());
        };
        let _guard = self.guard();
        let Some(mut record) = self.record(claims.jti)? else {
            return Ok(());
        };
        record.revoked = true;
        self.save_record(claims.jti, &record)
    }

    fn revoke_session(&self, user_id: Uuid, jti: Uuid) -> CoreResult<()> {
        let _guard = self.guard();
        let Some(mut record) = self.record(jti)? else {
            return Err(CoreError::NotFound("session".into()));
        };
        if record.user_id != user_id {
            return Err(CoreError::NotFound("session".into()));
        }
        record.revoked = true;
        self.save_record(jti, &record)
    }

    fn revoke_all(&self, user_id: Uuid) -> CoreResult<usize> {
        let _guard = self.guard();
        self.revoke_where(|record| record.user_id == user_id && !record.revoked)
    }

    fn list_sessions(&self, user_id: Uuid) -> CoreResult<Vec<RefreshSession>> {
        let now = Utc::now();
        let keys = self
            .store
            .keys(Table::RefreshTokens)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;
        let mut sessions = Vec::new();
        for key in keys {
            let Ok(jti) = Uuid::parse_str(&key) else {
                continue;
            };
            let Some(record) = self.record(jti)? else {
                continue;
            };
            if record.user_id != user_id || record.expires_at <= now {
                continue;
            }
            sessions.push(RefreshSession {
                jti,
                user_id: record.user_id,
                family_id: record.family_id,
                created_at: record.created_at,
                expires_at: record.expires_at,
                revoked: record.revoked,
                used: record.used,
                user_agent: record.user_agent,
                ip: record.ip,
            });
        }
        sessions.sort_by_key(|session| std::cmp::Reverse(session.created_at));
        Ok(sessions)
    }

    fn prune_expired(&self) -> CoreResult<usize> {
        let _guard = self.guard();
        let now = Utc::now();
        let keys = self
            .store
            .keys(Table::RefreshTokens)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;
        let mut removed = 0;
        for key in keys {
            let Ok(jti) = Uuid::parse_str(&key) else {
                continue;
            };
            let Some(record) = self.record(jti)? else {
                continue;
            };
            if record.expires_at <= now {
                self.store
                    .delete(Table::RefreshTokens, &key)
                    .map_err(|e| CoreError::Crypto(e.to_string()))?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

fn sanitize(value: Option<&str>, max_len: usize) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(max_len).collect())
}
