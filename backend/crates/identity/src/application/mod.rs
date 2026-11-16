use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    IssuedTokens, PasswordHasher, RefreshSession, Role, SessionMetadata, TokenIssuer, User,
    UserRepository, validate_login, validate_password,
};

#[derive(Debug, Clone)]
pub struct NewUser {
    pub login: String,
    pub password: String,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct UserChanges {
    pub role: Option<Role>,
    pub tariff_id: Option<Option<Uuid>>,
    pub group_id: Option<Option<Uuid>>,
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
}

impl IdentityService {
    pub fn new(
        users: Arc<dyn UserRepository>,
        hasher: Arc<dyn PasswordHasher>,
        tokens: Arc<dyn TokenIssuer>,
    ) -> Self {
        Self {
            users,
            hasher,
            tokens,
        }
    }

    pub fn seed_admin(&self, login: &str, password: &str) -> CoreResult<Option<User>> {
        if self.users.count()? > 0 {
            return Ok(None);
        }
        let user = self.create(NewUser {
            login: login.to_string(),
            password: password.to_string(),
            role: Role::Admin,
            tariff_id: None,
            group_id: None,
        })?;
        Ok(Some(user))
    }

    pub fn login(
        &self,
        login: &str,
        password: &str,
        metadata: &SessionMetadata,
    ) -> CoreResult<AuthSession> {
        let user = self
            .users
            .find_by_login(login.trim())?
            .ok_or_else(|| CoreError::Forbidden("invalid login or password".into()))?;
        user.ensure_active()?;
        if !self.hasher.verify(password, &user.password_hash)? {
            return Err(CoreError::Forbidden("invalid login or password".into()));
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

    pub fn list(&self) -> CoreResult<Vec<User>> {
        self.users.list()
    }

    pub fn create(&self, input: NewUser) -> CoreResult<User> {
        validate_login(&input.login)?;
        validate_password(&input.password)?;
        if self.users.find_by_login(input.login.trim())?.is_some() {
            return Err(CoreError::Conflict("login is already taken".into()));
        }
        let now = Utc::now();
        let user = User {
            id: Uuid::new_v4(),
            login: input.login.trim().to_string(),
            password_hash: self.hasher.hash(&input.password)?,
            role: input.role,
            tariff_id: input.tariff_id,
            group_id: input.group_id,
            disabled: false,
            created_at: now,
            updated_at: now,
        };
        self.users.save(&user)?;
        Ok(user)
    }

    pub fn update(&self, id: Uuid, changes: UserChanges) -> CoreResult<User> {
        let mut user = self.find(id)?;
        if let Some(role) = changes.role {
            user.role = role;
        }
        if let Some(tariff_id) = changes.tariff_id {
            user.tariff_id = tariff_id;
        }
        if let Some(group_id) = changes.group_id {
            user.group_id = group_id;
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

    pub fn change_password(
        &self,
        user_id: Uuid,
        current: Option<&str>,
        new_password: &str,
    ) -> CoreResult<()> {
        validate_password(new_password)?;
        let mut user = self.find(user_id)?;
        if let Some(current) = current
            && !self.hasher.verify(current, &user.password_hash)?
        {
            return Err(CoreError::Forbidden("current password is wrong".into()));
        }
        user.password_hash = self.hasher.hash(new_password)?;
        user.updated_at = Utc::now();
        self.users.save(&user)?;
        self.tokens.revoke_all(user.id)?;
        Ok(())
    }

    pub fn reset_password(&self, user_id: Uuid, new_password: &str) -> CoreResult<()> {
        self.change_password(user_id, None, new_password)
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
