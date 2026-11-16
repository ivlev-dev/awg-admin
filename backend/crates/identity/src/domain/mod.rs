use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Admin,
    User,
}

impl Role {
    pub fn is_admin(self) -> bool {
        matches!(self, Role::Admin)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub login: String,
    pub password_hash: String,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub disabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub fn ensure_active(&self) -> CoreResult<()> {
        if self.disabled {
            return Err(CoreError::Forbidden("user is disabled".into()));
        }
        Ok(())
    }

    pub fn ensure_admin(&self) -> CoreResult<()> {
        self.ensure_active()?;
        if !self.role.is_admin() {
            return Err(CoreError::Forbidden("admin role required".into()));
        }
        Ok(())
    }
}

pub fn validate_login(login: &str) -> CoreResult<()> {
    let login = login.trim();
    if login.len() < 3 || login.len() > 64 {
        return Err(CoreError::Invalid("login must be 3..64 characters".into()));
    }
    if !login
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@'))
    {
        return Err(CoreError::Invalid(
            "login may contain letters, digits, _ - . @".into(),
        ));
    }
    Ok(())
}

pub fn validate_password(password: &str) -> CoreResult<()> {
    if password.chars().count() < 8 {
        return Err(CoreError::Invalid(
            "password must be at least 8 characters".into(),
        ));
    }
    if password.len() > 256 {
        return Err(CoreError::Invalid("password is too long".into()));
    }
    Ok(())
}

pub trait UserRepository: Send + Sync {
    fn find_by_id(&self, id: Uuid) -> CoreResult<Option<User>>;
    fn find_by_login(&self, login: &str) -> CoreResult<Option<User>>;
    fn list(&self) -> CoreResult<Vec<User>>;
    fn save(&self, user: &User) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
    fn count(&self) -> CoreResult<usize>;
}

pub trait PasswordHasher: Send + Sync {
    fn hash(&self, password: &str) -> CoreResult<String>;
    fn verify(&self, password: &str, hash: &str) -> CoreResult<bool>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenKind {
    Access,
    Refresh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthClaims {
    pub sub: Uuid,
    pub role: Role,
    pub iss: String,
    pub aud: String,
    pub exp: usize,
    pub nbf: usize,
    pub iat: usize,
    pub jti: Uuid,
    pub kind: TokenKind,
}

#[derive(Debug, Clone)]
pub struct IssuedTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_in: u64,
}

#[derive(Debug, Clone, Default)]
pub struct SessionMetadata {
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshRecord {
    pub user_id: Uuid,
    #[serde(default = "Uuid::new_v4")]
    pub family_id: Uuid,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    #[serde(default)]
    pub used: bool,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
}

impl RefreshRecord {
    pub fn is_active(&self, now: DateTime<Utc>) -> bool {
        !self.revoked && !self.used && self.expires_at > now
    }
}

#[derive(Debug, Clone)]
pub struct RefreshSession {
    pub jti: Uuid,
    pub user_id: Uuid,
    pub family_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub used: bool,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

pub trait TokenIssuer: Send + Sync {
    fn issue(&self, user: &User, metadata: &SessionMetadata) -> CoreResult<IssuedTokens>;
    fn inspect_refresh(&self, token: &str) -> CoreResult<AuthClaims>;
    fn rotate(
        &self,
        token: &str,
        user: &User,
        metadata: &SessionMetadata,
    ) -> CoreResult<IssuedTokens>;
    fn verify_access(&self, token: &str) -> CoreResult<AuthClaims>;
    fn revoke(&self, token: &str) -> CoreResult<()>;
    fn revoke_session(&self, user_id: Uuid, jti: Uuid) -> CoreResult<()>;
    fn revoke_all(&self, user_id: Uuid) -> CoreResult<usize>;
    fn list_sessions(&self, user_id: Uuid) -> CoreResult<Vec<RefreshSession>>;
    fn prune_expired(&self) -> CoreResult<usize>;
}
