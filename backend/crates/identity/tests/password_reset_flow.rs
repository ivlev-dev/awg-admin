use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use awg_identity::{
    Argon2Hasher, CaptureMailer, EmailVerification, IdentityService, JwtIssuer,
    RedbEmailVerificationRepository, RedbUserRepository, RegisterInput, SessionMetadata, User,
    VerificationKind,
};
use awg_shared::crypto::Sealer;
use awg_storage::{Store, Table};

const SECRET: &[u8] = b"test-secret-with-at-least-32-bytes!!";
const MASTER_KEY: [u8; 32] = [9u8; 32];

struct Harness {
    service: IdentityService,
    store: Arc<Store>,
    mailer: Arc<CaptureMailer>,
}

fn harness() -> Harness {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let users = Arc::new(RedbUserRepository::new(store.clone()));
    let hasher = Arc::new(Argon2Hasher::default());
    let tokens = Arc::new(JwtIssuer::new(
        SECRET,
        900,
        86_400,
        "awg-admin",
        "awg-admin",
        store.clone(),
    ));
    let verifications = Arc::new(RedbEmailVerificationRepository::new(store.clone()));
    let mailer = Arc::new(CaptureMailer::new());
    let sealer = Arc::new(Sealer::from_master_key(&STANDARD.encode(MASTER_KEY)).unwrap());
    let service = IdentityService::new(
        users,
        hasher,
        tokens,
        verifications,
        mailer.clone(),
        sealer,
        "https://panel.test".into(),
    );
    Harness {
        service,
        store,
        mailer,
    }
}

fn metadata() -> SessionMetadata {
    SessionMetadata {
        user_agent: Some("test-agent".into()),
        ip: Some("203.0.113.9".into()),
    }
}

fn token_from_link(link: &str) -> String {
    link.split("token=")
        .nth(1)
        .expect("link carries a token")
        .to_string()
}

fn reset_key(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

async fn active_user(harness: &Harness, email: &str) -> User {
    let user = harness
        .service
        .register(RegisterInput {
            email: email.into(),
            full_name: None,
            password: "password123".into(),
        })
        .await
        .unwrap();
    let (_, link) = harness.mailer.last().unwrap();
    harness
        .service
        .verify_email(&token_from_link(&link))
        .unwrap();
    harness
        .service
        .approve_user(user.id, Uuid::new_v4(), None)
        .unwrap()
}

async fn request_reset(harness: &Harness, email: &str) -> String {
    harness.mailer.clear();
    harness.service.request_password_reset(email).await.unwrap();
    let (_, link) = harness.mailer.last().unwrap();
    token_from_link(&link)
}

#[tokio::test]
async fn unknown_email_does_not_leak_or_send_mail() {
    let harness = harness();
    harness
        .service
        .request_password_reset("missing@example.com")
        .await
        .unwrap();
    assert!(harness.mailer.sent().is_empty());

    harness
        .service
        .request_password_reset("not-an-email")
        .await
        .unwrap();
    assert!(harness.mailer.sent().is_empty());
}

#[tokio::test]
async fn active_user_receives_one_hour_reset_link() {
    let harness = harness();
    active_user(&harness, "user@example.com").await;

    harness.mailer.clear();
    harness
        .service
        .request_password_reset(" USER@example.com ")
        .await
        .unwrap();

    let (to, link) = harness.mailer.last().unwrap();
    assert_eq!(to, "user@example.com");
    assert!(link.starts_with("https://panel.test/reset-password?token="));

    let token = token_from_link(&link);
    let record: EmailVerification = harness
        .store
        .get(Table::EmailVerifications, &reset_key(&token))
        .unwrap()
        .unwrap();
    assert_eq!(record.kind, VerificationKind::ResetPassword);
    assert!(!record.used);
    let ttl = record.expires_at - Utc::now();
    assert!(ttl > Duration::minutes(55), "ttl was {ttl}");
    assert!(ttl <= Duration::hours(1), "ttl was {ttl}");
}

#[tokio::test]
async fn pending_user_receives_no_reset_link() {
    let harness = harness();
    harness
        .service
        .register(RegisterInput {
            email: "pending@example.com".into(),
            full_name: None,
            password: "password123".into(),
        })
        .await
        .unwrap();
    harness.mailer.clear();

    harness
        .service
        .request_password_reset("pending@example.com")
        .await
        .unwrap();
    assert!(harness.mailer.sent().is_empty());
}

#[tokio::test]
async fn reset_changes_password_and_revokes_all_sessions() {
    let harness = harness();
    let user = active_user(&harness, "user@example.com").await;
    let session = harness
        .service
        .login("user@example.com", "password123", &metadata())
        .unwrap();
    assert_eq!(harness.service.sessions(user.id).unwrap().len(), 1);

    let token = request_reset(&harness, "user@example.com").await;
    harness
        .service
        .reset_password(&token, "new-password-456")
        .unwrap();

    let sessions = harness.service.sessions(user.id).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions.iter().all(|session| session.revoked));
    let refresh = harness.service.refresh(&session.refresh_token, &metadata());
    assert!(refresh.is_err());

    let old = harness
        .service
        .login("user@example.com", "password123", &metadata())
        .unwrap_err();
    assert!(
        old.to_string().contains("invalid email or password"),
        "{old}"
    );

    let new = harness
        .service
        .login("user@example.com", "new-password-456", &metadata())
        .unwrap();
    assert_eq!(new.user.id, user.id);
}

#[tokio::test]
async fn reset_token_is_single_use() {
    let harness = harness();
    active_user(&harness, "user@example.com").await;
    let token = request_reset(&harness, "user@example.com").await;

    harness
        .service
        .reset_password(&token, "new-password-456")
        .unwrap();
    let reused = harness
        .service
        .reset_password(&token, "another-password-789")
        .unwrap_err();
    assert_eq!(reused.to_string(), "invalid input: invalid_token");
}

#[tokio::test]
async fn expired_and_unknown_reset_tokens_are_rejected() {
    let harness = harness();
    active_user(&harness, "user@example.com").await;
    let token = request_reset(&harness, "user@example.com").await;
    let key = reset_key(&token);
    let mut record: EmailVerification = harness
        .store
        .get(Table::EmailVerifications, &key)
        .unwrap()
        .unwrap();
    record.expires_at = Utc::now() - Duration::minutes(1);
    harness
        .store
        .put(Table::EmailVerifications, &key, &record)
        .unwrap();

    let expired = harness
        .service
        .reset_password(&token, "new-password-456")
        .unwrap_err();
    assert_eq!(expired.to_string(), "invalid input: invalid_token");

    let unknown = harness
        .service
        .reset_password("not-a-token", "new-password-456")
        .unwrap_err();
    assert_eq!(unknown.to_string(), "invalid input: invalid_token");
}

#[tokio::test]
async fn weak_password_is_rejected_with_validation_message() {
    let harness = harness();
    active_user(&harness, "user@example.com").await;
    let token = request_reset(&harness, "user@example.com").await;

    let error = harness.service.reset_password(&token, "short").unwrap_err();
    assert!(
        error
            .to_string()
            .contains("password must be at least 8 characters"),
        "{error}"
    );
    assert!(
        harness
            .service
            .login("user@example.com", "password123", &metadata())
            .is_ok()
    );
}

#[tokio::test]
async fn verification_tokens_cannot_be_used_for_password_reset() {
    let harness = harness();
    harness
        .service
        .register(RegisterInput {
            email: "user@example.com".into(),
            full_name: None,
            password: "password123".into(),
        })
        .await
        .unwrap();
    let (_, verification_link) = harness.mailer.last().unwrap();
    let verification_token = token_from_link(&verification_link);

    let error = harness
        .service
        .reset_password(&verification_token, "new-password-456")
        .unwrap_err();
    assert_eq!(error.to_string(), "invalid input: invalid_token");
}

#[tokio::test]
async fn reset_tokens_cannot_verify_email() {
    let harness = harness();
    active_user(&harness, "user@example.com").await;
    let token = request_reset(&harness, "user@example.com").await;

    let error = harness.service.verify_email(&token).unwrap_err();
    assert!(error.to_string().contains("invalid or expired"), "{error}");
}
