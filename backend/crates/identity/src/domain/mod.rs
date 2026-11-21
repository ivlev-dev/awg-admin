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
pub const CODE_ACCOUNT_DISABLED: &str = "account_disabled";
pub const CODE_INVALID_TOKEN: &str = "invalid_token";

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

    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::User => "user",
        }
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

impl UserStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            UserStatus::PendingEmail => "pending_email",
            UserStatus::PendingApproval => "pending_approval",
            UserStatus::Active => "active",
            UserStatus::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(default)]
    pub full_name: Option<String>,
    pub password_hash: String,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    #[serde(default)]
    pub node_id: Option<Uuid>,
    pub disabled: bool,
    #[serde(default)]
    pub status: UserStatus,
    #[serde(default)]
    pub totp_secret_sealed: Option<String>,
    #[serde(default)]
    pub totp_enabled: bool,
    #[serde(default)]
    pub recovery_codes: Vec<String>,
    #[serde(default)]
    pub totp_pending_secret_sealed: Option<String>,
    #[serde(default)]
    pub totp_pending_recovery_codes: Vec<String>,
    #[serde(default)]
    pub last_totp_step: Option<u64>,
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
            return Err(CoreError::Forbidden(CODE_ACCOUNT_DISABLED.into()));
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

pub const MIN_PASSWORD_LEN: usize = 10;
pub const MAX_PASSWORD_LEN: usize = 1024;

/// Passwords that are common enough to be guessed in the first few attempts.
/// The development seed password (`admin12345`) is deliberately absent: it is
/// rejected separately in production by the admin password check.
const COMMON_PASSWORDS: &[&str] = &[
    "password",
    "password1",
    "qwerty123",
    "1234567890",
    "letmein123",
];

pub fn validate_password(password: &str) -> CoreResult<()> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(CoreError::Invalid(format!(
            "password is too weak: at least {MIN_PASSWORD_LEN} characters required"
        )));
    }
    if password.len() > MAX_PASSWORD_LEN {
        return Err(CoreError::Invalid(format!(
            "password is too weak: at most {MAX_PASSWORD_LEN} bytes allowed"
        )));
    }
    let lowered = password.to_ascii_lowercase();
    if COMMON_PASSWORDS.contains(&lowered.as_str()) {
        return Err(CoreError::Invalid(
            "password is too weak: it is one of the most common passwords".into(),
        ));
    }
    Ok(())
}

/// Validates a password in the context of its account email. Besides the
/// standalone policy, a password must not repeat the email local part: it is
/// public knowledge and would make credential stuffing trivial.
pub fn validate_password_for_email(password: &str, email: &str) -> CoreResult<()> {
    validate_password(password)?;
    let local = email.split('@').next().unwrap_or_default().trim();
    if !local.is_empty() && password.eq_ignore_ascii_case(local) {
        return Err(CoreError::Invalid(
            "password is too weak: it must differ from the email local part".into(),
        ));
    }
    Ok(())
}

pub const MAX_FULL_NAME_LEN: usize = 200;

pub fn normalize_full_name(raw: &str) -> CoreResult<String> {
    let full_name = raw.trim();
    let len = full_name.chars().count();
    if len == 0 || len > MAX_FULL_NAME_LEN {
        return Err(CoreError::Invalid(format!(
            "full_name must be 1..{MAX_FULL_NAME_LEN} characters"
        )));
    }
    Ok(full_name.to_string())
}

pub fn normalize_optional_full_name(raw: Option<String>) -> CoreResult<Option<String>> {
    raw.map(|value| normalize_full_name(&value)).transpose()
}

pub fn normalize_email(raw: &str) -> CoreResult<String> {
    let email = raw.trim().to_ascii_lowercase();
    if email.len() < 3 || email.len() > 254 {
        return Err(CoreError::Invalid("email is invalid".into()));
    }
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || local.is_empty()
        || domain.is_empty()
        || !is_valid_domain(domain)
        || email.chars().any(|c| c.is_whitespace())
    {
        return Err(CoreError::Invalid("email is invalid".into()));
    }
    Ok(email)
}

fn is_valid_domain(domain: &str) -> bool {
    if domain.starts_with('.') || domain.ends_with('.') || domain.contains("..") {
        return false;
    }
    if domain.contains('.') {
        return true;
    }
    !domain.starts_with('-')
        && !domain.ends_with('-')
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub type MailerFuture<'a> = Pin<Box<dyn Future<Output = CoreResult<()>> + Send + 'a>>;

pub trait Mailer: Send + Sync {
    fn send_verification<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a>;

    fn send_verification_with_app<'a>(
        &'a self,
        email: &'a str,
        link: &'a str,
        app_link: Option<&'a str>,
    ) -> MailerFuture<'a> {
        let _ = app_link;
        self.send_verification(email, link)
    }

    fn send_password_reset<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VerificationKind {
    #[default]
    VerifyEmail,
    ResetPassword,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailVerification {
    pub user_id: Uuid,
    pub email: String,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
    #[serde(default)]
    pub kind: VerificationKind,
}

pub trait EmailVerificationRepository: Send + Sync {
    fn find(&self, token_hash: &str) -> CoreResult<Option<EmailVerification>>;
    fn save(&self, token_hash: &str, verification: &EmailVerification) -> CoreResult<()>;
    fn list(&self) -> CoreResult<Vec<(String, EmailVerification)>>;
    fn delete(&self, token_hash: &str) -> CoreResult<()>;
}

pub trait UserRepository: Send + Sync {
    fn find_by_id(&self, id: Uuid) -> CoreResult<Option<User>>;
    fn find_by_email(&self, email: &str) -> CoreResult<Option<User>>;
    fn list(&self) -> CoreResult<Vec<User>>;
    fn save(&self, user: &User) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
    fn count(&self) -> CoreResult<usize>;

    /// Returns the unix second at which access tokens of `user_id` were last
    /// invalidated, if any.
    fn access_epoch(&self, user_id: Uuid) -> CoreResult<Option<i64>>;

    /// Records a new access-token revocation epoch for `user_id`.
    fn set_access_epoch(&self, user_id: Uuid, epoch_secs: i64) -> CoreResult<()>;

    fn page(&self, query: &UserPageQuery) -> CoreResult<UserPage> {
        let mut matched: Vec<User> = self
            .list()?
            .into_iter()
            .filter(|user| query.matches(user))
            .collect();
        matched.sort_by(|left, right| {
            left.email
                .to_lowercase()
                .cmp(&right.email.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        let total = matched.len();
        let items = matched
            .into_iter()
            .skip(query.offset)
            .take(query.limit)
            .collect();
        Ok(UserPage {
            items,
            total,
            limit: query.limit,
            offset: query.offset,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UserPageTab {
    All,
    #[default]
    Active,
    Pending,
}

impl UserPageTab {
    pub fn matches(self, status: UserStatus) -> bool {
        match self {
            UserPageTab::All => true,
            UserPageTab::Active => status != UserStatus::PendingApproval,
            UserPageTab::Pending => status == UserStatus::PendingApproval,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct UserPageQuery {
    pub limit: usize,
    pub offset: usize,
    pub q: Option<String>,
    pub role: Option<Role>,
    pub disabled: Option<bool>,
    pub tab: UserPageTab,
}

impl UserPageQuery {
    pub fn normalize_q(q: Option<&str>) -> Option<String> {
        q.map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase)
    }

    pub fn matches(&self, user: &User) -> bool {
        if let Some(role) = self.role
            && user.role != role
        {
            return false;
        }
        if let Some(disabled) = self.disabled
            && user.disabled != disabled
        {
            return false;
        }
        if !self.tab.matches(user.status) {
            return false;
        }
        if let Some(q) = self.q.as_deref() {
            let email = user.email.to_lowercase();
            let full_name = user.full_name.as_deref().unwrap_or_default().to_lowercase();
            if !email.contains(q) && !full_name.contains(q) {
                return false;
            }
        }
        true
    }
}

#[derive(Debug, Clone)]
pub struct UserPage {
    pub items: Vec<User>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
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
            "email": "admin@local",
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
        assert_eq!(user.email, "admin@local");
        assert!(user.full_name.is_none());
        assert!(!user.totp_enabled);
        assert!(user.totp_secret_sealed.is_none());
        assert!(user.recovery_codes.is_empty());
        assert!(user.ensure_active().is_ok());
    }

    #[test]
    fn users_without_email_are_rejected() {
        let raw = r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "login": "admin",
            "password_hash": "hash",
            "role": "admin",
            "created_at": "2026-01-02T03:04:05Z",
            "updated_at": "2026-01-02T03:04:05Z"
        }"#;
        assert!(serde_json::from_str::<User>(raw).is_err());
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
        assert!(
            user.ensure_active()
                .unwrap_err()
                .to_string()
                .contains(CODE_ACCOUNT_DISABLED)
        );
    }

    #[test]
    fn legacy_verifications_default_to_email_verification() {
        let raw = r#"{
            "user_id": "00000000-0000-0000-0000-000000000001",
            "email": "user@example.com",
            "expires_at": "2026-01-02T03:04:05Z",
            "used": false
        }"#;
        let verification: EmailVerification = serde_json::from_str(raw).unwrap();
        assert_eq!(verification.kind, VerificationKind::VerifyEmail);
    }

    #[test]
    fn verification_kinds_round_trip_as_snake_case() {
        let reset = serde_json::to_string(&VerificationKind::ResetPassword).unwrap();
        assert_eq!(reset, "\"reset_password\"");
        let parsed: VerificationKind = serde_json::from_str("\"verify_email\"").unwrap();
        assert_eq!(parsed, VerificationKind::VerifyEmail);
    }

    #[test]
    fn validates_password_strength() {
        for weak in ["short", "123456789", "password", "Password1", "Qwerty123"] {
            let error = validate_password(weak).unwrap_err().to_string();
            assert!(error.contains("password is too weak"), "{weak}: {error}");
        }
        assert!(validate_password("correct-horse-42").is_ok());
        assert!(
            validate_password("admin12345").is_ok(),
            "the development seed password must stay usable"
        );
        assert!(validate_password("a".repeat(MAX_PASSWORD_LEN).as_str()).is_ok());
        assert!(validate_password("a".repeat(MAX_PASSWORD_LEN + 1).as_str()).is_err());
    }

    #[test]
    fn rejects_a_password_matching_the_email_local_part() {
        for (password, email) in [
            ("alice.smith", "alice.smith@example.com"),
            ("AliceSmith", "alicesmith@example.com"),
        ] {
            let error = validate_password_for_email(password, email)
                .unwrap_err()
                .to_string();
            assert!(error.contains("password is too weak"), "{error}");
            assert!(error.contains("email local part"), "{error}");
        }
        assert!(validate_password_for_email("correct-horse-42", "alice@example.com").is_ok());
    }

    #[test]
    fn normalizes_and_validates_emails() {
        assert_eq!(
            normalize_email("  User.Name@Example.COM ").unwrap(),
            "user.name@example.com"
        );
        assert_eq!(normalize_email("Admin@Local").unwrap(), "admin@local");
        for invalid in [
            "",
            "no-at",
            "@example.com",
            "user@",
            "user@.local",
            "a b@example.com",
        ] {
            assert!(normalize_email(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn validates_full_names() {
        assert_eq!(
            normalize_full_name("  Иван Петров  ").unwrap(),
            "Иван Петров"
        );
        assert!(normalize_full_name("").is_err());
        assert!(normalize_full_name("   ").is_err());
        assert!(normalize_full_name(&"a".repeat(MAX_FULL_NAME_LEN)).is_ok());
        assert!(normalize_full_name(&"a".repeat(MAX_FULL_NAME_LEN + 1)).is_err());
        assert_eq!(normalize_optional_full_name(None).unwrap(), None::<String>);
        assert_eq!(
            normalize_optional_full_name(Some(" Ann ".into())).unwrap(),
            Some("Ann".to_string())
        );
    }
}
