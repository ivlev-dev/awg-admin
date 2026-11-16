pub mod tokens;

pub use tokens::JwtIssuer;

use std::sync::Arc;

use argon2::Argon2;
use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{PasswordHash, PasswordHasher as _, PasswordVerifier};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{Store, Table};

use crate::domain::{PasswordHasher, User, UserRepository};

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

    fn list(&self) -> CoreResult<Vec<User>> {
        self.store
            .list(Table::Users)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn save(&self, user: &User) -> CoreResult<()> {
        self.store
            .put(Table::Users, &user.id.to_string(), user)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.store
            .delete(Table::Users, &id.to_string())
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }

    fn count(&self) -> CoreResult<usize> {
        self.store
            .count(Table::Users)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))
    }
}

pub struct Argon2Hasher {
    argon: Argon2<'static>,
}

impl Default for Argon2Hasher {
    fn default() -> Self {
        Self {
            argon: Argon2::default(),
        }
    }
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
