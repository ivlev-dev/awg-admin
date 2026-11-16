use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use redb::{Database, ReadableDatabase, ReadableTable};

use crate::schema::{self, CURRENT_SCHEMA_VERSION};
use crate::{ALL_TABLES, Result, StorageError, Store};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn backup_to(store: &Store, path: &Path) -> Result<()> {
    reject_store_path(store, path)?;
    create_parent(path)?;

    let temp = temp_path(path);
    let _ = fs::remove_file(&temp);
    let result = write_snapshot(store, &temp)
        .and_then(|()| verify(&temp))
        .and_then(|()| replace_file(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub(crate) fn restore_from(store: &Store, path: &Path) -> Result<()> {
    reject_store_path(store, path)?;
    let backup = open_verified(path)?;
    let version = check_compatible(schema::read_version(&backup)?)?;

    let txn = store.database().begin_write()?;
    for table in ALL_TABLES {
        txn.delete_table(table.definition())?;
    }
    let source = backup.begin_read()?;
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
    schema::write_version_txn(&txn, version)?;
    txn.commit()?;
    Ok(())
}

pub(crate) fn replace_file_from(backup: &Path, target: &Path) -> Result<()> {
    create_parent(target)?;

    let temp = temp_path(target);
    let _ = fs::remove_file(&temp);
    let result = fs::copy(backup, &temp)
        .map_err(StorageError::Io)
        .and_then(|_| {
            sync_file(&temp)?;
            verify(&temp)
        })
        .and_then(|()| replace_file(&temp, target));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn write_snapshot(store: &Store, path: &Path) -> Result<()> {
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
    check_compatible(schema::read_version(&database)?).map(|_| ())
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
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
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

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(
        ".tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    PathBuf::from(name)
}
