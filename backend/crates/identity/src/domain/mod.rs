use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

pub const CODE_TOTP_REQUIRED: &str = "totp_required";
pub const CODE_TOTP_INVALID: &str = "totp_invalid";
pub const CODE_EMAIL_NOT_VERIFIED: &str = "email_not_verified";
pub const CODE_PENDING_APPROVAL: &str = "pending_approval";
pub const CODE_REJECTED: &str = "rejected";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UserStatus {
    PendingEmail,
    PendingApproval,
    #[default]
    Active,
    Rejected,
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
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub status: UserStatus,
    #[serde(default)]
    pub totp_secret_sealed: Option<String>,
    #[serde(default)]
    pub totp_enabled: bool,
    #[serde(default)]
    pub recovery_codes: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub fn ensure_active(&self) -> CoreResult<()> {
        match self.status {
            UserStatus::PendingEmail => {
                return Err(CoreError::Forbidden(CODE_EMAIL_NOT_VERIFIED.into()));
            }
            UserStatus::PendingApproval => {
                return Err(CoreError::Forbidden(CODE_PENDING_APPROVAL.into()));
            }
            UserStatus::Rejected => {
                return Err(CoreError::Forbidden(CODE_REJECTED.into()));
            }
            UserStatus::Active => {}
        }
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

pub fn normalize_email(raw: &str) -> CoreResult<String> {
    let email = raw.trim().to_ascii_lowercase();
    if email.len() < 5 || email.len() > 254 {
        return Err(CoreError::Invalid("email is invalid".into()));
    }
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || email.chars().any(|c| c.is_whitespace())
    {
        return Err(CoreError::Invalid("email is invalid".into()));
    }
    Ok(email)
}

pub type MailerFuture<'a> = Pin<Box<dyn Future<Output = CoreResult<()>> + Send + 'a>>;

pub trait Mailer: Send + Sync {
    fn send_verification<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailVerification {
    pub user_id: Uuid,
    pub email: String,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
}

pub trait EmailVerificationRepository: Send + Sync {
    fn find(&self, token_hash: &str) -> CoreResult<Option<EmailVerification>>;
    fn save(&self, token_hash: &str, verification: &EmailVerification) -> CoreResult<()>;
}

pub trait UserRepository: Send + Sync {
    fn find_by_id(&self, id: Uuid) -> CoreResult<Option<User>>;
    fn find_by_login(&self, login: &str) -> CoreResult<Option<User>>;
    fn find_by_email(&self, email: &str) -> CoreResult<Option<User>>;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_user_json() -> &'static str {
        r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "login": "admin",
            "password_hash": "hash",
            "role": "admin",
            "tariff_id": null,
            "group_id": null,
            "disabled": false,
            "created_at": "2026-01-02T03:04:05Z",
            "updated_at": "2026-01-02T03:04:05Z"
        }"#
    }

    #[test]
    fn legacy_users_default_to_active_without_totp() {
        let user: User = serde_json::from_str(legacy_user_json()).unwrap();
        assert_eq!(user.status, UserStatus::Active);
        assert!(user.email.is_none());
        assert!(!user.totp_enabled);
        assert!(user.totp_secret_sealed.is_none());
        assert!(user.recovery_codes.is_empty());
        assert!(user.ensure_active().is_ok());
    }

    #[test]
    fn ensure_active_rejects_non_active_statuses() {
        let mut user: User = serde_json::from_str(legacy_user_json()).unwrap();
        user.status = UserStatus::PendingEmail;
        assert!(
            user.ensure_active()
                .unwrap_err()
                .to_string()
                .contains(CODE_EMAIL_NOT_VERIFIED)
        );
        user.status = UserStatus::PendingApproval;
        assert!(
            user.ensure_active()
                .unwrap_err()
                .to_string()
                .contains(CODE_PENDING_APPROVAL)
        );
        user.status = UserStatus::Rejected;
        assert!(
            user.ensure_active()
                .unwrap_err()
                .to_string()
                .contains(CODE_REJECTED)
        );
        user.status = UserStatus::Active;
        user.disabled = true;
        assert!(user.ensure_active().is_err());
    }

    #[test]
    fn normalizes_and_validates_emails() {
        assert_eq!(
            normalize_email("  User.Name@Example.COM ").unwrap(),
            "user.name@example.com"
        );
        for invalid in [
            "",
            "no-at",
            "@example.com",
            "user@",
            "user@localhost",
            "a b@example.com",
        ] {
            assert!(normalize_email(invalid).is_err(), "{invalid}");
        }
    }
}
