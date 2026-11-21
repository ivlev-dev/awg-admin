use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::application::CounterRepository;
use crate::domain::CounterBook;

pub struct FileCounterRepository {
    path: PathBuf,
}

impl FileCounterRepository {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    fn backup_path(&self) -> PathBuf {
        self.path.with_extension("json.bak")
    }

    /// Preserve a corrupt snapshot instead of silently overwriting it with
    /// zeros on the next save. The worker itself continues with zero offsets.
    fn quarantine(&self, error: &anyhow::Error) -> Option<PathBuf> {
        let backup = self.backup_path();
        if backup.exists() && fs::remove_file(&backup).is_err() {
            tracing::warn!(path = %backup.display(), "failed to replace the old counter backup");
        }
        match fs::rename(&self.path, &backup) {
            Ok(()) => Some(backup),
            Err(rename_error) => {
                tracing::error!(
                    path = %self.path.display(),
                    %error,
                    %rename_error,
                    "counter snapshot is unreadable and could not be moved aside"
                );
                None
            }
        }
    }
}

impl CounterRepository for FileCounterRepository {
    fn load(&self) -> Result<CounterBook> {
        if !self.path.exists() {
            return Ok(CounterBook::default());
        }
        let parsed = fs::read(&self.path)
            .with_context(|| format!("failed to read {}", self.path.display()))
            .and_then(|data| {
                serde_json::from_slice(&data)
                    .with_context(|| format!("failed to parse {}", self.path.display()))
            });
        match parsed {
            Ok(book) => Ok(book),
            Err(error) => {
                let backup = self.quarantine(&error);
                tracing::error!(
                    path = %self.path.display(),
                    backup = ?backup.as_ref().map(|path| path.display().to_string()),
                    %error,
                    "failed to load counter snapshot; continuing from zero offsets"
                );
                Ok(CounterBook::default())
            }
        }
    }

    fn save(&self, book: &CounterBook) -> Result<()> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let data = serde_json::to_vec_pretty(book)?;
        let tmp = self.path.with_extension("json.tmp");
        let mut file =
            File::create(&tmp).with_context(|| format!("failed to create {}", tmp.display()))?;
        file.write_all(&data)
            .with_context(|| format!("failed to write {}", tmp.display()))?;
        file.sync_all()
            .with_context(|| format!("failed to fsync {}", tmp.display()))?;
        drop(file);
        fs::rename(&tmp, &self.path)
            .with_context(|| format!("failed to replace {}", self.path.display()))?;
        sync_directory(self.path.parent());
        Ok(())
    }
}

fn sync_directory(parent: Option<&Path>) {
    let Some(parent) = parent.filter(|path| !path.as_os_str().is_empty()) else {
        return;
    };
    match File::open(parent) {
        Ok(dir) => {
            if let Err(error) = dir.sync_all() {
                tracing::warn!(path = %parent.display(), %error, "failed to fsync counter directory");
            }
        }
        Err(error) => {
            tracing::warn!(path = %parent.display(), %error, "failed to open counter directory");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_dir() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "awg-worker-counters-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn save_and_load_round_trip_is_atomic() {
        let dir = temp_dir();
        let path = dir.join("counters.json");
        let repo = FileCounterRepository::new(&path);
        let mut book = CounterBook::default();
        book.observe("awg0|peer", 10, 20);
        repo.save(&book).expect("save");

        assert!(path.exists());
        assert!(
            !path.with_extension("json.tmp").exists(),
            "tmp file must be renamed"
        );

        let loaded = repo.load().expect("load");
        assert_eq!(loaded.peers.len(), 1);
        assert_eq!(loaded.peers["awg0|peer"].last_rx, 10);
    }

    #[test]
    fn corrupt_snapshot_is_preserved_as_backup() {
        let dir = temp_dir();
        let path = dir.join("counters.json");
        fs::write(&path, b"{not json").expect("write corrupt file");
        let repo = FileCounterRepository::new(&path);

        let loaded = repo.load().expect("load falls back to zero offsets");
        assert!(loaded.peers.is_empty());
        assert!(!path.exists(), "corrupt file must be moved aside");
        let backup = path.with_extension("json.bak");
        assert!(backup.exists(), "backup {} must exist", backup.display());
        assert_eq!(fs::read(&backup).expect("read backup"), b"{not json");
    }

    #[test]
    fn missing_snapshot_starts_from_zero() {
        let dir = temp_dir();
        let repo = FileCounterRepository::new(dir.join("missing.json"));
        assert!(repo.load().expect("load").peers.is_empty());
    }
}
