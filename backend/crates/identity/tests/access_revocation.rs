//! Revocation of already issued access tokens.
//!
//! Access tokens are stateless, so logout-all, password changes and account
//! blocks have to rely on the per-user access epoch: a token whose `iat` is
//! older than the epoch is rejected by `authenticate`.

use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use uuid::Uuid;

use awg_identity::domain::{AuthClaims, TokenKind};
use awg_identity::{
    Argon2Hasher, CaptureMailer, IdentityService, JwtIssuer, NewUser,
    RedbEmailVerificationRepository, RedbUserRepository, Role, SessionMetadata, User, UserChanges,
};
use awg_shared::crypto::Sealer;
use awg_storage::Store;

const SECRET: &[u8] = b"test-secret-with-at-least-32-bytes!!";
const ISSUER: &str = "awg-admin";
const AUDIENCE: &str = "awg-admin";

fn sealer() -> Arc<Sealer> {
    let key = STANDARD.encode([9u8; 32]);
    Arc::new(Sealer::from_master_key(&key).unwrap())
}

fn service() -> (IdentityService, Arc<Store>) {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let users = Arc::new(RedbUserRepository::new(store.clone()));
    let hasher = Arc::new(Argon2Hasher::default());
    let tokens = Arc::new(JwtIssuer::new(
        SECRET,
        900,
        86_400,
        ISSUER,
        AUDIENCE,
        store.clone(),
    ));
    let verifications = Arc::new(RedbEmailVerificationRepository::new(store.clone()));
    let mailer = Arc::new(CaptureMailer::new());
    let service = IdentityService::new(
        users,
        hasher,
        tokens,
        verifications,
        mailer,
        sealer(),
        "https://panel.test".into(),
    );
    (service, store)
}

fn metadata() -> SessionMetadata {
    SessionMetadata {
        user_agent: Some("test-agent".into()),
        ip: Some("203.0.113.9".into()),
    }
}

fn create_user(service: &IdentityService, local: &str) -> User {
    service
        .create(NewUser {
            email: format!("{local}@example.com"),
            full_name: None,
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap()
}

/// Mints an access token with an explicit `iat`, so a test can simulate a
/// token that was issued before a revocation without sleeping for a second.
fn mint_access(user_id: Uuid, iat: i64) -> String {
    let now = Utc::now();
    let claims = AuthClaims {
        sub: user_id,
        role: Role::User,
        iss: ISSUER.into(),
        aud: AUDIENCE.into(),
        exp: (now + Duration::minutes(15)).timestamp() as usize,
        nbf: (now - Duration::seconds(1)).timestamp() as usize,
        iat: iat as usize,
        jti: Uuid::new_v4(),
        kind: TokenKind::Access,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(SECRET),
    )
    .unwrap()
}

fn before_now() -> i64 {
    Utc::now().timestamp() - 60
}

#[test]
fn logout_all_revokes_access_tokens_issued_before_it() {
    let (service, _store) = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let user = create_user(&service, "user");
    let session = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    let old_access = mint_access(user.id, before_now());
    assert!(
        service.authenticate(&old_access).is_ok(),
        "the token is valid before the revocation"
    );

    service.logout_all(user.id).unwrap();

    let error = service.authenticate(&old_access).unwrap_err();
    assert!(
        error.to_string().contains("session revoked"),
        "expected a revocation error, got {error}"
    );
    assert!(
        service
            .refresh(&session.refresh_token, &metadata())
            .is_err(),
        "refresh tokens of every session are revoked as well"
    );

    let fresh = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();
    assert!(
        service.authenticate(&fresh.access_token).is_ok(),
        "a token issued after the revocation keeps working"
    );
}

#[test]
fn password_change_revokes_access_tokens_issued_before_it() {
    let (service, _store) = service();
    let user = create_user(&service, "user");
    service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    let old_access = mint_access(user.id, before_now());
    assert!(service.authenticate(&old_access).is_ok());

    service
        .change_password(user.id, "password123", None, "newpassword123")
        .unwrap();

    let error = service.authenticate(&old_access).unwrap_err();
    assert!(
        error.to_string().contains("session revoked"),
        "expected a revocation error, got {error}"
    );

    let fresh = service
        .login("user@example.com", "newpassword123", &metadata())
        .unwrap();
    assert!(service.authenticate(&fresh.access_token).is_ok());
}

#[test]
fn password_reset_revokes_access_tokens_issued_before_it() {
    let (service, _store) = service();
    let user = create_user(&service, "user");
    service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    let old_access = mint_access(user.id, before_now());
    assert!(service.authenticate(&old_access).is_ok());

    service
        .reset_password_for_user(user.id, "newpassword123")
        .unwrap();

    let error = service.authenticate(&old_access).unwrap_err();
    assert!(error.to_string().contains("session revoked"), "got {error}");

    let fresh = service
        .login("user@example.com", "newpassword123", &metadata())
        .unwrap();
    assert!(service.authenticate(&fresh.access_token).is_ok());
}

#[test]
fn disabling_a_user_revokes_pre_block_access_tokens_even_after_unblock() {
    let (service, _store) = service();
    let user = create_user(&service, "user");
    service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    let old_access = mint_access(user.id, before_now());
    assert!(service.authenticate(&old_access).is_ok());

    service
        .update(
            user.id,
            UserChanges {
                email: None,
                full_name: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(true),
            },
        )
        .unwrap();
    assert!(
        service.authenticate(&old_access).is_err(),
        "a disabled user cannot authenticate"
    );

    service
        .update(
            user.id,
            UserChanges {
                email: None,
                full_name: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(false),
            },
        )
        .unwrap();

    let error = service.authenticate(&old_access).unwrap_err();
    assert!(
        error.to_string().contains("session revoked"),
        "the epoch keeps the pre-block token dead after unblocking, got {error}"
    );

    let fresh = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();
    assert!(service.authenticate(&fresh.access_token).is_ok());
}

#[test]
fn the_epoch_boundary_is_strict() {
    let (service, store) = service();
    let user = create_user(&service, "user");
    let epoch = Utc::now().timestamp();
    awg_storage::access_epoch::set(&store, user.id, epoch).unwrap();

    let same_second = mint_access(user.id, epoch);
    assert!(
        service.authenticate(&same_second).is_ok(),
        "a token issued in the epoch second stays valid"
    );

    let previous_second = mint_access(user.id, epoch - 1);
    let error = service.authenticate(&previous_second).unwrap_err();
    assert!(error.to_string().contains("session revoked"), "got {error}");
}

#[test]
fn revoking_one_session_keeps_its_access_token_valid() {
    let (service, _store) = service();
    let user = create_user(&service, "user");
    let session = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    let jti = service.sessions(user.id).unwrap()[0].jti;
    service.revoke_session(user.id, jti).unwrap();

    assert!(
        service.authenticate(&session.access_token).is_ok(),
        "single-session revocation does not bump the per-user epoch"
    );
}
