use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use awg_identity::{RedbUserRepository, Role, User, UserRepository, UserStatus};
use awg_storage::Store;
use awg_storage::lookup_index;

fn make_user(index: usize) -> User {
    let now = Utc::now();
    User {
        id: Uuid::new_v4(),
        email: format!("user{index}@example.com"),
        full_name: None,
        // `find_by_email` never verifies the password, so a placeholder keeps
        // the test focused on the index instead of 1000 Argon2 hashes.
        password_hash: "not-a-real-hash".into(),
        role: Role::User,
        tariff_id: None,
        group_id: None,
        node_id: None,
        disabled: false,
        status: UserStatus::Active,
        totp_secret_sealed: None,
        totp_enabled: false,
        recovery_codes: Vec::new(),
        totp_pending_secret_sealed: None,
        totp_pending_recovery_codes: Vec::new(),
        last_totp_step: None,
        created_at: now,
        updated_at: now,
    }
}

#[test]
fn find_by_email_is_a_point_lookup_over_the_index() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let repo = RedbUserRepository::new(store.clone());

    let mut target = make_user(0);
    for index in 0..1000 {
        let user = make_user(index);
        if index == 777 {
            target = user.clone();
        }
        repo.save(&user).unwrap();
    }
    assert_eq!(repo.count().unwrap(), 1000);

    let found = repo
        .find_by_email("  USER777@Example.COM ")
        .unwrap()
        .expect("the indexed email must resolve");
    assert_eq!(found.id, target.id);

    // Removing only the index row models a missing/incomplete index. The user
    // row still exists, so a fallback scan would find it; the point lookup
    // must not.
    lookup_index::unindex_user_email(&store, "user777@example.com").unwrap();
    assert!(
        repo.find_by_id(target.id).unwrap().is_some(),
        "the user row itself is still present"
    );
    assert!(
        repo.find_by_email("user777@example.com").unwrap().is_none(),
        "find_by_email must not fall back to scanning the users table"
    );
    assert_eq!(repo.count().unwrap(), 1000);
}

#[test]
fn email_changes_and_deletes_keep_the_lookup_index_in_sync() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let repo = RedbUserRepository::new(store);

    let mut user = make_user(1);
    repo.save(&user).unwrap();
    assert!(repo.find_by_email("user1@example.com").unwrap().is_some());

    user.email = "renamed@example.com".into();
    repo.save(&user).unwrap();
    assert!(repo.find_by_email("user1@example.com").unwrap().is_none());
    assert!(repo.find_by_email("renamed@example.com").unwrap().is_some());

    repo.delete(user.id).unwrap();
    assert!(repo.find_by_email("renamed@example.com").unwrap().is_none());
}
