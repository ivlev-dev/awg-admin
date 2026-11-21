use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

use awg_identity::{
    Argon2Hasher, CaptureMailer, IdentityService, JwtIssuer, NewUser,
    RedbEmailVerificationRepository, RedbUserRepository, Role, SessionMetadata, User, UserChanges,
    UserStatus,
};
use awg_shared::crypto::Sealer;
use awg_storage::{Store, Table};

const SECRET: &[u8] = b"test-secret-with-at-least-32-bytes!!";
const PASSWORD: &str = "password123";
const GENERIC: &str = "invalid email or password";

struct Harness {
    service: IdentityService,
    store: Arc<Store>,
}

fn harness() -> Harness {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let service = IdentityService::new(
        Arc::new(RedbUserRepository::new(store.clone())),
        Arc::new(Argon2Hasher::default()),
        Arc::new(JwtIssuer::new(
            SECRET,
            900,
            86_400,
            "awg-admin",
            "awg-admin",
            store.clone(),
        )),
        Arc::new(RedbEmailVerificationRepository::new(store.clone())),
        Arc::new(CaptureMailer::new()),
        Arc::new(Sealer::from_master_key(&STANDARD.encode([9u8; 32])).unwrap()),
        "https://panel.test".into(),
    );
    Harness { service, store }
}

fn metadata() -> SessionMetadata {
    SessionMetadata {
        user_agent: Some("test-agent".into()),
        ip: Some("203.0.113.9".into()),
    }
}

fn create_user(harness: &Harness, email: &str) -> User {
    harness
        .service
        .create(NewUser {
            email: email.into(),
            full_name: None,
            password: PASSWORD.into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap()
}

fn set_status(harness: &Harness, user: &User, status: UserStatus) {
    let mut stored = harness.service.find(user.id).unwrap();
    stored.status = status;
    harness
        .store
        .put(Table::Users, &user.id.to_string(), &stored)
        .unwrap();
}

fn assert_generic(error: awg_shared::CoreError) {
    assert!(
        error.to_string().contains(GENERIC),
        "expected the generic credentials error, got: {error}"
    );
    for status in [
        "pending_email",
        "pending_approval",
        "rejected",
        "account_disabled",
    ] {
        assert!(
            !error.to_string().contains(status),
            "the error leaked {status}: {error}"
        );
    }
}

#[test]
fn wrong_password_never_discloses_the_account_status() {
    let harness = harness();
    let user = create_user(&harness, "sealed@example.com");

    for status in [
        UserStatus::PendingEmail,
        UserStatus::PendingApproval,
        UserStatus::Rejected,
    ] {
        set_status(&harness, &user, status);
        let error = harness
            .service
            .login("sealed@example.com", "wrong-password", &metadata())
            .unwrap_err();
        assert_generic(error);
    }

    set_status(&harness, &user, UserStatus::Active);
    harness
        .service
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
    assert_generic(
        harness
            .service
            .login("sealed@example.com", "wrong-password", &metadata())
            .unwrap_err(),
    );
}

#[test]
fn correct_password_still_reports_the_specific_status() {
    let harness = harness();
    let user = create_user(&harness, "status@example.com");

    for (status, code) in [
        (UserStatus::PendingEmail, "email_not_verified"),
        (UserStatus::PendingApproval, "pending_approval"),
        (UserStatus::Rejected, "rejected"),
    ] {
        set_status(&harness, &user, status);
        let error = harness
            .service
            .login("status@example.com", PASSWORD, &metadata())
            .unwrap_err();
        assert!(
            error.to_string().contains(code),
            "expected {code} after a valid password, got: {error}"
        );
    }

    set_status(&harness, &user, UserStatus::Active);
    harness
        .service
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
    let error = harness
        .service
        .login("status@example.com", PASSWORD, &metadata())
        .unwrap_err();
    assert!(
        error.to_string().contains("account_disabled"),
        "expected account_disabled after a valid password, got: {error}"
    );
}

#[test]
fn unknown_email_costs_a_password_verification_like_a_wrong_password() {
    let harness = harness();
    create_user(&harness, "known@example.com");

    // Warm the lazily generated dummy hash so the measured calls are comparable.
    assert_generic(
        harness
            .service
            .login("warmup@example.com", PASSWORD, &metadata())
            .unwrap_err(),
    );

    let unknown_started = Instant::now();
    let unknown = harness
        .service
        .login("ghost@example.com", PASSWORD, &metadata())
        .unwrap_err();
    let unknown_elapsed = unknown_started.elapsed();

    let wrong_started = Instant::now();
    let wrong = harness
        .service
        .login("known@example.com", "wrong-password", &metadata())
        .unwrap_err();
    let wrong_elapsed = wrong_started.elapsed();

    assert_generic(unknown);
    assert_eq!(
        harness
            .service
            .login("ghost@example.com", PASSWORD, &metadata())
            .unwrap_err()
            .to_string(),
        wrong.to_string(),
        "an unknown email and a wrong password must be indistinguishable"
    );

    // Argon2 with the default parameters takes far longer than scheduler
    // noise. The lower bound proves an unknown email does not skip the hash;
    // exact equality would be flaky.
    assert!(
        unknown_elapsed >= wrong_elapsed / 3,
        "unknown-email login was suspiciously fast: {unknown_elapsed:?} vs {wrong_elapsed:?}"
    );
    assert!(
        unknown_elapsed >= Duration::from_millis(1),
        "unknown-email login did not run Argon2: {unknown_elapsed:?}"
    );
}
