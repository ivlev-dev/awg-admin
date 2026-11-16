use std::path::{Path, PathBuf};
use std::sync::Arc;

use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition, backends::InMemoryBackend};
use serde::Serialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

mod backup;
mod schema;

pub use schema::{
    CURRENT_SCHEMA_VERSION, MIGRATIONS, MigrationFn, MigrationStep, SCHEMA_VERSION_KEY,
};

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Db(#[from] redb::DatabaseError),
    #[error("database open error: {0}")]
    Open(#[from] redb::Error),
    #[error("database transaction error: {0}")]
    Transaction(#[from] redb::TransactionError),
    #[error("database table error: {0}")]
    Table(#[from] redb::TableError),
    #[error("database storage error: {0}")]
    Storage(#[from] redb::StorageError),
    #[error("database commit error: {0}")]
    Commit(#[from] redb::CommitError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("store schema version {found} is newer than supported version {supported}")]
    SchemaTooNew { found: u32, supported: u32 },
    #[error("no migration step from schema version {from} to {to}")]
    MissingMigration { from: u32, to: u32 },
    #[error("invalid migration range {from} -> {to}")]
    InvalidMigration { from: u32, to: u32 },
    #[error("invalid schema version value: {0}")]
    InvalidSchemaVersion(String),
    #[error("backup file not found: {0}")]
    BackupNotFound(PathBuf),
    #[error("backup has no schema version")]
    UnversionedBackup,
    #[error("store has no schema version")]
    MissingSchemaVersion,
    #[error("backup schema version {found} is incompatible with supported version {supported}")]
    IncompatibleBackup { found: u32, supported: u32 },
    #[error("backup path conflicts with the open store database: {0}")]
    BackupPathConflict(PathBuf),
}

macro_rules! tables {
    ($($variant:ident => $name:literal),* $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Table {
            $($variant),*
        }

        impl Table {
            pub fn definition(self) -> TableDefinition<'static, &'static str, &'static [u8]> {
                match self {
                    $(Table::$variant => TableDefinition::new($name)),*
                }
            }
        }

        pub const ALL_TABLES: &[Table] = &[$(Table::$variant),*];
    };
}

tables! {
    Users => "users",
    Tariffs => "tariffs",
    Groups => "groups",
    Nodes => "nodes",
    Interfaces => "interfaces",
    CidrPools => "cidr_pools",
    Devices => "devices",
    DevicePeers => "device_peers",
    PeerCounters => "peer_counters",
    TrafficBuckets => "traffic_buckets",
    ShareLinks => "share_links",
    RefreshTokens => "refresh_tokens",
    Settings => "settings",
    Audit => "audit",
    Meta => "meta",
}

#[derive(Debug, Clone)]
pub struct Store {
    db: Arc<Database>,
    path: Option<PathBuf>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let db = Database::create(path)?;
        let store = Self {
            db: Arc::new(db),
            path: Some(path.to_path_buf()),
        };
        schema::initialize(store.database())?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let db = Database::builder().create_with_backend(InMemoryBackend::new())?;
        let store = Self {
            db: Arc::new(db),
            path: None,
        };
        schema::initialize(store.database())?;
        Ok(store)
    }

    pub(crate) fn database(&self) -> &Database {
        &self.db
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn schema_version(&self) -> Result<u32> {
        schema::read_version(self.database())?.ok_or(StorageError::MissingSchemaVersion)
    }

    pub fn backup_to(&self, path: impl AsRef<Path>) -> Result<()> {
        backup::backup_to(self, path.as_ref())
    }

    pub fn restore_from(&self, path: impl AsRef<Path>) -> Result<()> {
        backup::restore_from(self, path.as_ref())
    }

    pub fn replace_file_from(backup: impl AsRef<Path>, target: impl AsRef<Path>) -> Result<()> {
        backup::replace_file_from(backup.as_ref(), target.as_ref())
    }

    pub fn get<T: DeserializeOwned>(&self, table: Table, key: &str) -> Result<Option<T>> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let Some(bytes) = table.get(key)? else {
            return Ok(None);
        };
        Ok(Some(serde_json::from_slice(bytes.value())?))
    }

    pub fn put<T: Serialize>(&self, table: Table, key: &str, value: &T) -> Result<()> {
        let bytes = serde_json::to_vec(value)?;
        let txn = self.db.begin_write()?;
        {
            let mut table = txn.open_table(table.definition())?;
            table.insert(key, bytes.as_slice())?;
        }
        txn.commit()?;
        Ok(())
    }

    pub fn put_many<T: Serialize>(&self, entries: &[(Table, String, T)]) -> Result<()> {
        let txn = self.db.begin_write()?;
        for (table, _, _) in entries {
            txn.open_table(table.definition())?;
        }
        for (table, key, value) in entries {
            let bytes = serde_json::to_vec(value)?;
            let mut t = txn.open_table(table.definition())?;
            t.insert(key.as_str(), bytes.as_slice())?;
        }
        txn.commit()?;
        Ok(())
    }

    pub fn delete(&self, table: Table, key: &str) -> Result<()> {
        let txn = self.db.begin_write()?;
        {
            let mut t = txn.open_table(table.definition())?;
            t.remove(key)?;
        }
        txn.commit()?;
        Ok(())
    }

    pub fn delete_prefix(&self, table: Table, prefix: &str) -> Result<usize> {
        let txn = self.db.begin_write()?;
        let mut removed = 0;
        {
            let mut t = txn.open_table(table.definition())?;
            let keys: Vec<String> = t
                .iter()?
                .filter_map(|entry| entry.ok().map(|(k, _)| k.value().to_string()))
                .filter(|k| k.starts_with(prefix))
                .collect();
            for key in keys {
                t.remove(key.as_str())?;
                removed += 1;
            }
        }
        txn.commit()?;
        Ok(removed)
    }

    pub fn list<T: DeserializeOwned>(&self, table: Table) -> Result<Vec<T>> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let mut out = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            out.push(serde_json::from_slice(value.value())?);
        }
        Ok(out)
    }

    pub fn list_prefix<T: DeserializeOwned>(
        &self,
        table: Table,
        prefix: &str,
    ) -> Result<Vec<(String, T)>> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let mut out = Vec::new();
        for entry in table.iter()? {
            let (key, value) = entry?;
            let key = key.value().to_string();
            if key.starts_with(prefix) {
                out.push((key, serde_json::from_slice(value.value())?));
            }
        }
        Ok(out)
    }

    pub fn keys(&self, table: Table) -> Result<Vec<String>> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let mut out = Vec::new();
        for entry in table.iter()? {
            let (key, _) = entry?;
            out.push(key.value().to_string());
        }
        Ok(out)
    }

    pub fn count(&self, table: Table) -> Result<usize> {
        Ok(self.keys(table)?.len())
    }
}
