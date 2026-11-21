use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use awg_shared::crypto::Sealer;
use redb::{Database, ReadOnlyDatabase, ReadableDatabase, ReadableTable};
use serde_json::Value;

use crate::schema::{self, CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY};
use crate::{ALL_TABLES, Result, StorageError, Store, Table};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Tables that may carry values sealed with the master key.
const SEALED_TABLES: &[Table] = &[
    Table::Users,
    Table::Devices,
    Table::DevicePeers,
    Table::ShareLinks,
];

pub(crate) fn backup_to(store: &Store, path: &Path) -> Result<()> {
    reject_store_path(store, path)?;
    create_parent_private(path)?;

    let temp = temp_path(path);
    let _ = fs::remove_file(&temp);
    let result = write_snapshot(store, &temp)
        .and_then(|()| verify(&temp))
        .and_then(|()| replace_file(&temp, path))
        .and_then(|()| set_private_file_permissions(path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub(crate) fn restore_from(store: &Store, path: &Path, sealer: Option<Arc<Sealer>>) -> Result<()> {
    reject_store_path(store, path)?;
    let backup = open_backup(path)?;
    let version = restorable_version(&backup)?;
    check_backup_key(&backup, sealer.as_deref())?;

    if version == CURRENT_SCHEMA_VERSION {
        return copy_tables(store, &backup);
    }

    let staged = stage_migrated_copy(path, &staging_dir(store.path()), sealer.as_deref())?;
    let result = copy_tables(store, &open_backup(&staged)?);
    let _ = fs::remove_file(&staged);
    result
}

pub(crate) fn replace_file_from(
    backup: &Path,
    target: &Path,
    sealer: Option<Arc<Sealer>>,
) -> Result<()> {
    create_parent(target)?;
    let version = restorable_version(&open_backup(backup)?)?;

    let temp = temp_path(target);
    let _ = fs::remove_file(&temp);
    let result = (|| {
        fs::copy(backup, &temp).map_err(StorageError::Io)?;
        set_private_file_permissions(&temp)?;
        make_writable(&temp)?;
        sync_file(&temp)?;
        if version != CURRENT_SCHEMA_VERSION {
            drop(Store::open_with_sealer(&temp, sealer)?);
        }
        verify(&temp)?;
        replace_file(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn copy_tables(store: &Store, source_db: &ReadOnlyDatabase) -> Result<()> {
    let txn = store.database().begin_write()?;
    for table in ALL_TABLES {
        txn.delete_table(table.definition())?;
    }
    let source = source_db.begin_read()?;
    for table in ALL_TABLES {
        let mut target = txn.open_table(table.definition())?;
        match source.open_table(table.definition()) {
            Ok(source) => {
                for entry in source.iter()? {
                    let (key, value) = entry?;
                    target.insert(key.value(), value.value())?;
                }
            }
            Err(redb::TableError::TableDoesNotExist(_)) => {}
            Err(err) => return Err(err.into()),
        }
    }
    schema::write_version_txn(&txn, CURRENT_SCHEMA_VERSION)?;
    txn.commit()?;
    Ok(())
}

fn stage_migrated_copy(source: &Path, dir: &Path, sealer: Option<&Sealer>) -> Result<PathBuf> {
    create_dir_private(dir)?;
    let staged = staging_path(dir, source);
    let _ = fs::remove_file(&staged);
    let result = (|| {
        fs::copy(source, &staged).map_err(StorageError::Io)?;
        set_private_file_permissions(&staged)?;
        make_writable(&staged)?;
        drop(Store::open_with_sealer(
            &staged,
            sealer.cloned().map(Arc::new),
        )?);
        verify(&staged)
    })();
    match result {
        Ok(()) => Ok(staged),
        Err(err) => {
            let _ = fs::remove_file(&staged);
            Err(err)
        }
    }
}

fn write_snapshot(store: &Store, path: &Path) -> Result<()> {
    create_private_file(path)?;
    let database = Database::create(path)?;
    let txn = database.begin_write()?;
    {
        let source = store.database().begin_read()?;
        for table in ALL_TABLES {
            let mut target = txn.open_table(table.definition())?;
            match source.open_table(table.definition()) {
                Ok(source) => {
                    for entry in source.iter()? {
                        let (key, value) = entry?;
                        target.insert(key.value(), value.value())?;
                    }
                }
                Err(redb::TableError::TableDoesNotExist(_)) => {}
                Err(err) => return Err(err.into()),
            }
        }
    }
    schema::write_version_txn(&txn, CURRENT_SCHEMA_VERSION)?;
    txn.commit()?;
    drop(database);
    Ok(())
}

fn open_backup(path: &Path) -> Result<ReadOnlyDatabase> {
    if !path.is_file() {
        return Err(StorageError::BackupNotFound(path.to_path_buf()));
    }
    Ok(Database::builder()
        .set_check_integrity_on_open(true)
        .open_read_only(path)?)
}

fn open_verified(path: &Path) -> Result<Database> {
    if !path.is_file() {
        return Err(StorageError::BackupNotFound(path.to_path_buf()));
    }
    Ok(Database::builder()
        .set_check_integrity_on_open(true)
        .open(path)?)
}

fn verify(path: &Path) -> Result<()> {
    let database = open_verified(path)?;
    check_compatible(read_version(&database)?).map(|_| ())
}

fn restorable_version(backup: &impl ReadableDatabase) -> Result<u32> {
    match read_version(backup)? {
        None => Err(StorageError::UnversionedBackup),
        Some(version) if version > CURRENT_SCHEMA_VERSION => {
            Err(StorageError::IncompatibleBackup {
                found: version,
                supported: CURRENT_SCHEMA_VERSION,
            })
        }
        Some(version) => Ok(version),
    }
}

fn read_version(db: &impl ReadableDatabase) -> Result<Option<u32>> {
    let txn = db.begin_read()?;
    let table = match txn.open_table(Table::Meta.definition()) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    let Some(raw) = table.get(SCHEMA_VERSION_KEY)? else {
        return Ok(None);
    };
    serde_json::from_slice(raw.value())
        .map(Some)
        .map_err(|err| StorageError::InvalidSchemaVersion(err.to_string()))
}

fn check_compatible(version: Option<u32>) -> Result<u32> {
    match version {
        None => Err(StorageError::UnversionedBackup),
        Some(version) if version == CURRENT_SCHEMA_VERSION => Ok(version),
        Some(version) => Err(StorageError::IncompatibleBackup {
            found: version,
            supported: CURRENT_SCHEMA_VERSION,
        }),
    }
}

/// Verifies that the master key of the running process can open at least one
/// sealed value from the backup. A backup sealed with a different key would
/// restore successfully but leave every secret unreadable, so the restore is
/// refused before the target store is touched. Backups without sealed values
/// and callers without a sealer skip the check.
fn check_backup_key(backup: &impl ReadableDatabase, sealer: Option<&Sealer>) -> Result<()> {
    let Some(sealer) = sealer else {
        return Ok(());
    };
    let txn = backup.begin_read()?;
    let mut found_sealed = false;
    for table in SEALED_TABLES {
        let table = match txn.open_table(table.definition()) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => continue,
            Err(err) => return Err(err.into()),
        };
        for entry in table.iter()? {
            let (_, value) = entry?;
            let parsed: Value = serde_json::from_slice(value.value())?;
            let Value::Object(fields) = &parsed else {
                continue;
            };
            for (field, value) in fields {
                let Some(raw) = value.as_str() else {
                    continue;
                };
                if !field.ends_with("_sealed") || raw.is_empty() {
                    continue;
                }
                found_sealed = true;
                if sealer.open_str(raw).is_ok() {
                    return Ok(());
                }
            }
        }
    }
    if found_sealed {
        return Err(StorageError::BackupKeyMismatch);
    }
    Ok(())
}

fn reject_store_path(store: &Store, path: &Path) -> Result<()> {
    if let Some(current) = store.path()
        && is_same_file(current, path)
    {
        return Err(StorageError::BackupPathConflict(path.to_path_buf()));
    }
    Ok(())
}

fn is_same_file(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn create_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        create_dir(parent)?;
    }
    Ok(())
}

/// Creates the directory that will hold a backup with owner-only access.
fn create_parent_private(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        create_dir_private(parent)?;
    }
    Ok(())
}

fn create_dir(dir: &Path) -> Result<()> {
    if !dir.as_os_str().is_empty() {
        fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// Creates the directory with mode 0700 when it does not exist yet. Existing
/// directories are left untouched.
fn create_dir_private(dir: &Path) -> Result<()> {
    if dir.as_os_str().is_empty() || dir.exists() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// Creates `path` as an empty owner-only file so the database is never readable
/// by other users, not even between creation and the first write.
fn create_private_file(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
    }
    #[cfg(not(unix))]
    {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn make_writable(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)?.permissions();
        if permissions.mode() & 0o200 == 0 {
            permissions.set_mode(permissions.mode() | 0o600);
            fs::set_permissions(path, permissions)?;
        }
    }
    #[cfg(not(unix))]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        if permissions.readonly() {
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions)?;
        }
    }
    Ok(())
}

fn replace_file(temp: &Path, target: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::rename(temp, target)?;
    #[cfg(not(unix))]
    {
        if target.exists() {
            fs::remove_file(target)?;
        }
        fs::rename(temp, target)?;
    }
    sync_parent(target);
    Ok(())
}

fn sync_file(path: &Path) -> Result<()> {
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

fn sync_parent(path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        let _ = fs::File::open(parent).and_then(|dir| dir.sync_all());
    }
}

fn staging_dir(store_path: Option<&Path>) -> PathBuf {
    store_path
        .and_then(Path::parent)
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir)
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(
        ".tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    PathBuf::from(name)
}

fn staging_path(dir: &Path, source: &Path) -> PathBuf {
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "backup".to_string());
    dir.join(format!(
        "{name}.restore-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}
