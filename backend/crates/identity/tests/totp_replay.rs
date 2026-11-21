use std::sync::{Arc, Barrier};
use std::thread;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use uuid::Uuid;

use awg_identity::domain::PasswordHasher;
use awg_identity::{
    Argon2Hasher, CaptureMailer, IdentityService, JwtIssuer, NewUser,
    RedbEmailVerificationRepository, RedbUserRepository, Role, SessionMetadata,
};
use awg_shared::crypto::Sealer;
use awg_storage::{Store, Table};
use totp_rs::{Builder, Secret};

const SECRET: &[u8] = b"test-secret-with-at-least-32-bytes!!";
const PASSWORD: &str = "password123";
const ISSUER: &str = "awg-admin";

struct Harness {
    service: Arc<IdentityService>,
    store: Arc<Store>,
}

fn harness() -> Harness {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let service = Arc::new(IdentityService::new(
        Arc::new(RedbUserRepository::new(store.clone())),
        Arc::new(Argon2Hasher::default()),
        Arc::new(JwtIssuer::new(
            SECRET,
            900,
            86_400,
            ISSUER,
            ISSUER,
            store.clone(),
        )),
        Arc::new(RedbEmailVerificationRepository::new(store.clone())),
        Arc::new(CaptureMailer::new()),
        Arc::new(Sealer::from_master_key(&STANDARD.encode([9u8; 32])).unwrap()),
        "https://panel.test".into(),
    ));
    Harness { service, store }
}

fn metadata() -> SessionMetadata {
    SessionMetadata {
        user_agent: Some("test-agent".into()),
        ip: Some("203.0.113.9".into()),
    }
}

fn active_user(harness: &Harness, email: &str) -> Uuid {
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
        .id
}

fn totp_code_at(secret: &str, account: &str, offset_secs: u64) -> String {
    let secret = Secret::try_from_base32(secret).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    Builder::new()
        .with_secret(secret)
        .with_account_name(account)
        .with_issuer(Some(ISSUER))
        .build()
        .unwrap()
        .generate(now + offset_secs)
        .to_string()
}

fn enable_totp(harness: &Harness, email: &str) -> (Uuid, String, Vec<String>) {
    let user_id = active_user(harness, email);
    let setup = harness
        .service
        .setup_totp(user_id, Some(PASSWORD), None)
        .unwrap();
    let code = totp_code_at(&setup.secret, email, 0);
    harness
        .service
        .enable_totp(user_id, PASSWORD, &code)
        .unwrap();
    (user_id, setup.secret, setup.recovery_codes)
}

fn race<F>(count: usize, run: F) -> Vec<Result<Uuid, String>>
where
    F: Fn() -> Result<Uuid, String> + Send + Sync + 'static,
{
    let barrier = Arc::new(Barrier::new(count + 1));
    let run = Arc::new(run);
    let mut handles = Vec::new();
    for _ in 0..count {
        let barrier = barrier.clone();
        let run = run.clone();
        handles.push(thread::spawn(move || {
            barrier.wait();
            run()
        }));
    }
    barrier.wait();
    handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect()
}

#[test]
fn the_same_totp_code_cannot_be_spent_by_two_logins() {
    let harness = harness();
    let (_, secret, _) = enable_totp(&harness, "race@example.com");
    let code = totp_code_at(&secret, "race@example.com", 30);

    let service = harness.service.clone();
    let email = "race@example.com";
    let results = race(2, move || {
        service
            .login_with_totp(email, PASSWORD, Some(&code), &metadata())
            .map(|session| session.user.id)
            .map_err(|error| error.to_string())
    });

    let successes = results.iter().filter(|result| result.is_ok()).count();
    assert_eq!(
        successes, 1,
        "exactly one login may spend the step: {results:?}"
    );
    let failure = results
        .iter()
        .find_map(|result| result.as_ref().err())
        .expect("the second login must fail");
    assert!(
        failure.contains("totp_invalid"),
        "the loser must see totp_invalid, got: {failure}"
    );
}

#[test]
fn the_same_recovery_code_cannot_be_spent_by_two_logins() {
    let harness = harness();
    let (_, _, recovery_codes) = enable_totp(&harness, "recovery-race@example.com");
    let code = recovery_codes[0].clone();

    let service = harness.service.clone();
    let email = "recovery-race@example.com";
    let results = race(2, move || {
        service
            .login_with_totp(email, PASSWORD, Some(&code), &metadata())
            .map(|session| session.user.id)
            .map_err(|error| error.to_string())
    });

    let successes = results.iter().filter(|result| result.is_ok()).count();
    assert_eq!(
        successes, 1,
        "exactly one login may spend the recovery code: {results:?}"
    );
    let failure = results
        .iter()
        .find_map(|result| result.as_ref().err())
        .expect("the second login must fail");
    assert!(
        failure.contains("totp_invalid"),
        "the loser must see totp_invalid, got: {failure}"
    );
}

#[test]
fn recovery_codes_carry_128_bits_of_entropy() {
    let harness = harness();
    let user_id = active_user(&harness, "entropy@example.com");
    let setup = harness
        .service
        .setup_totp(user_id, Some(PASSWORD), None)
        .unwrap();

    assert_eq!(setup.recovery_codes.len(), 8);
    for code in &setup.recovery_codes {
        assert_eq!(code.len(), 32, "16 bytes rendered as lowercase hex: {code}");
        assert!(code.chars().all(|c| c.is_ascii_hexdigit()), "{code}");
    }
    assert!(setup.recovery_codes.iter().all(|code| {
        code.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    }));
}

#[test]
fn legacy_short_recovery_codes_still_verify() {
    let harness = harness();
    let (user_id, _, _) = enable_totp(&harness, "legacy@example.com");

    // The old generator produced 5 random bytes as 10 hex characters. Only the
    // plaintext length changed, so a stored Argon2 hash keeps verifying.
    let legacy_code = "0123456789";
    let mut stored = harness.service.find(user_id).unwrap();
    stored.recovery_codes = vec![Argon2Hasher::default().hash(legacy_code).unwrap()];
    harness
        .store
        .put(Table::Users, &user_id.to_string(), &stored)
        .unwrap();

    harness
        .service
        .login_with_totp(
            "legacy@example.com",
            PASSWORD,
            Some(legacy_code),
            &metadata(),
        )
        .unwrap();

    let replay = harness
        .service
        .login_with_totp(
            "legacy@example.com",
            PASSWORD,
            Some(legacy_code),
            &metadata(),
        )
        .unwrap_err();
    assert!(replay.to_string().contains("totp_invalid"), "{replay}");
}
