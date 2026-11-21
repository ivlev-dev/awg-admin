use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use uuid::Uuid;

use awg_identity::domain::RefreshRecord;
use awg_identity::{
    Argon2Hasher, CaptureMailer, IdentityService, JwtIssuer, NewUser,
    RedbEmailVerificationRepository, RedbUserRepository, Role, SessionMetadata,
};
use awg_shared::crypto::Sealer;
use awg_storage::{Store, Table};

const SECRET: &[u8] = b"test-secret-with-at-least-32-bytes!!";
const PASSWORD: &str = "password123";

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

fn create_user(harness: &Harness, email: &str) -> Uuid {
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

fn records(harness: &Harness) -> Vec<(String, RefreshRecord)> {
    harness
        .store
        .list_prefix::<RefreshRecord>(Table::RefreshTokens, "")
        .unwrap()
}

#[test]
fn list_sessions_returns_one_row_per_rotated_family() {
    let harness = harness();
    let user_id = create_user(&harness, "rotate@example.com");
    let first = harness
        .service
        .login("rotate@example.com", PASSWORD, &metadata())
        .unwrap();
    let family_id = harness.service.sessions(user_id).unwrap()[0].family_id;

    let mut latest = first.refresh_token.clone();
    for _ in 0..3 {
        latest = harness
            .service
            .refresh(&latest, &metadata())
            .unwrap()
            .refresh_token;
    }

    let all = records(&harness);
    assert_eq!(all.len(), 4, "three rotations plus the original token");
    assert!(all.iter().all(|(_, record)| record.family_id == family_id));

    let sessions = harness.service.sessions(user_id).unwrap();
    assert_eq!(sessions.len(), 1, "one login must be one session row");
    assert_eq!(sessions[0].family_id, family_id);
    assert!(!sessions[0].revoked);
    assert!(
        !sessions[0].used,
        "the listed row is the current, unspent rotation"
    );
}

#[test]
fn revoking_any_rotation_revokes_the_whole_family() {
    let harness = harness();
    let user_id = create_user(&harness, "family@example.com");
    let first = harness
        .service
        .login("family@example.com", PASSWORD, &metadata())
        .unwrap();

    let mut latest = first.refresh_token.clone();
    for _ in 0..3 {
        latest = harness
            .service
            .refresh(&latest, &metadata())
            .unwrap()
            .refresh_token;
    }

    let mut all = records(&harness);
    all.sort_by_key(|(_, record)| record.created_at);
    let oldest_jti = Uuid::parse_str(&all[0].0).unwrap();

    harness.service.revoke_session(user_id, oldest_jti).unwrap();

    let after = records(&harness);
    assert_eq!(after.len(), 4);
    assert!(
        after.iter().all(|(_, record)| record.revoked),
        "every rotation of the family must be revoked"
    );

    assert!(
        harness.service.refresh(&latest, &metadata()).is_err(),
        "the newest refresh token must stop working"
    );
    assert!(
        harness
            .service
            .refresh(&first.refresh_token, &metadata())
            .is_err(),
        "an older refresh token must not resurrect the family"
    );

    let sessions = harness.service.sessions(user_id).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].revoked);
}

#[test]
fn revoking_one_login_keeps_other_logins_alive() {
    let harness = harness();
    let user_id = create_user(&harness, "multi@example.com");

    let first = harness
        .service
        .login("multi@example.com", PASSWORD, &metadata())
        .unwrap();
    let first_jti = harness.service.sessions(user_id).unwrap()[0].jti;
    let second = harness
        .service
        .login("multi@example.com", PASSWORD, &metadata())
        .unwrap();

    let sessions = harness.service.sessions(user_id).unwrap();
    assert_eq!(sessions.len(), 2);

    harness.service.revoke_session(user_id, first_jti).unwrap();
    assert!(
        harness
            .service
            .refresh(&first.refresh_token, &metadata())
            .is_err()
    );
    assert!(
        harness
            .service
            .refresh(&second.refresh_token, &metadata())
            .is_ok()
    );
}
