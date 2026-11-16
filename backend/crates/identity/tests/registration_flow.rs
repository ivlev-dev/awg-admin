use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use totp_rs::{Builder, Secret};
use uuid::Uuid;

use awg_identity::{
    Argon2Hasher, CaptureMailer, EmailVerification, IdentityService, JwtIssuer,
    RedbEmailVerificationRepository, RedbUserRepository, RegisterInput, SessionMetadata,
    UserStatus,
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
        .expect("verification link carries a token")
        .to_string()
}

async fn register(harness: &Harness, email: &str, login: Option<&str>) -> awg_identity::User {
    harness
        .service
        .register(RegisterInput {
            email: email.into(),
            login: login.map(str::to_string),
            password: "password123".into(),
        })
        .await
        .unwrap()
}

async fn active_user(harness: &Harness, email: &str) -> awg_identity::User {
    let user = register(harness, email, None).await;
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

fn totp_code(secret: &str, login: &str) -> String {
    let secret = Secret::try_from_base32(secret).unwrap();
    Builder::new()
        .with_secret(secret)
        .with_account_name(login)
        .with_issuer(Some("awg-admin"))
        .build()
        .unwrap()
        .generate_current()
        .to_string()
}

#[tokio::test]
async fn registration_verification_and_approval_flow() {
    let harness = harness();
    let admin = harness
        .service
        .seed_admin("admin", "password123")
        .unwrap()
        .unwrap();
    let tariff_id = Uuid::new_v4();
    let group_id = Uuid::new_v4();

    let user = register(&harness, " New.User@Example.COM ", None).await;
    assert_eq!(user.status, UserStatus::PendingEmail);
    assert_eq!(user.email.as_deref(), Some("new.user@example.com"));
    assert_eq!(user.login, "new.user");
    assert_eq!(user.role, awg_identity::Role::User);

    let (to, link) = harness.mailer.last().unwrap();
    assert_eq!(to, "new.user@example.com");
    assert!(link.starts_with("https://panel.test/verify-email?token="));

    let error = harness
        .service
        .login("new.user@example.com", "password123", &metadata())
        .unwrap_err();
    assert!(error.to_string().contains("email_not_verified"), "{error}");

    let verified = harness
        .service
        .verify_email(&token_from_link(&link))
        .unwrap();
    assert_eq!(verified.status, UserStatus::PendingApproval);

    let error = harness
        .service
        .login("new.user@example.com", "password123", &metadata())
        .unwrap_err();
    assert!(error.to_string().contains("pending_approval"), "{error}");

    let pending = harness.service.pending_users().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, user.id);
    assert!(pending.iter().all(|item| item.id != admin.id));

    let approved = harness
        .service
        .approve_user(user.id, tariff_id, Some(group_id))
        .unwrap();
    assert_eq!(approved.status, UserStatus::Active);
    assert_eq!(approved.tariff_id, Some(tariff_id));
    assert_eq!(approved.group_id, Some(group_id));

    let by_email = harness
        .service
        .login("NEW.USER@example.com", "password123", &metadata())
        .unwrap();
    assert_eq!(by_email.user.id, user.id);
    let by_login = harness
        .service
        .login("new.user", "password123", &metadata())
        .unwrap();
    assert_eq!(by_login.user.id, user.id);

    let admin_session = harness
        .service
        .login("admin", "password123", &metadata())
        .unwrap();
    assert_eq!(admin_session.user.id, admin.id);
}

#[tokio::test]
async fn register_enforces_unique_email_and_login() {
    let harness = harness();
    let first = register(&harness, "user@one.example", None).await;
    assert_eq!(first.login, "user");

    let second = register(&harness, "user@two.example", None).await;
    assert_eq!(second.login, "user-2");

    let duplicate = harness
        .service
        .register(RegisterInput {
            email: "USER@ONE.example".into(),
            login: None,
            password: "password123".into(),
        })
        .await
        .unwrap_err();
    assert!(
        duplicate
            .to_string()
            .contains("email is already registered")
    );

    let taken_login = harness
        .service
        .register(RegisterInput {
            email: "third@example.com".into(),
            login: Some("USER".into()),
            password: "password123".into(),
        })
        .await
        .unwrap_err();
    assert!(taken_login.to_string().contains("login is already taken"));

    harness
        .service
        .register(RegisterInput {
            email: "fourth@example.com".into(),
            login: Some("MixedCase".into()),
            password: "password123".into(),
        })
        .await
        .unwrap();
    let case_conflict = harness
        .service
        .register(RegisterInput {
            email: "fifth@example.com".into(),
            login: Some("mixedcase".into()),
            password: "password123".into(),
        })
        .await
        .unwrap_err();
    assert!(case_conflict.to_string().contains("login is already taken"));
}

#[tokio::test]
async fn verification_tokens_are_single_use_and_expire() {
    let harness = harness();
    register(&harness, "single@example.com", None).await;
    let (_, link) = harness.mailer.last().unwrap();
    let token = token_from_link(&link);

    harness.service.verify_email(&token).unwrap();
    let reused = harness.service.verify_email(&token).unwrap_err();
    assert!(reused.to_string().contains("already used"), "{reused}");

    register(&harness, "expired@example.com", None).await;
    let (_, link) = harness.mailer.last().unwrap();
    let token = token_from_link(&link);
    let key = format!("{:x}", Sha256::digest(token.as_bytes()));
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
    let expired = harness.service.verify_email(&token).unwrap_err();
    assert!(expired.to_string().contains("expired"), "{expired}");

    let unknown = harness.service.verify_email("not-a-token").unwrap_err();
    assert!(unknown.to_string().contains("invalid"), "{unknown}");

    harness
        .service
        .resend_verification("missing@example.com")
        .await;
    harness
        .service
        .resend_verification("EXPIRED@example.com")
        .await;
}

#[tokio::test]
async fn rejects_pending_registrations() {
    let harness = harness();
    let pending = register(&harness, "pending@example.com", None).await;
    let rejected = harness.service.reject_user(pending.id).unwrap();
    assert_eq!(rejected.status, UserStatus::Rejected);
    let error = harness
        .service
        .login("pending@example.com", "password123", &metadata())
        .unwrap_err();
    assert!(error.to_string().contains("rejected"), "{error}");

    let active = active_user(&harness, "active@example.com").await;
    assert!(harness.service.reject_user(active.id).is_err());
    assert!(
        harness
            .service
            .approve_user(active.id, Uuid::new_v4(), None)
            .is_err()
    );

    let waiting = register(&harness, "waiting@example.com", None).await;
    let (_, link) = harness.mailer.last().unwrap();
    harness
        .service
        .verify_email(&token_from_link(&link))
        .unwrap();
    assert_eq!(harness.service.pending_users().unwrap().len(), 1);
    harness.service.reject_user(waiting.id).unwrap();
    assert!(harness.service.pending_users().unwrap().is_empty());
}

#[tokio::test]
async fn totp_setup_enable_login_and_disable() {
    let harness = harness();
    let user = active_user(&harness, "totp@example.com").await;
    let setup = harness.service.setup_totp(user.id).unwrap();
    assert_eq!(setup.recovery_codes.len(), 8);
    assert!(setup.otpauth_url.starts_with("otpauth://totp/"));

    let stored = harness.service.find(user.id).unwrap();
    let sealed = stored.totp_secret_sealed.clone().unwrap();
    assert_ne!(sealed, setup.secret);
    assert!(!sealed.contains(&setup.secret));
    assert!(!stored.totp_enabled);
    assert_eq!(stored.recovery_codes.len(), 8);
    assert!(!stored.recovery_codes.contains(&setup.recovery_codes[0]));

    let code = totp_code(&setup.secret, &user.login);
    harness.service.enable_totp(user.id, &code).unwrap();
    assert!(harness.service.find(user.id).unwrap().totp_enabled);

    let missing = harness
        .service
        .login_with_totp("totp@example.com", "password123", None, &metadata())
        .unwrap_err();
    assert!(missing.to_string().contains("totp_required"), "{missing}");

    let wrong = harness
        .service
        .login_with_totp(
            "totp@example.com",
            "password123",
            Some("000000"),
            &metadata(),
        )
        .unwrap_err();
    assert!(wrong.to_string().contains("totp_invalid"), "{wrong}");

    let session = harness
        .service
        .login_with_totp(
            "totp@example.com",
            "password123",
            Some(&totp_code(&setup.secret, &user.login)),
            &metadata(),
        )
        .unwrap();
    assert_eq!(session.user.id, user.id);

    let recovery = setup.recovery_codes[0].clone();
    harness
        .service
        .login_with_totp(
            "totp@example.com",
            "password123",
            Some(&recovery),
            &metadata(),
        )
        .unwrap();
    let reused = harness
        .service
        .login_with_totp(
            "totp@example.com",
            "password123",
            Some(&recovery),
            &metadata(),
        )
        .unwrap_err();
    assert!(reused.to_string().contains("totp_invalid"), "{reused}");

    harness
        .service
        .disable_totp(
            user.id,
            "password123",
            &totp_code(&setup.secret, &user.login),
        )
        .unwrap();
    let cleared = harness.service.find(user.id).unwrap();
    assert!(!cleared.totp_enabled);
    assert!(cleared.totp_secret_sealed.is_none());
    assert!(cleared.recovery_codes.is_empty());
    assert!(
        harness
            .service
            .login("totp@example.com", "password123", &metadata())
            .is_ok()
    );
}

#[tokio::test]
async fn totp_disable_requires_password_and_code() {
    let harness = harness();
    let user = active_user(&harness, "guard@example.com").await;
    let setup = harness.service.setup_totp(user.id).unwrap();

    let wrong_password = harness
        .service
        .disable_totp(
            user.id,
            "wrong-password",
            &totp_code(&setup.secret, &user.login),
        )
        .unwrap_err();
    assert!(wrong_password.to_string().contains("password is wrong"));

    let wrong_code = harness
        .service
        .disable_totp(user.id, "password123", "000000")
        .unwrap_err();
    assert!(wrong_code.to_string().contains("invalid totp code"));
    assert!(!harness.service.find(user.id).unwrap().totp_enabled);
}
