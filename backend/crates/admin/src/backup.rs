use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};

use awg_storage::{Result as StorageResult, Store};

pub const BACKUP_PREFIX: &str = "awg-admin-";
pub const BACKUP_SUFFIX: &str = ".redb";

pub fn backup_file_name(at: DateTime<Utc>) -> String {
    format!(
        "{BACKUP_PREFIX}{}{BACKUP_SUFFIX}",
        at.format("%Y%m%dT%H%M%SZ")
    )
}

pub fn prune(dir: &Path, keep: usize) -> StorageResult<usize> {
    let keep = keep.max(1);
    let mut files = list_backups(dir).map_err(storage_error)?;
    files.sort();
    let remove = files.len().saturating_sub(keep);
    let mut removed = 0;
    for path in files.into_iter().take(remove) {
        std::fs::remove_file(&path).map_err(storage_error)?;
        removed += 1;
    }
    Ok(removed)
}

fn list_backups(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX) {
            files.push(entry.path());
        }
    }
    Ok(files)
}

fn storage_error(error: std::io::Error) -> awg_storage::StorageError {
    awg_storage::StorageError::Io(error)
}

pub fn backup_now(store: &Store, dir: &Path, keep: usize) -> StorageResult<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(backup_file_name(Utc::now()));
    store.backup_to(&path)?;
    let removed = prune(dir, keep)?;
    tracing::info!(path = %path.display(), removed, "created database backup");
    Ok(path)
}

pub fn spawn(
    store: Arc<Store>,
    dir: PathBuf,
    interval_secs: u64,
    keep: usize,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs.max(1)));
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = wait_for_shutdown(&mut shutdown) => break,
            }
            if let Err(error) = backup_now(&store, &dir, keep) {
                tracing::warn!(%error, dir = %dir.display(), "failed to create database backup");
            }
        }
    })
}

async fn wait_for_shutdown(shutdown: &mut tokio::sync::watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    while shutdown.changed().await.is_ok() {
        if *shutdown.borrow() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs::File;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("awg-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backup_name_contains_utc_timestamp() {
        let at = DateTime::parse_from_rfc3339("2026-11-17T12:34:56Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(backup_file_name(at), "awg-admin-20261117T123456Z.redb");
    }

    #[test]
    fn prune_keeps_newest_files_and_ignores_others() {
        let dir = temp_dir("prune");
        for name in [
            "awg-admin-20260101T000000Z.redb",
            "awg-admin-20260201T000000Z.redb",
            "awg-admin-20260301T000000Z.redb",
            "notes.txt",
        ] {
            File::create(dir.join(name)).unwrap();
        }

        assert_eq!(prune(&dir, 2).unwrap(), 1);
        let mut remaining: Vec<String> = list_backups(&dir)
            .unwrap()
            .into_iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        remaining.sort();
        assert_eq!(
            remaining,
            vec![
                "awg-admin-20260201T000000Z.redb".to_string(),
                "awg-admin-20260301T000000Z.redb".to_string()
            ]
        );
        assert!(dir.join("notes.txt").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_without_files_is_a_noop() {
        let dir = temp_dir("empty");
        assert_eq!(prune(&dir, 5).unwrap(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_keeps_at_least_one_file() {
        let dir = temp_dir("minimum");
        File::create(dir.join("awg-admin-20260101T000000Z.redb")).unwrap();
        assert_eq!(prune(&dir, 0).unwrap(), 0);
        assert!(dir.join("awg-admin-20260101T000000Z.redb").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
