use std::sync::Arc;

use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{Store, Table};

use crate::domain::{AuthClaims, IssuedTokens, RefreshRecord, TokenIssuer, TokenKind, User};

pub struct JwtIssuer {
    encoding: EncodingKey,
    decoding: DecodingKey,
    access_ttl: Duration,
    refresh_ttl: Duration,
    store: Arc<Store>,
}

impl JwtIssuer {
    pub fn new(
        secret: &[u8],
        access_ttl_secs: u64,
        refresh_ttl_secs: u64,
        store: Arc<Store>,
    ) -> Self {
        Self {
            encoding: EncodingKey::from_secret(secret),
            decoding: DecodingKey::from_secret(secret),
            access_ttl: Duration::seconds(access_ttl_secs as i64),
            refresh_ttl: Duration::seconds(refresh_ttl_secs as i64),
            store,
        }
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
            exp: (now + ttl).timestamp() as usize,
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
        decode::<AuthClaims>(token, &self.decoding, &validation)
            .map(|data| data.claims)
            .map_err(|_| CoreError::Forbidden("invalid or expired token".into()))
    }
}

impl TokenIssuer for JwtIssuer {
    fn issue(&self, user: &User) -> CoreResult<IssuedTokens> {
        let (access_token, _) = self.issue_one(user, TokenKind::Access)?;
        let (refresh_token, refresh_claims) = self.issue_one(user, TokenKind::Refresh)?;
        let record = RefreshRecord {
            user_id: user.id,
            expires_at: Utc::now() + self.refresh_ttl,
            revoked: false,
        };
        self.store
            .put(
                Table::RefreshTokens,
                &refresh_claims.jti.to_string(),
                &record,
            )
            .map_err(|e| CoreError::Crypto(e.to_string()))?;
        Ok(IssuedTokens {
            access_token,
            refresh_token,
            access_expires_in: self.access_ttl.num_seconds().max(0) as u64,
        })
    }

    fn verify_access(&self, token: &str) -> CoreResult<AuthClaims> {
        let claims = self.decode_claims(token)?;
        if claims.kind != TokenKind::Access {
            return Err(CoreError::Forbidden("expected an access token".into()));
        }
        Ok(claims)
    }

    fn verify_refresh(&self, token: &str) -> CoreResult<AuthClaims> {
        let claims = self.decode_claims(token)?;
        if claims.kind != TokenKind::Refresh {
            return Err(CoreError::Forbidden("expected a refresh token".into()));
        }
        let record: Option<RefreshRecord> = self
            .store
            .get(Table::RefreshTokens, &claims.jti.to_string())
            .map_err(|e| CoreError::Crypto(e.to_string()))?;
        match record {
            Some(record) if !record.revoked && record.expires_at > Utc::now() => Ok(claims),
            _ => Err(CoreError::Forbidden("refresh token is revoked".into())),
        }
    }

    fn revoke(&self, token: &str) -> CoreResult<()> {
        let Ok(claims) = self.decode_claims(token) else {
            return Ok(());
        };
        let key = claims.jti.to_string();
        let record: Option<RefreshRecord> = self
            .store
            .get(Table::RefreshTokens, &key)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;
        if let Some(mut record) = record {
            record.revoked = true;
            self.store
                .put(Table::RefreshTokens, &key, &record)
                .map_err(|e| CoreError::Crypto(e.to_string()))?;
        }
        Ok(())
    }
}
