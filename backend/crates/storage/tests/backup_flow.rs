use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use awg_shared::crypto::{Sealer, sha256_hex};
use awg_storage::{CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, StorageError, Store, Table};
use redb::Database;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Record {
    value: String,
}

fn record(value: &str) -> Record {
    Record {
        value: value.to_string(),
    }
}

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("awg-storage-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_version_file(path: &Path, version: Option<u32>) {
    let db = Database::create(path).unwrap();
    let txn = db.begin_write().unwrap();
    if let Some(version) = version {
        let mut meta = txn.open_table(Table::Meta.definition()).unwrap();
        let bytes = serde_json::to_vec(&version).unwrap();
        meta.insert(SCHEMA_VERSION_KEY, bytes.as_slice()).unwrap();
    }
    txn.commit().unwrap();
    drop(db);
}

#[test]
fn backup_and_restore_roundtrip() {
    let dir = TempDir::new();
    let store = Store::open(dir.join("db.redb")).unwrap();

    store
        .put(Table::Settings, "theme", &record("dark"))
        .unwrap();
    store
        .backup_to(dir.join("backup/db.redb"))
        .expect("backup must succeed");

    store
        .put(Table::Settings, "theme", &record("light"))
        .unwrap();
    store
        .put(Table::Settings, "extra", &record("added-later"))
        .unwrap();
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("light"))
    );

    store.restore_from(dir.join("backup/db.redb")).unwrap();

    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
    assert_eq!(store.get::<Record>(Table::Settings, "extra").unwrap(), None);
    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
}

#[test]
fn backup_is_a_consistent_point_in_time_copy() {
    let dir = TempDir::new();
    let store = Store::open(dir.join("db.redb")).unwrap();

    for index in 0..50 {
        store
            .put(Table::Nodes, &format!("node-{index}"), &record("v1"))
            .unwrap();
    }
    store.backup_to(dir.join("snapshot.redb")).unwrap();
    for index in 0..50 {
        store
            .put(Table::Nodes, &format!("node-{index}"), &record("v2"))
            .unwrap();
    }

    let restored = Store::open(dir.join("snapshot.redb")).unwrap();
    assert_eq!(restored.count(Table::Nodes).unwrap(), 50);
    for index in 0..50 {
        assert_eq!(
            restored
                .get::<Record>(Table::Nodes, &format!("node-{index}"))
                .unwrap(),
            Some(record("v1"))
        );
    }
    assert_eq!(restored.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
}

#[test]
fn replace_file_restores_stopped_store() {
    let dir = TempDir::new();
    let db_path = dir.join("db.redb");
    let backup_path = dir.join("backup.redb");

    {
        let store = Store::open(&db_path).unwrap();
        store
            .put(Table::Settings, "theme", &record("dark"))
            .unwrap();
        store.backup_to(&backup_path).unwrap();
        store
            .put(Table::Settings, "theme", &record("light"))
            .unwrap();
    }

    Store::replace_file_from(&backup_path, &db_path).unwrap();

    let store = Store::open(&db_path).unwrap();
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
}

#[test]
fn restore_refuses_newer_backup_without_touching_store() {
    let dir = TempDir::new();
    let store = Store::open(dir.join("db.redb")).unwrap();
    store
        .put(Table::Settings, "theme", &record("dark"))
        .unwrap();

    let newer = dir.join("newer.redb");
    write_version_file(&newer, Some(CURRENT_SCHEMA_VERSION + 1));

    let err = store.restore_from(&newer).unwrap_err();
    assert!(matches!(
        err,
        StorageError::IncompatibleBackup { found, supported }
            if found == CURRENT_SCHEMA_VERSION + 1 && supported == CURRENT_SCHEMA_VERSION
    ));
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
}

#[test]
fn restore_refuses_unversioned_backup() {
    let dir = TempDir::new();
    let store = Store::open(dir.join("db.redb")).unwrap();
    let unversioned = dir.join("unversioned.redb");
    write_version_file(&unversioned, None);

    let err = store.restore_from(&unversioned).unwrap_err();
    assert!(matches!(err, StorageError::UnversionedBackup));
}

#[test]
fn backup_refuses_to_overwrite_open_store() {
    let dir = TempDir::new();
    let db_path = dir.join("db.redb");
    let store = Store::open(&db_path).unwrap();

    let err = store.backup_to(&db_path).unwrap_err();
    assert!(matches!(err, StorageError::BackupPathConflict(_)));
}

#[test]
fn missing_backup_is_reported() {
    let dir = TempDir::new();
    let store = Store::open(dir.join("db.redb")).unwrap();

    let err = store.restore_from(dir.join("absent.redb")).unwrap_err();
    assert!(matches!(err, StorageError::BackupNotFound(_)));
}

const LEGACY_USER_ID: &str = "11111111-1111-1111-1111-111111111111";
const MASTER_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const LEGACY_TOKEN: &str = "legacy-token";

fn seed_legacy_backup(path: &Path, version: u32, legacy_share: Option<&str>) {
    let database = Database::create(path).unwrap();
    let txn = database.begin_write().unwrap();
    {
        let mut users = txn.open_table(Table::Users.definition()).unwrap();
        let user = serde_json::json!({
            "id": LEGACY_USER_ID,
            "login": "alice",
            "email": "alice@example.com",
            "role": "admin",
            "status": "active",
            "disabled": false,
            "created_at": "2026-01-02T03:04:05.123456Z",
        });
        let bytes = serde_json::to_vec(&user).unwrap();
        users.insert("alice", bytes.as_slice()).unwrap();
    }
    {
        let mut settings = txn.open_table(Table::Settings.definition()).unwrap();
        let bytes = serde_json::to_vec(&record("dark")).unwrap();
        settings.insert("theme", bytes.as_slice()).unwrap();
    }
    if let Some(token) = legacy_share {
        let mut links = txn.open_table(Table::ShareLinks.definition()).unwrap();
        let link = serde_json::json!({
            "id": "legacy-link",
            "user_id": LEGACY_USER_ID,
            "token": token,
        });
        let bytes = serde_json::to_vec(&link).unwrap();
        links.insert("legacy-link", bytes.as_slice()).unwrap();
    }
    {
        let mut meta = txn.open_table(Table::Meta.definition()).unwrap();
        let bytes = serde_json::to_vec(&version).unwrap();
        meta.insert(SCHEMA_VERSION_KEY, bytes.as_slice()).unwrap();
    }
    txn.commit().unwrap();
    drop(database);
}

fn store_file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

fn assert_no_leftovers(dir: &Path, expected: &[&str]) {
    let names = store_file_names(dir);
    assert_eq!(
        names,
        expected
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>(),
        "restore must not leave temporary files behind"
    );
}

#[test]
fn restore_upgrades_v8_backup_without_mutating_it() {
    let dir = TempDir::new();
    let backup = dir.join("v8.redb");
    seed_legacy_backup(&backup, 8, None);
    let before = fs::read(&backup).unwrap();

    let store = Store::open(dir.join("db.redb")).unwrap();
    store
        .put(Table::Settings, "theme", &record("light"))
        .unwrap();

    store.restore_from(&backup).unwrap();

    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
    let user: serde_json::Value = store.get(Table::Users, "alice").unwrap().unwrap();
    assert_eq!(user["id"], LEGACY_USER_ID);
    assert_eq!(user["email"], "alice@example.com");
    assert_eq!(user["role"], "admin");
    assert_eq!(
        fs::read(&backup).unwrap(),
        before,
        "backup must stay intact"
    );
    assert_no_leftovers(&dir.path, &["db.redb", "v8.redb"]);
}

#[test]
fn repeated_restore_of_old_backup_is_idempotent() {
    let dir = TempDir::new();
    let backup = dir.join("v8.redb");
    seed_legacy_backup(&backup, 8, None);
    let before = fs::read(&backup).unwrap();

    let store = Store::open(dir.join("db.redb")).unwrap();
    for _ in 0..3 {
        store.restore_from(&backup).unwrap();
        assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
        assert_eq!(
            store.get::<Record>(Table::Settings, "theme").unwrap(),
            Some(record("dark"))
        );
        assert_eq!(store.count(Table::Users).unwrap(), 1);
        assert_eq!(fs::read(&backup).unwrap(), before);
    }
    assert_no_leftovers(&dir.path, &["db.redb", "v8.redb"]);
}

#[test]
fn restore_of_v10_legacy_share_requires_master_key() {
    let dir = TempDir::new();
    let backup = dir.join("v10.redb");
    seed_legacy_backup(&backup, 10, Some(LEGACY_TOKEN));
    let before = fs::read(&backup).unwrap();

    let store = Store::open(dir.join("db.redb")).unwrap();
    store
        .put(Table::Settings, "theme", &record("light"))
        .unwrap();

    let err = store.restore_from(&backup).unwrap_err();
    assert!(matches!(err, StorageError::Secret(_)), "got {err:?}");
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("light")),
        "a failed restore must not touch the target store"
    );
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_no_leftovers(&dir.path, &["db.redb", "v10.redb"]);
}

#[test]
fn restore_of_v10_legacy_share_seals_tokens_with_master_key() {
    let dir = TempDir::new();
    let backup = dir.join("v10.redb");
    seed_legacy_backup(&backup, 10, Some(LEGACY_TOKEN));
    let before = fs::read(&backup).unwrap();
    let sealer = Arc::new(Sealer::from_master_key(MASTER_KEY).unwrap());

    let store = Store::open(dir.join("db.redb")).unwrap();
    store
        .restore_from_with_sealer(&backup, Some(sealer.clone()))
        .unwrap();

    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );

    let hash = sha256_hex(LEGACY_TOKEN.as_bytes());
    assert!(
        store
            .get_raw(Table::ShareLinks, "legacy-link")
            .unwrap()
            .is_none()
    );
    let raw = store.get_raw(Table::ShareLinks, &hash).unwrap().unwrap();
    assert!(
        !raw.windows(LEGACY_TOKEN.len())
            .any(|window| window == LEGACY_TOKEN.as_bytes()),
        "the plaintext token must not survive the restore"
    );
    let link: serde_json::Value = store.get(Table::ShareLinks, &hash).unwrap().unwrap();
    assert!(link.get("token").is_none());
    assert_eq!(link["token_hash"], hash);
    assert_eq!(
        sealer
            .open_str(link["token_sealed"].as_str().unwrap())
            .unwrap(),
        LEGACY_TOKEN
    );
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_no_leftovers(&dir.path, &["db.redb", "v10.redb"]);
}

#[test]
fn replace_file_upgrades_old_backup_only_with_master_key() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup = dir.join("v10.redb");
    seed_legacy_backup(&backup, 10, Some(LEGACY_TOKEN));
    let before = fs::read(&backup).unwrap();

    {
        let store = Store::open(&db).unwrap();
        store
            .put(Table::Settings, "theme", &record("light"))
            .unwrap();
    }

    let err = Store::replace_file_from(&backup, &db).unwrap_err();
    assert!(matches!(err, StorageError::Secret(_)), "got {err:?}");
    {
        let store = Store::open(&db).unwrap();
        assert_eq!(
            store.get::<Record>(Table::Settings, "theme").unwrap(),
            Some(record("light")),
            "a failed offline restore must not touch the target database"
        );
    }
    assert_eq!(fs::read(&backup).unwrap(), before);

    let sealer = Arc::new(Sealer::from_master_key(MASTER_KEY).unwrap());
    Store::replace_file_from_with_sealer(&backup, &db, Some(sealer)).unwrap();

    let store = Store::open(&db).unwrap();
    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
    let hash = sha256_hex(LEGACY_TOKEN.as_bytes());
    assert!(
        store
            .get::<serde_json::Value>(Table::ShareLinks, &hash)
            .unwrap()
            .is_some()
    );
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_no_leftovers(&dir.path, &["db.redb", "v10.redb"]);
}

#[test]
fn replace_file_upgrades_v8_backup_without_master_key() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup = dir.join("v8.redb");
    seed_legacy_backup(&backup, 8, None);
    let before = fs::read(&backup).unwrap();
    Store::open(&db).unwrap();

    Store::replace_file_from(&backup, &db).unwrap();

    let store = Store::open(&db).unwrap();
    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_no_leftovers(&dir.path, &["db.redb", "v8.redb"]);
}

#[test]
fn restore_into_in_memory_store_stages_outside_the_backup_directory() {
    let dir = TempDir::new();
    let backup = dir.join("v8.redb");
    seed_legacy_backup(&backup, 8, None);
    let before = fs::read(&backup).unwrap();

    let store = Store::open_in_memory().unwrap();
    store
        .put(Table::Settings, "theme", &record("light"))
        .unwrap();
    store.restore_from(&backup).unwrap();

    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("dark"))
    );
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_no_leftovers(&dir.path, &["v8.redb"]);
}

#[cfg(unix)]
#[test]
fn snapshot_and_its_directory_are_private() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new();
    let store = Store::open(dir.join("db.redb")).unwrap();
    store
        .put(Table::Settings, "theme", &record("dark"))
        .unwrap();

    let backup = dir.join("backups/db.redb");
    store.backup_to(&backup).unwrap();

    let file_mode = fs::metadata(&backup).unwrap().permissions().mode() & 0o777;
    assert_eq!(file_mode, 0o600, "the snapshot must be owner-only");
    let dir_mode = fs::metadata(dir.join("backups"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(dir_mode, 0o700, "a created backup directory must be 0700");
}

const OTHER_MASTER_KEY_BYTES: [u8; 32] = [0x42; 32];

#[test]
fn restore_with_a_foreign_master_key_is_refused() {
    let dir = TempDir::new();
    let backup = dir.join("sealed.redb");
    let sealer = Arc::new(Sealer::from_master_key(MASTER_KEY).unwrap());
    let sealed = sealer.seal_str("private-key").unwrap();
    {
        let source =
            Store::open_with_sealer(dir.join("source.redb"), Some(sealer.clone())).unwrap();
        source
            .put(
                Table::Devices,
                "device-1",
                &serde_json::json!({
                    "id": "device-1",
                    "user_id": LEGACY_USER_ID,
                    "private_key_sealed": sealed.clone(),
                }),
            )
            .unwrap();
        source.backup_to(&backup).unwrap();
    }

    let store = Store::open(dir.join("db.redb")).unwrap();
    store
        .put(Table::Settings, "theme", &record("light"))
        .unwrap();

    let foreign = Arc::new(
        Sealer::from_master_key(&awg_shared::crypto::b64_encode(&OTHER_MASTER_KEY_BYTES)).unwrap(),
    );
    let err = store
        .restore_from_with_sealer(&backup, Some(foreign))
        .unwrap_err();
    assert!(
        matches!(err, StorageError::BackupKeyMismatch),
        "got {err:?}"
    );
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(record("light")),
        "a refused restore must not touch the target store"
    );
    assert_eq!(store.count(Table::Devices).unwrap(), 0);

    store
        .restore_from_with_sealer(&backup, Some(sealer))
        .unwrap();
    assert_eq!(store.count(Table::Devices).unwrap(), 1);
    let device: serde_json::Value = store.get(Table::Devices, "device-1").unwrap().unwrap();
    assert_eq!(device["private_key_sealed"], sealed);
}
