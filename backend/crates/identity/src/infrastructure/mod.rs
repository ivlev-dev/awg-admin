pub mod tokens;

pub use tokens::JwtIssuer;

use std::sync::Arc;

use argon2::Argon2;
use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{PasswordHash, PasswordHasher as _, PasswordVerifier};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::user_index::{self, UserPageEntry};
use awg_storage::{Store, Table};

use crate::domain::{
    EmailVerification, EmailVerificationRepository, PasswordHasher, User, UserPage, UserPageQuery,
    UserRepository,
};

pub struct RedbUserRepository {
    store: Arc<Store>,
}

impl RedbUserRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl UserRepository for RedbUserRepository {
    fn find_by_id(&self, id: Uuid) -> CoreResult<Option<User>> {
        self.store
            .get(Table::Users, &id.to_string())
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn find_by_login(&self, login: &str) -> CoreResult<Option<User>> {
        let users: Vec<User> = self
            .store
            .list(Table::Users)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
        Ok(users
            .into_iter()
            .find(|u| u.login.eq_ignore_ascii_case(login)))
    }

    fn find_by_email(&self, email: &str) -> CoreResult<Option<User>> {
        let wanted = email.trim();
        let users: Vec<User> = self
            .store
            .list(Table::Users)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
        Ok(users.into_iter().find(|u| {
            u.email
                .as_deref()
                .is_some_and(|value| value.trim().eq_ignore_ascii_case(wanted))
        }))
    }

    fn list(&self) -> CoreResult<Vec<User>> {
        self.store
            .list(Table::Users)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn save(&self, user: &User) -> CoreResult<()> {
        let entry = index_entry(user);
        user_index::upsert_user(&self.store, &user.id.to_string(), user, &entry).map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        user_index::delete_user(&self.store, &id.to_string()).map_err(map_err)
    }

    fn count(&self) -> CoreResult<usize> {
        self.store.count(Table::Users).map_err(map_err)
    }

    fn page(&self, query: &UserPageQuery) -> CoreResult<UserPage> {
        let unfiltered = query.role.is_none()
            && query.disabled.is_none()
            && query.tab == crate::domain::UserPageTab::All
            && query.q.is_none();
        let role = query.role.map(crate::domain::Role::as_str);
        let tab = query.tab;
        let (ids, total) = if unfiltered {
            user_index::scan_all(&self.store, query.offset, query.limit).map_err(map_err)?
        } else {
            user_index::scan(&self.store, query.offset, query.limit, |entry| {
                role.is_none_or(|role| entry.role == role)
                    && query
                        .disabled
                        .is_none_or(|disabled| entry.disabled == disabled)
                    && tab.matches(status_from_str(&entry.status))
                    && query.q.as_deref().is_none_or(|q| entry.matches_search(q))
            })
            .map_err(map_err)?
        };
        let keys: Vec<String> = ids.iter().map(ToString::to_string).collect();
        let items: Vec<User> = self.store.get_many(Table::Users, &keys).map_err(map_err)?;
        Ok(UserPage {
            items,
            total,
            limit: query.limit,
            offset: query.offset,
        })
    }
}

fn map_err(error: awg_storage::StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(error.to_string()))
}

fn index_entry(user: &User) -> UserPageEntry {
    UserPageEntry::new(
        user.id,
        user.email.clone(),
        &user.login,
        user.role.as_str(),
        user.status.as_str(),
        user.disabled,
        user.created_at,
    )
}

fn status_from_str(raw: &str) -> crate::domain::UserStatus {
    match raw {
        "pending_email" => crate::domain::UserStatus::PendingEmail,
        "pending_approval" => crate::domain::UserStatus::PendingApproval,
        "rejected" => crate::domain::UserStatus::Rejected,
        _ => crate::domain::UserStatus::Active,
    }
}

#[derive(Default)]
pub struct Argon2Hasher {
    argon: Argon2<'static>,
}

impl PasswordHasher for Argon2Hasher {
    fn hash(&self, password: &str) -> CoreResult<String> {
        let salt = SaltString::generate(&mut OsRng);
        self.argon
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| CoreError::Crypto(format!("password hash failed: {e}")))
    }

    fn verify(&self, password: &str, hash: &str) -> CoreResult<bool> {
        let parsed =
            PasswordHash::new(hash).map_err(|e| CoreError::Crypto(format!("bad hash: {e}")))?;
        Ok(self
            .argon
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    }
}

pub struct RedbEmailVerificationRepository {
    store: Arc<Store>,
}

impl RedbEmailVerificationRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl EmailVerificationRepository for RedbEmailVerificationRepository {
    fn find(&self, token_hash: &str) -> CoreResult<Option<EmailVerification>> {
        self.store
            .get(Table::EmailVerifications, token_hash)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn save(&self, token_hash: &str, verification: &EmailVerification) -> CoreResult<()> {
        self.store
            .put(Table::EmailVerifications, token_hash, verification)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn list(&self) -> CoreResult<Vec<(String, EmailVerification)>> {
        self.store
            .list_prefix(Table::EmailVerifications, "")
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn delete(&self, token_hash: &str) -> CoreResult<()> {
        self.store
            .delete(Table::EmailVerifications, token_hash)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }
}

#[derive(Debug, Clone, Default)]
pub struct CaptureMailer {
    sent: Arc<std::sync::Mutex<Vec<(String, String)>>>,
    app_links: Arc<std::sync::Mutex<Vec<(String, String)>>>,
}

impl CaptureMailer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sent(&self) -> Vec<(String, String)> {
        self.sent
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn last(&self) -> Option<(String, String)> {
        self.sent().pop()
    }

    pub fn sent_app_links(&self) -> Vec<(String, String)> {
        self.app_links
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn clear(&self) {
        self.sent
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        self.app_links
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
}

impl crate::domain::Mailer for CaptureMailer {
    fn send_verification<'a>(
        &'a self,
        email: &'a str,
        link: &'a str,
    ) -> crate::domain::MailerFuture<'a> {
        Box::pin(async move {
            self.sent
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push((email.to_string(), link.to_string()));
            Ok(())
        })
    }

    fn send_verification_with_app<'a>(
        &'a self,
        email: &'a str,
        link: &'a str,
        app_link: Option<&'a str>,
    ) -> crate::domain::MailerFuture<'a> {
        Box::pin(async move {
            self.sent
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push((email.to_string(), link.to_string()));
            if let Some(app_link) = app_link {
                self.app_links
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .push((email.to_string(), app_link.to_string()));
            }
            Ok(())
        })
    }

    fn send_password_reset<'a>(
        &'a self,
        email: &'a str,
        link: &'a str,
    ) -> crate::domain::MailerFuture<'a> {
        Box::pin(async move {
            self.sent
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push((email.to_string(), link.to_string()));
            Ok(())
        })
    }
}
