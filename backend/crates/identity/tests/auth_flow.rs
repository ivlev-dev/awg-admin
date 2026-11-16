use std::sync::Arc;

use awg_identity::{Argon2Hasher, IdentityService, JwtIssuer, NewUser, RedbUserRepository, Role};
use awg_storage::Store;

fn service() -> IdentityService {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let users = Arc::new(RedbUserRepository::new(store.clone()));
    let hasher = Arc::new(Argon2Hasher::default());
    let tokens = Arc::new(JwtIssuer::new(b"test-secret", 900, 86_400, store));
    IdentityService::new(users, hasher, tokens)
}

#[test]
fn seeds_admin_once_and_logs_in() {
    let service = service();
    let admin = service.seed_admin("admin", "password123").unwrap();
    assert!(admin.is_some());
    assert!(
        service
            .seed_admin("other", "password123")
            .unwrap()
            .is_none()
    );

    assert!(service.login("admin", "wrong-password").is_err());
    let session = service.login("admin", "password123").unwrap();
    assert_eq!(session.user.role, Role::Admin);

    let principal = service.authenticate(&session.access_token).unwrap();
    assert!(principal.is_admin());
    assert_eq!(principal.user_id, session.user.id);
}

#[test]
fn refresh_rotates_tokens() {
    let service = service();
    service.seed_admin("admin", "password123").unwrap();
    let session = service.login("admin", "password123").unwrap();

    let refreshed = service.refresh(&session.refresh_token).unwrap();
    assert_ne!(refreshed.access_token, session.access_token);
    assert!(service.refresh(&session.refresh_token).is_err());
}

#[test]
fn password_change_and_role_update() {
    let service = service();
    let admin = service.seed_admin("admin", "password123").unwrap().unwrap();
    let user = service
        .create(NewUser {
            login: "user".into(),
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
        })
        .unwrap();

    service
        .change_password(user.id, Some("password123"), "newpassword123")
        .unwrap();
    assert!(service.login("user", "newpassword123").is_ok());
    assert!(service.login("user", "password123").is_err());

    let updated = service
        .update(
            user.id,
            awg_identity::UserChanges {
                role: Some(Role::Admin),
                tariff_id: None,
                group_id: None,
                disabled: Some(false),
            },
        )
        .unwrap();
    assert_eq!(updated.role, Role::Admin);
    assert!(service.list().unwrap().iter().any(|u| u.id == admin.id));
}

#[test]
fn disabled_user_cannot_log_in() {
    let service = service();
    service.seed_admin("admin", "password123").unwrap();
    let user = service
        .create(NewUser {
            login: "user".into(),
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
        })
        .unwrap();
    service
        .update(
            user.id,
            awg_identity::UserChanges {
                role: None,
                tariff_id: None,
                group_id: None,
                disabled: Some(true),
            },
        )
        .unwrap();
    assert!(service.login("user", "password123").is_err());
}
