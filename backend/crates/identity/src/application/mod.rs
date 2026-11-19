use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use awg_shared::crypto::Sealer;
use awg_shared::{CoreError, CoreResult};
use sha2::{Digest, Sha256};
use totp_rs::{Algorithm, Builder, Secret, Totp};

use crate::domain::{
    CODE_INVALID_TOKEN, CODE_TOTP_INVALID, CODE_TOTP_REQUIRED, EmailVerification,
    EmailVerificationRepository, IssuedTokens, Mailer, PasswordHasher, RefreshSession, Role,
    SessionMetadata, TokenIssuer, User, UserPage, UserPageQuery, UserRepository, UserStatus,
    VerificationKind, normalize_email, normalize_optional_full_name, validate_password,
};
const VERIFICATION_TTL_HOURS: i64 = 24;
const PASSWORD_RESET_TTL_HOURS: i64 = 1;
const RECOVERY_CODE_COUNT: usize = 8;
const TOTP_ISSUER: &str = "awg-admin";
const MAX_EMAIL_LEN: usize = 254;
const MAX_PASSWORD_LEN: usize = 1024;

#[derive(Debug, Clone)]
pub struct NewUser {
    pub email: String,
    pub full_name: Option<String>,
    pub password: String,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub node_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct RegisterInput {
    pub email: String,
    pub full_name: Option<String>,
    pub password: String,
}

#[derive(Debug, Clone)]
pub struct TotpSetup {
    pub secret: String,
    pub otpauth_url: String,
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct UserChanges {
    pub email: Option<String>,
    pub full_name: Option<Option<String>>,
    pub role: Option<Role>,
    pub tariff_id: Option<Option<Uuid>>,
    pub group_id: Option<Option<Uuid>>,
    pub node_id: Option<Option<Uuid>>,
    pub disabled: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AuthSession {
    pub user: User,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct AuthPrincipal {
    pub user_id: Uuid,
    pub role: Role,
}

impl AuthPrincipal {
    pub fn is_admin(self) -> bool {
        self.role.is_admin()
    }

    pub fn require_admin(self) -> CoreResult<()> {
        if self.is_admin() {
            Ok(())
        } else {
            Err(CoreError::Forbidden("admin role required".into()))
        }
    }
}

pub struct IdentityService {
    users: Arc<dyn UserRepository>,
    hasher: Arc<dyn PasswordHasher>,
    tokens: Arc<dyn TokenIssuer>,
    verifications: Arc<dyn EmailVerificationRepository>,
    mailer: Arc<dyn Mailer>,
    sealer: Arc<Sealer>,
    public_url: String,
    app_verify_url: Option<String>,
}

impl IdentityService {
    pub fn new(
        users: Arc<dyn UserRepository>,
        hasher: Arc<dyn PasswordHasher>,
        tokens: Arc<dyn TokenIssuer>,
        verifications: Arc<dyn EmailVerificationRepository>,
        mailer: Arc<dyn Mailer>,
        sealer: Arc<Sealer>,
        public_url: String,
    ) -> Self {
        Self {
            users,
            hasher,
            tokens,
            verifications,
            mailer,
            sealer,
            public_url,
            app_verify_url: None,
        }
    }

    pub fn with_app_verify_url(mut self, url: impl Into<String>) -> Self {
        let url = url.into();
        let url = url.trim();
        if !url.is_empty() {
            self.app_verify_url = Some(url.to_string());
        }
        self
    }

    pub fn seed_admin(&self, email: &str, password: &str) -> CoreResult<Option<User>> {
        if self.users.count()? > 0 {
            return Ok(None);
        }
        let email = normalize_email(email)?;
        let user = self.create(NewUser {
            email,
            full_name: None,
            password: password.to_string(),
            role: Role::Admin,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })?;
        Ok(Some(user))
    }

    pub fn login(
        &self,
        email: &str,
        password: &str,
        metadata: &SessionMetadata,
    ) -> CoreResult<AuthSession> {
        self.login_with_totp(email, password, None, metadata)
    }

    pub fn login_with_totp(
        &self,
        email: &str,
        password: &str,
        totp_code: Option<&str>,
        metadata: &SessionMetadata,
    ) -> CoreResult<AuthSession> {
        let email = email.trim();
        if email.len() > MAX_EMAIL_LEN || password.len() > MAX_PASSWORD_LEN {
            return Err(CoreError::Forbidden("invalid email or password".into()));
        }
        let Ok(email) = normalize_email(email) else {
            return Err(CoreError::Forbidden("invalid email or password".into()));
        };
        let user = self
            .users
            .find_by_email(&email)?
            .ok_or_else(|| CoreError::Forbidden("invalid email or password".into()))?;
        user.ensure_active()?;
        if !self.hasher.verify(password, &user.password_hash)? {
            return Err(CoreError::Forbidden("invalid email or password".into()));
        }
        let mut user = user;
        if user.totp_enabled {
            let code = totp_code
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .ok_or_else(|| CoreError::Forbidden(CODE_TOTP_REQUIRED.into()))?;
            if !self.consume_auth_code(&mut user, code)? {
                return Err(CoreError::Forbidden(CODE_TOTP_INVALID.into()));
            }
        }
        self.session_for(user, metadata)
    }

    pub fn refresh(
        &self,
        refresh_token: &str,
        metadata: &SessionMetadata,
    ) -> CoreResult<AuthSession> {
        let claims = self.tokens.inspect_refresh(refresh_token)?;
        let user = self
            .users
            .find_by_id(claims.sub)?
            .ok_or_else(|| CoreError::Forbidden("user no longer exists".into()))?;
        user.ensure_active()?;
        let IssuedTokens {
            access_token,
            refresh_token,
            access_expires_in,
            ..
        } = self.tokens.rotate(refresh_token, &user, metadata)?;
        Ok(AuthSession {
            user,
            access_token,
            refresh_token,
            expires_in: access_expires_in,
        })
    }

    pub fn logout(&self, refresh_token: &str) -> CoreResult<()> {
        self.tokens.revoke(refresh_token)
    }

    pub fn sessions(&self, user_id: Uuid) -> CoreResult<Vec<RefreshSession>> {
        self.tokens.list_sessions(user_id)
    }

    pub fn revoke_session(&self, user_id: Uuid, jti: Uuid) -> CoreResult<()> {
        self.tokens.revoke_session(user_id, jti)
    }

    pub fn logout_all(&self, user_id: Uuid) -> CoreResult<usize> {
        self.tokens.revoke_all(user_id)
    }

    pub fn authenticate(&self, access_token: &str) -> CoreResult<AuthPrincipal> {
        let claims = self.tokens.verify_access(access_token)?;
        let user = self
            .users
            .find_by_id(claims.sub)?
            .ok_or_else(|| CoreError::Forbidden("user no longer exists".into()))?;
        user.ensure_active()?;
        Ok(AuthPrincipal {
            user_id: user.id,
            role: user.role,
        })
    }

    pub fn find(&self, id: Uuid) -> CoreResult<User> {
        self.users
            .find_by_id(id)?
            .ok_or_else(|| CoreError::NotFound("user".into()))
    }

    pub fn find_by_email(&self, email: &str) -> CoreResult<Option<User>> {
        self.users.find_by_email(email)
    }

    pub fn list(&self) -> CoreResult<Vec<User>> {
        self.users.list()
    }

    pub fn page(&self, query: &UserPageQuery) -> CoreResult<UserPage> {
        self.users.page(query)
    }

    pub fn create(&self, input: NewUser) -> CoreResult<User> {
        let email = normalize_email(&input.email)?;
        let full_name = normalize_optional_full_name(input.full_name)?;
        validate_password(&input.password)?;
        if self.users.find_by_email(&email)?.is_some() {
            return Err(CoreError::Conflict("email is already registered".into()));
        }
        let now = Utc::now();
        let user = User {
            id: Uuid::new_v4(),
            email,
            full_name,
            password_hash: self.hasher.hash(&input.password)?,
            role: input.role,
            tariff_id: input.tariff_id,
            group_id: input.group_id,
            node_id: input.node_id,
            disabled: false,
            status: UserStatus::Active,
            totp_secret_sealed: None,
            totp_enabled: false,
            recovery_codes: Vec::new(),
            totp_pending_secret_sealed: None,
            totp_pending_recovery_codes: Vec::new(),
            last_totp_step: None,
            created_at: now,
            updated_at: now,
        };
        self.users.save(&user)?;
        Ok(user)
    }

    pub async fn register(&self, input: RegisterInput) -> CoreResult<User> {
        let users = self.users.clone();
        let hasher = self.hasher.clone();
        let (user, email) =
            tokio::task::spawn_blocking(move || register_user(users, hasher, input))
                .await
                .map_err(join_error)??;
        self.issue_verification(&user, &email).await;
        Ok(user)
    }

    pub fn verify_email(&self, token: &str) -> CoreResult<User> {
        let token = token.trim();
        if token.is_empty() {
            return Err(CoreError::Invalid(
                "verification token is invalid or expired".into(),
            ));
        }
        let key = hash_token(token);
        let mut verification = self
            .verifications
            .find(&key)?
            .filter(|verification| verification.kind == VerificationKind::VerifyEmail)
            .ok_or_else(|| CoreError::Invalid("verification token is invalid or expired".into()))?;
        if verification.used {
            return Err(CoreError::Invalid(
                "verification token was already used".into(),
            ));
        }
        if verification.expires_at <= Utc::now() {
            return Err(CoreError::Invalid("verification token is expired".into()));
        }
        verification.used = true;
        self.verifications.save(&key, &verification)?;

        let mut user = self
            .users
            .find_by_id(verification.user_id)?
            .ok_or_else(|| CoreError::NotFound("user".into()))?;
        if user.status == UserStatus::PendingEmail {
            user.status = UserStatus::PendingApproval;
            user.updated_at = Utc::now();
            self.users.save(&user)?;
        }
        Ok(user)
    }

    pub async fn resend_verification(&self, email: &str) {
        let Ok(email) = normalize_email(email) else {
            return;
        };
        let Ok(Some(user)) = self.users.find_by_email(&email) else {
            return;
        };
        if user.status != UserStatus::PendingEmail {
            return;
        }
        self.issue_verification(&user, &email).await;
    }

    pub async fn request_password_reset(&self, email: &str) -> CoreResult<()> {
        let Ok(email) = normalize_email(email) else {
            return Ok(());
        };
        let Ok(Some(user)) = self.users.find_by_email(&email) else {
            return Ok(());
        };
        if user.ensure_active().is_err() {
            return Ok(());
        }
        let token = generate_token();
        let key = hash_token(&token);
        let verification = EmailVerification {
            user_id: user.id,
            email: email.clone(),
            expires_at: Utc::now() + Duration::hours(PASSWORD_RESET_TTL_HOURS),
            used: false,
            kind: VerificationKind::ResetPassword,
        };
        if let Err(error) = self.verifications.save(&key, &verification) {
            tracing::warn!(%error, "failed to store password reset token");
            return Ok(());
        }
        let link = format!(
            "{}/reset-password?token={}",
            self.public_url.trim_end_matches('/'),
            token
        );
        if let Err(error) = self.mailer.send_password_reset(&email, &link).await {
            tracing::warn!(%error, "failed to send password reset email");
        }
        Ok(())
    }

    pub fn reset_password(&self, token: &str, new_password: &str) -> CoreResult<()> {
        validate_password(new_password)?;
        let token = token.trim();
        if token.is_empty() {
            return Err(CoreError::Invalid(CODE_INVALID_TOKEN.into()));
        }
        let key = hash_token(token);
        let Some(mut verification) = self
            .verifications
            .find(&key)?
            .filter(|verification| verification.kind == VerificationKind::ResetPassword)
        else {
            return Err(CoreError::Invalid(CODE_INVALID_TOKEN.into()));
        };
        if verification.used || verification.expires_at <= Utc::now() {
            return Err(CoreError::Invalid(CODE_INVALID_TOKEN.into()));
        }
        let mut user = self
            .users
            .find_by_id(verification.user_id)?
            .ok_or_else(|| CoreError::Invalid(CODE_INVALID_TOKEN.into()))?;
        user.ensure_active()?;
        user.password_hash = self.hasher.hash(new_password)?;
        user.updated_at = Utc::now();
        verification.used = true;
        self.verifications.save(&key, &verification)?;
        self.users.save(&user)?;
        self.tokens.revoke_all(user.id)?;
        Ok(())
    }

    pub fn pending_users(&self) -> CoreResult<Vec<User>> {
        let mut users: Vec<User> = self
            .users
            .list()?
            .into_iter()
            .filter(|user| user.status == UserStatus::PendingApproval)
            .collect();
        users.sort_by_key(|user| user.created_at);
        Ok(users)
    }

    pub fn approve_user(
        &self,
        id: Uuid,
        tariff_id: Uuid,
        node_id: Option<Uuid>,
    ) -> CoreResult<User> {
        let mut user = self.find(id)?;
        if user.status != UserStatus::PendingApproval {
            return Err(CoreError::Invalid("user is not awaiting approval".into()));
        }
        user.status = UserStatus::Active;
        user.tariff_id = Some(tariff_id);
        user.group_id = None;
        user.node_id = node_id;
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        Ok(user)
    }

    pub fn reject_user(&self, id: Uuid) -> CoreResult<User> {
        let mut user = self.find(id)?;
        if !matches!(
            user.status,
            UserStatus::PendingEmail | UserStatus::PendingApproval
        ) {
            return Err(CoreError::Invalid("user is not pending".into()));
        }
        user.status = UserStatus::Rejected;
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        self.tokens.revoke_all(user.id)?;
        Ok(user)
    }

    /// Generates a new TOTP secret. When 2FA is already enabled the caller
    /// must prove ownership of the account with the current password and a
    /// valid code; the new secret is staged as *pending* so that a repeated
    /// setup never silently turns 2FA off.
    pub fn setup_totp(
        &self,
        user_id: Uuid,
        password: Option<&str>,
        code: Option<&str>,
    ) -> CoreResult<TotpSetup> {
        let mut user = self.find(user_id)?;
        user.ensure_active()?;
        let enabled = user.totp_enabled;
        if enabled {
            let password_ok = match password.filter(|value| !value.is_empty()) {
                Some(password) => self.hasher.verify(password, &user.password_hash)?,
                None => false,
            };
            if !password_ok {
                return Err(CoreError::Forbidden("current password is wrong".into()));
            }
            let code = code
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| CoreError::Invalid("invalid totp code".into()))?;
            if !self.consume_auth_code(&mut user, code)? {
                return Err(CoreError::Invalid("invalid totp code".into()));
            }
        }
        let (setup, sealed, hashes) = self.generate_totp(&user.email)?;
        if enabled {
            user.totp_pending_secret_sealed = Some(sealed);
            user.totp_pending_recovery_codes = hashes;
        } else {
            user.totp_secret_sealed = Some(sealed);
            user.recovery_codes = hashes;
        }
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        Ok(setup)
    }

    pub fn enable_totp(&self, user_id: Uuid, code: &str) -> CoreResult<()> {
        let mut user = self.find(user_id)?;
        user.ensure_active()?;
        let was_enabled = user.totp_enabled;
        let pending = user.totp_pending_secret_sealed.clone();
        let sealed = pending
            .clone()
            .or_else(|| user.totp_secret_sealed.clone())
            .ok_or_else(|| CoreError::Invalid("totp is not configured".into()))?;
        let step = self
            .verify_totp_step(&user.email, &sealed, code.trim())?
            .ok_or_else(|| CoreError::Invalid("invalid totp code".into()))?;
        if pending.is_none() && !totp_step_is_fresh(&user, step) {
            return Err(CoreError::Invalid("invalid totp code".into()));
        }
        if pending.is_some() {
            user.totp_secret_sealed = Some(sealed);
            user.recovery_codes = std::mem::take(&mut user.totp_pending_recovery_codes);
        }
        user.totp_pending_secret_sealed = None;
        user.totp_pending_recovery_codes.clear();
        user.totp_enabled = true;
        user.last_totp_step = if was_enabled { Some(step) } else { None };
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        Ok(())
    }

    pub fn disable_totp(&self, user_id: Uuid, password: &str, code: &str) -> CoreResult<()> {
        let mut user = self.find(user_id)?;
        user.ensure_active()?;
        if !self.hasher.verify(password, &user.password_hash)? {
            return Err(CoreError::Forbidden("password is wrong".into()));
        }
        if !self.consume_auth_code(&mut user, code.trim())? {
            return Err(CoreError::Invalid("invalid totp code".into()));
        }
        user.totp_secret_sealed = None;
        user.totp_enabled = false;
        user.recovery_codes.clear();
        user.totp_pending_secret_sealed = None;
        user.totp_pending_recovery_codes.clear();
        user.last_totp_step = None;
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        Ok(())
    }

    fn generate_totp(&self, email: &str) -> CoreResult<(TotpSetup, String, Vec<String>)> {
        let secret = Secret::generate();
        let encoded = secret.to_base32();
        let totp = build_totp(email, secret)?;
        let otpauth_url = totp
            .to_url()
            .map_err(|e| CoreError::Crypto(format!("otpauth url failed: {e}")))?;
        let recovery_codes = (0..RECOVERY_CODE_COUNT)
            .map(|_| generate_recovery_code())
            .collect::<Vec<_>>();
        let hashes = recovery_codes
            .iter()
            .map(|code| self.hasher.hash(code))
            .collect::<CoreResult<Vec<_>>>()?;
        let sealed = self.sealer.seal_str(&encoded)?;
        Ok((
            TotpSetup {
                secret: encoded,
                otpauth_url,
                recovery_codes,
            },
            sealed,
            hashes,
        ))
    }

    pub fn prune_email_verifications(&self, now: DateTime<Utc>) -> CoreResult<usize> {
        self.verifications
            .list()?
            .into_iter()
            .filter(|(_, verification)| verification.expires_at <= now)
            .map(|(key, _)| self.verifications.delete(&key))
            .collect::<CoreResult<Vec<()>>>()
            .map(|removed| removed.len())
    }

    async fn issue_verification(&self, user: &User, email: &str) {
        let token = generate_token();
        let key = hash_token(&token);
        let verification = EmailVerification {
            user_id: user.id,
            email: email.to_string(),
            expires_at: Utc::now() + Duration::hours(VERIFICATION_TTL_HOURS),
            used: false,
            kind: VerificationKind::VerifyEmail,
        };
        if let Err(error) = self.verifications.save(&key, &verification) {
            tracing::warn!(%error, "failed to store email verification");
            return;
        }
        let link = format!(
            "{}/verify-email?token={}",
            self.public_url.trim_end_matches('/'),
            token
        );
        let app_link = self
            .app_verify_url
            .as_ref()
            .map(|base| format!("{base}?token={token}"));
        if let Err(error) = self
            .mailer
            .send_verification_with_app(email, &link, app_link.as_deref())
            .await
        {
            tracing::warn!(%error, "failed to send verification email");
        }
    }

    fn consume_auth_code(&self, user: &mut User, code: &str) -> CoreResult<bool> {
        if code.is_empty() {
            return Ok(false);
        }
        if let Some(sealed) = user.totp_secret_sealed.as_deref()
            && let Some(step) = self.verify_totp_step(&user.email, sealed, code)?
        {
            if !totp_step_is_fresh(user, step) {
                return Ok(false);
            }
            user.last_totp_step = Some(step);
            user.updated_at = Utc::now();
            self.users.save(user)?;
            return Ok(true);
        }
        for index in 0..user.recovery_codes.len() {
            if self.hasher.verify(code, &user.recovery_codes[index])? {
                user.recovery_codes.remove(index);
                user.updated_at = Utc::now();
                self.users.save(user)?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn verify_totp_step(&self, email: &str, sealed: &str, code: &str) -> CoreResult<Option<u64>> {
        let encoded = self.sealer.open_str(sealed)?;
        let secret = Secret::try_from_base32(&encoded)
            .map_err(|e| CoreError::Crypto(format!("bad totp secret: {e}")))?;
        let totp = build_totp(email, secret)?;
        Ok(totp.check_current(code))
    }

    pub fn update(&self, id: Uuid, changes: UserChanges) -> CoreResult<User> {
        let mut user = self.find(id)?;
        if let Some(email) = changes.email {
            let email = normalize_email(&email)?;
            if let Some(existing) = self.users.find_by_email(&email)?
                && existing.id != user.id
            {
                return Err(CoreError::Conflict("email is already registered".into()));
            }
            user.email = email;
        }
        if let Some(full_name) = changes.full_name {
            user.full_name = normalize_optional_full_name(full_name)?;
        }
        if let Some(role) = changes.role {
            user.role = role;
        }
        if let Some(tariff_id) = changes.tariff_id {
            user.tariff_id = tariff_id;
        }
        if let Some(group_id) = changes.group_id {
            user.group_id = group_id;
        }
        if let Some(node_id) = changes.node_id {
            user.node_id = node_id;
        }
        if let Some(disabled) = changes.disabled {
            user.disabled = disabled;
        }
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        if user.disabled {
            self.tokens.revoke_all(user.id)?;
        }
        Ok(user)
    }

    /// Changes the password after re-authenticating the caller. The current
    /// password is always required; when TOTP is enabled a valid one-time code
    /// may be supplied instead.
    pub fn change_password(
        &self,
        user_id: Uuid,
        current: &str,
        totp_code: Option<&str>,
        new_password: &str,
    ) -> CoreResult<()> {
        validate_password(new_password)?;
        let mut user = self.find(user_id)?;
        user.ensure_active()?;
        let password_ok =
            !current.is_empty() && self.hasher.verify(current, &user.password_hash)?;
        if !password_ok {
            let code_ok = user.totp_enabled
                && match totp_code.map(str::trim).filter(|value| !value.is_empty()) {
                    Some(code) => self.consume_auth_code(&mut user, code)?,
                    None => false,
                };
            if !code_ok {
                return Err(CoreError::Forbidden("current password is wrong".into()));
            }
        }
        user.password_hash = self.hasher.hash(new_password)?;
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        self.tokens.revoke_all(user.id)?;
        Ok(())
    }

    pub fn reset_password_for_user(&self, user_id: Uuid, new_password: &str) -> CoreResult<()> {
        validate_password(new_password)?;
        let mut user = self.find(user_id)?;
        user.password_hash = self.hasher.hash(new_password)?;
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        self.tokens.revoke_all(user.id)?;
        Ok(())
    }

    pub fn delete(&self, user_id: Uuid) -> CoreResult<()> {
        self.tokens.revoke_all(user_id)?;
        self.users.delete(user_id)
    }

    fn session_for(&self, user: User, metadata: &SessionMetadata) -> CoreResult<AuthSession> {
        let IssuedTokens {
            access_token,
            refresh_token,
            access_expires_in,
            ..
        } = self.tokens.issue(&user, metadata)?;
        Ok(AuthSession {
            user,
            access_token,
            refresh_token,
            expires_in: access_expires_in,
        })
    }
}

fn register_user(
    users: Arc<dyn UserRepository>,
    hasher: Arc<dyn PasswordHasher>,
    input: RegisterInput,
) -> CoreResult<(User, String)> {
    let email = normalize_email(&input.email)?;
    let full_name = normalize_optional_full_name(input.full_name)?;
    validate_password(&input.password)?;
    if users.find_by_email(&email)?.is_some() {
        return Err(CoreError::Conflict("email is already registered".into()));
    }
    let now = Utc::now();
    let user = User {
        id: Uuid::new_v4(),
        email: email.clone(),
        full_name,
        password_hash: hasher.hash(&input.password)?,
        role: Role::User,
        tariff_id: None,
        group_id: None,
        node_id: None,
        disabled: false,
        status: UserStatus::PendingEmail,
        totp_secret_sealed: None,
        totp_enabled: false,
        recovery_codes: Vec::new(),
        totp_pending_secret_sealed: None,
        totp_pending_recovery_codes: Vec::new(),
        last_totp_step: None,
        created_at: now,
        updated_at: now,
    };
    users.save(&user)?;
    Ok((user, email))
}

fn join_error(error: tokio::task::JoinError) -> CoreError {
    CoreError::Io(std::io::Error::other(format!(
        "blocking task failed: {error}"
    )))
}

fn totp_step_is_fresh(user: &User, step: u64) -> bool {
    user.last_totp_step.is_none_or(|last| step > last)
}

fn build_totp(account: &str, secret: Secret) -> CoreResult<Totp> {
    Builder::new()
        .with_secret(secret)
        .with_algorithm(Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_account_name(account)
        .with_issuer(Some(TOTP_ISSUER))
        .build()
        .map_err(|e| CoreError::Crypto(format!("totp setup failed: {e}")))
}

fn generate_token() -> String {
    use base64::Engine;
    use rand::RngCore;

    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_token(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

fn generate_recovery_code() -> String {
    use rand::RngCore;

    let mut bytes = [0u8; 5];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
