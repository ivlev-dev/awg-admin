use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use awg_storage::{CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, Store, Table};
use redb::Database;
use serde::{Deserialize, Serialize};

const BIN: &str = env!("CARGO_BIN_EXE_awg-backup");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Record {
    value: String,
}

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("awg-backup-test-{}", uuid::Uuid::new_v4()));
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

fn command() -> Command {
    let mut command = Command::new(BIN);
    command.env_remove("AWG_DB_PATH");
    command.env_remove("AWG_MASTER_KEY");
    command
}

fn seed_db(path: &Path, value: &str) {
    let store = Store::open(path).unwrap();
    store
        .put(
            Table::Settings,
            "theme",
            &Record {
                value: value.to_string(),
            },
        )
        .unwrap();
}

fn read_theme(path: &Path) -> Option<Record> {
    let store = Store::open(path).unwrap();
    store.get(Table::Settings, "theme").unwrap()
}

fn write_version_db(path: &Path, version: Option<u32>) {
    let database = Database::create(path).unwrap();
    let txn = database.begin_write().unwrap();
    if let Some(version) = version {
        let mut meta = txn.open_table(Table::Meta.definition()).unwrap();
        let bytes = serde_json::to_vec(&version).unwrap();
        meta.insert(SCHEMA_VERSION_KEY, bytes.as_slice()).unwrap();
    }
    txn.commit().unwrap();
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "stdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn backup(db: &Path, out: &Path, force: bool) -> Output {
    let mut command = command();
    command
        .arg("backup")
        .arg("--db")
        .arg(db)
        .arg("--out")
        .arg(out);
    if force {
        command.arg("--force");
    }
    command.output().unwrap()
}

#[test]
fn backup_creates_file_and_info_reports_schema() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("backup/awg-20260101.redb");
    seed_db(&db, "dark");

    let output = backup(&db, &backup_path, false);
    assert_success(&output);
    assert!(backup_path.is_file());
    assert!(fs::metadata(&backup_path).unwrap().len() > 0);

    let info = command()
        .arg("info")
        .arg("--db")
        .arg(&backup_path)
        .output()
        .unwrap();
    assert_success(&info);
    let text = String::from_utf8_lossy(&info.stdout);
    assert!(text.contains(&format!("Версия схемы: {CURRENT_SCHEMA_VERSION}")));
    assert!(text.contains("Совместимость: да"));
    assert!(text.contains("settings"));
    assert!(text.contains("meta"));
}

#[test]
fn backup_refuses_existing_file_without_force() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("backup.redb");
    seed_db(&db, "dark");
    fs::write(&backup_path, b"sentinel").unwrap();

    let output = backup(&db, &backup_path, false);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("--force"));
    assert_eq!(fs::read(&backup_path).unwrap(), b"sentinel");

    let forced = backup(&db, &backup_path, true);
    assert_success(&forced);
    assert_eq!(
        read_theme(&backup_path),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn restore_in_place_returns_backup_data() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("backup.redb");
    seed_db(&db, "dark");
    assert_success(&backup(&db, &backup_path, false));
    seed_db(&db, "light");

    let output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .output()
        .unwrap();
    assert_success(&output);
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn restore_offline_replaces_database_file() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("backup.redb");
    seed_db(&db, "dark");
    assert_success(&backup(&db, &backup_path, false));
    seed_db(&db, "light");

    let output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .arg("--offline")
        .output()
        .unwrap();
    assert_success(&output);
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn restore_offline_replaces_corrupt_database() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("backup.redb");
    seed_db(&db, "dark");
    assert_success(&backup(&db, &backup_path, false));
    fs::write(&db, b"not a redb database").unwrap();

    let output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .arg("--offline")
        .output()
        .unwrap();
    assert_success(&output);
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn restore_rejects_incompatible_schema_without_touching_db() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("newer.redb");
    seed_db(&db, "dark");
    write_version_db(&backup_path, Some(CURRENT_SCHEMA_VERSION + 1));

    let output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("backup новее поддерживаемой схемы"));
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn restore_rejects_unversioned_backup() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("unversioned.redb");
    seed_db(&db, "dark");
    write_version_db(&backup_path, None);

    let output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains(SCHEMA_VERSION_KEY));
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn db_path_falls_back_to_environment() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    seed_db(&db, "dark");

    let output = command()
        .arg("info")
        .env("AWG_DB_PATH", &db)
        .output()
        .unwrap();
    assert_success(&output);
    assert!(
        String::from_utf8_lossy(&output.stdout)
            .contains(&format!("Версия схемы: {CURRENT_SCHEMA_VERSION}"))
    );
}

#[test]
fn missing_db_argument_is_usage_error() {
    let output = command().arg("info").output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("AWG_DB_PATH"));
}

#[test]
fn backup_and_restore_refuse_locked_database() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("backup.redb");
    seed_db(&db, "dark");
    assert_success(&backup(&db, &backup_path, false));

    let store = Store::open(&db).unwrap();

    let backup_output = backup(&db, &dir.join("blocked.redb"), false);
    assert_eq!(backup_output.status.code(), Some(1));
    assert!(stderr(&backup_output).contains("занят"));

    let restore_output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .output()
        .unwrap();
    assert_eq!(restore_output.status.code(), Some(1));
    assert!(stderr(&restore_output).contains("занят"));

    drop(store);
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
}

#[test]
fn help_is_available() {
    let output = command().arg("--help").output().unwrap();
    assert_success(&output);
    assert!(String::from_utf8_lossy(&output.stdout).contains("Использование:"));
}

const MASTER_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const LEGACY_TOKEN: &str = "legacy-token";

fn seed_legacy_backup(path: &Path, version: u32, legacy_share: Option<&str>) {
    let database = Database::create(path).unwrap();
    let txn = database.begin_write().unwrap();
    {
        let mut users = txn.open_table(Table::Users.definition()).unwrap();
        let user = serde_json::json!({
            "id": "11111111-1111-1111-1111-111111111111",
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
        let bytes = serde_json::to_vec(&Record {
            value: "dark".into(),
        })
        .unwrap();
        settings.insert("theme", bytes.as_slice()).unwrap();
    }
    if let Some(token) = legacy_share {
        let mut links = txn.open_table(Table::ShareLinks.definition()).unwrap();
        let link = serde_json::json!({
            "id": "legacy-link",
            "user_id": "11111111-1111-1111-1111-111111111111",
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
}

fn restore(db: &Path, from: &Path, offline: bool) -> Output {
    let mut command = command();
    command
        .arg("restore")
        .arg("--db")
        .arg(db)
        .arg("--from")
        .arg(from);
    if offline {
        command.arg("--offline");
    }
    command.output().unwrap()
}

#[test]
fn restore_in_place_upgrades_legacy_schema() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("v8.redb");
    seed_legacy_backup(&backup_path, 8, None);
    let before = fs::read(&backup_path).unwrap();
    seed_db(&db, "light");

    let output = restore(&db, &backup_path, false);
    assert_success(&output);
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("схема 8 ->"),
        "stdout: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "dark".into()
        })
    );
    let store = Store::open(&db).unwrap();
    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert!(
        store
            .get::<serde_json::Value>(Table::Users, "alice")
            .unwrap()
            .is_some()
    );
    drop(store);
    assert_eq!(fs::read(&backup_path).unwrap(), before);
}

#[test]
fn restore_offline_requires_master_key_for_legacy_share() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("v10.redb");
    seed_legacy_backup(&backup_path, 10, Some(LEGACY_TOKEN));
    let before = fs::read(&backup_path).unwrap();
    seed_db(&db, "light");

    let output = restore(&db, &backup_path, true);
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("AWG_MASTER_KEY"),
        "stderr: {}",
        stderr(&output)
    );
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "light".into()
        })
    );
    assert_eq!(fs::read(&backup_path).unwrap(), before);
}

#[test]
fn restore_offline_upgrades_legacy_share_with_master_key() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    let backup_path = dir.join("v10.redb");
    seed_legacy_backup(&backup_path, 10, Some(LEGACY_TOKEN));
    let before = fs::read(&backup_path).unwrap();
    seed_db(&db, "light");

    let output = command()
        .arg("restore")
        .arg("--db")
        .arg(&db)
        .arg("--from")
        .arg(&backup_path)
        .arg("--offline")
        .env("AWG_MASTER_KEY", MASTER_KEY)
        .output()
        .unwrap();
    assert_success(&output);

    let store = Store::open_with_sealer(
        &db,
        Some(std::sync::Arc::new(
            awg_shared::crypto::Sealer::from_master_key(MASTER_KEY).unwrap(),
        )),
    )
    .unwrap();
    assert_eq!(store.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
    assert_eq!(
        store.get::<Record>(Table::Settings, "theme").unwrap(),
        Some(Record {
            value: "dark".into()
        })
    );
    let hash = awg_shared::crypto::sha256_hex(LEGACY_TOKEN.as_bytes());
    assert!(
        store
            .get::<serde_json::Value>(Table::ShareLinks, &hash)
            .unwrap()
            .is_some()
    );
    drop(store);
    assert_eq!(fs::read(&backup_path).unwrap(), before);
}

#[test]
fn restore_offline_missing_backup_file_is_reported() {
    let dir = TempDir::new();
    let db = dir.join("db.redb");
    seed_db(&db, "light");

    let output = restore(&db, &dir.join("absent.redb"), true);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("backup не найден"));
    assert_eq!(
        read_theme(&db),
        Some(Record {
            value: "light".into()
        })
    );
}

#[test]
fn info_reports_upgradable_legacy_schema() {
    let dir = TempDir::new();
    let backup_path = dir.join("v10.redb");
    seed_legacy_backup(&backup_path, 10, None);

    let output = command()
        .arg("info")
        .arg("--db")
        .arg(&backup_path)
        .output()
        .unwrap();
    assert_success(&output);
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains(&format!(
        "Совместимость: да, restore обновит схему 10 -> {CURRENT_SCHEMA_VERSION}"
    )));
    assert!(text.contains("AWG_MASTER_KEY"));
}
