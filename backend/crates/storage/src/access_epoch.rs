//! Per-user access-token revocation epoch.
//!
//! Access tokens are stateless: until they expire (15 minutes by default) a
//! verifier cannot tell whether a token was issued before a logout-all,
//! password change or account block. `user_access_epochs` closes that window
//! by storing the unix second at which a user's access tokens were last
//! invalidated. A verifier rejects a token whose `iat` is strictly older than
//! the stored epoch; a token issued in the same second stays valid, so a fresh
//! login right after the event is not rejected by accident.
//!
//! The value is a JSON `i64` and the key is the user id, matching the layout
//! of the other tables.

use uuid::Uuid;

use crate::{Result, Store, Table};

fn key(user_id: Uuid) -> String {
    user_id.to_string()
}

/// Returns the epoch of `user_id`, or `None` when the user never had their
/// access tokens invalidated.
pub fn get(store: &Store, user_id: Uuid) -> Result<Option<i64>> {
    store.get(Table::UserAccessEpochs, &key(user_id))
}

/// Stores the epoch of `user_id` as a unix timestamp in seconds.
pub fn set(store: &Store, user_id: Uuid, epoch_secs: i64) -> Result<()> {
    store.put(Table::UserAccessEpochs, &key(user_id), &epoch_secs)
}

/// Removes the epoch of `user_id`, making every not-yet-expired access token
/// valid again. Only meant for cleanup and tests; revocation paths never call
/// this.
pub fn clear(store: &Store, user_id: Uuid) -> Result<()> {
    store.delete(Table::UserAccessEpochs, &key(user_id))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TempDb {
        path: PathBuf,
    }

    impl TempDb {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("awg-storage-access-epoch-{}.redb", Uuid::new_v4()));
            Self { path }
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[test]
    fn set_get_and_clear_roundtrip() {
        let store = Store::open_in_memory().unwrap();
        let user = Uuid::new_v4();

        assert_eq!(get(&store, user).unwrap(), None);
        set(&store, user, 1_767_323_045).unwrap();
        assert_eq!(get(&store, user).unwrap(), Some(1_767_323_045));

        clear(&store, user).unwrap();
        assert_eq!(get(&store, user).unwrap(), None);
    }

    #[test]
    fn epochs_are_isolated_per_user() {
        let store = Store::open_in_memory().unwrap();
        let alice = Uuid::new_v4();
        let bob = Uuid::new_v4();

        set(&store, alice, 100).unwrap();
        assert_eq!(get(&store, bob).unwrap(), None);
        assert_eq!(get(&store, alice).unwrap(), Some(100));

        set(&store, alice, 200).unwrap();
        assert_eq!(get(&store, alice).unwrap(), Some(200));
        assert_eq!(get(&store, bob).unwrap(), None);
    }

    #[test]
    fn value_survives_reopening_the_database() {
        let db = TempDb::new();
        let user = Uuid::new_v4();

        {
            let store = Store::open(&db.path).unwrap();
            set(&store, user, 1_800_000_000).unwrap();
        }

        let reopened = Store::open(&db.path).unwrap();
        assert_eq!(get(&reopened, user).unwrap(), Some(1_800_000_000));
    }
}
