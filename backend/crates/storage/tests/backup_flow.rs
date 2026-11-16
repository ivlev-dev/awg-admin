use std::fs;
use std::path::{Path, PathBuf};

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
