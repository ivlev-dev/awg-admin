use std::path::{Path, PathBuf};
use std::sync::Arc;

use awg_shared::crypto::Sealer;
use redb::{
    ConcurrencyMode, Database, ReadTransaction, ReadableDatabase, ReadableTable, TableDefinition,
    WriteTransaction, backends::InMemoryBackend,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

mod backup;
pub mod device_index;
mod schema;
pub mod user_index;

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
    #[error("secret operation failed: {0}")]
    Secret(String),
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
    DevicePageIndex => "device_page_index",
    DeviceCreatedIndex => "device_created_index",
    UserPageIndex => "user_page_index",
    PeerCounters => "peer_counters",
    TrafficBuckets => "traffic_buckets",
    ShareLinks => "share_links",
    RefreshTokens => "refresh_tokens",
    EmailVerifications => "email_verifications",
    Settings => "settings",
    Audit => "audit",
    Meta => "meta",
    BillingPlans => "billing_plans",
    BillingSubscriptions => "billing_subscriptions",
    BillingInvoices => "billing_invoices",
    BillingPaymentMethods => "billing_payment_methods",
    BillingEvents => "billing_events",
    RateLimits => "rate_limits",
    Idempotency => "idempotency",
}

#[derive(Debug, Clone)]
pub struct Store {
    db: Arc<Database>,
    path: Option<PathBuf>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_sealer(path, None)
    }

    pub fn open_with_sealer(path: impl AsRef<Path>, sealer: Option<Arc<Sealer>>) -> Result<Self> {
        let path = path.as_ref();
        let db = Database::create(path)?;
        let store = Self {
            db: Arc::new(db),
            path: Some(path.to_path_buf()),
        };
        schema::initialize_with(store.database(), sealer.as_deref())?;
        Ok(store)
    }

    pub fn open_multi_writer(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_multi_writer_with_sealer(path, None)
    }

    pub fn open_multi_writer_with_sealer(
        path: impl AsRef<Path>,
        sealer: Option<Arc<Sealer>>,
    ) -> Result<Self> {
        let path = path.as_ref();
        let db = Database::builder()
            .set_concurrency_mode(ConcurrencyMode::MultiWriter)
            .create(path)?;
        let store = Self {
            db: Arc::new(db),
            path: Some(path.to_path_buf()),
        };
        schema::initialize_with(store.database(), sealer.as_deref())?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::open_in_memory_with_sealer(None)
    }

    pub fn open_in_memory_with_sealer(sealer: Option<Arc<Sealer>>) -> Result<Self> {
        let db = Database::builder().create_with_backend(InMemoryBackend::new())?;
        let store = Self {
            db: Arc::new(db),
            path: None,
        };
        schema::initialize_with(store.database(), sealer.as_deref())?;
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

    pub fn get_raw(&self, table: Table, key: &str) -> Result<Option<Vec<u8>>> {
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let Some(bytes) = table.get(key)? else {
            return Ok(None);
        };
        Ok(Some(bytes.value().to_vec()))
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

    pub fn update<T, R>(
        &self,
        table: Table,
        key: &str,
        apply: impl FnOnce(Option<T>) -> (Option<T>, R),
    ) -> Result<R>
    where
        T: Serialize + DeserializeOwned,
    {
        let txn = self.db.begin_write()?;
        let output = {
            let mut t = txn.open_table(table.definition())?;
            let current = match t.get(key)? {
                Some(value) => Some(serde_json::from_slice(value.value())?),
                None => None,
            };
            let (next, output) = apply(current);
            match next {
                Some(value) => {
                    let bytes = serde_json::to_vec(&value)?;
                    t.insert(key, bytes.as_slice())?;
                }
                None => {
                    t.remove(key)?;
                }
            }
            output
        };
        txn.commit()?;
        Ok(output)
    }

    pub fn retain<T>(&self, table: Table, mut keep: impl FnMut(&str, &T) -> bool) -> Result<usize>
    where
        T: DeserializeOwned,
    {
        let txn = self.db.begin_write()?;
        let mut removed = 0;
        {
            let mut t = txn.open_table(table.definition())?;
            let mut stale = Vec::new();
            for entry in t.iter()? {
                let (key, value) = entry?;
                let key = key.value().to_string();
                let value: T = serde_json::from_slice(value.value())?;
                if !keep(&key, &value) {
                    stale.push(key);
                }
            }
            for key in stale {
                t.remove(key.as_str())?;
                removed += 1;
            }
        }
        txn.commit()?;
        Ok(removed)
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

    pub fn delete_many(&self, table: Table, keys: &[String]) -> Result<usize> {
        if keys.is_empty() {
            return Ok(0);
        }
        let txn = self.db.begin_write()?;
        {
            let mut t = txn.open_table(table.definition())?;
            for key in keys {
                t.remove(key.as_str())?;
            }
        }
        txn.commit()?;
        Ok(keys.len())
    }

    /// Removes entries in bounded write transactions so that pruning a large
    /// table does not block writers for an unbounded amount of time.
    pub fn retain_chunked<T>(
        &self,
        table: Table,
        chunk_size: usize,
        mut keep: impl FnMut(&str, &T) -> bool,
    ) -> Result<(usize, usize)>
    where
        T: DeserializeOwned,
    {
        let stale: Vec<String> = {
            let txn = self.db.begin_read()?;
            let t = txn.open_table(table.definition())?;
            let mut stale = Vec::new();
            for entry in t.iter()? {
                let (key, value) = entry?;
                let key = key.value().to_string();
                let value: T = serde_json::from_slice(value.value())?;
                if !keep(&key, &value) {
                    stale.push(key);
                }
            }
            stale
        };
        let chunk_size = chunk_size.max(1);
        let mut removed = 0;
        let mut chunks = 0;
        for chunk in stale.chunks(chunk_size) {
            removed += self.delete_many(table, chunk)?;
            chunks += 1;
        }
        Ok((removed, chunks))
    }

    pub fn delete_prefix(&self, table: Table, prefix: &str) -> Result<usize> {
        let txn = self.db.begin_write()?;
        let mut removed = 0;
        {
            let mut t = txn.open_table(table.definition())?;
            let keys: Vec<String> = match prefix_upper_bound(prefix) {
                Some(upper) => t
                    .range::<&str>(prefix..upper.as_str())?
                    .map(|entry| entry.map(|(key, _)| key.value().to_string()))
                    .collect::<std::result::Result<Vec<_>, _>>()?,
                None => t
                    .range::<&str>(prefix..)?
                    .map(|entry| entry.map(|(key, _)| key.value().to_string()))
                    .collect::<std::result::Result<Vec<_>, _>>()?,
            };
            for key in keys {
                t.remove(key.as_str())?;
                removed += 1;
            }
        }
        txn.commit()?;
        Ok(removed)
    }

    pub fn get_many<T: DeserializeOwned>(&self, table: Table, keys: &[String]) -> Result<Vec<T>> {
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let mut out = Vec::with_capacity(keys.len());
        for key in keys {
            let Some(bytes) = table.get(key.as_str())? else {
                continue;
            };
            out.push(serde_json::from_slice(bytes.value())?);
        }
        Ok(out)
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
        let upper = prefix_upper_bound(prefix);
        match upper {
            Some(upper) => {
                for entry in table.range::<&str>(prefix..upper.as_str())? {
                    let (key, value) = entry?;
                    out.push((
                        key.value().to_string(),
                        serde_json::from_slice(value.value())?,
                    ));
                }
            }
            None => {
                for entry in table.range::<&str>(prefix..)? {
                    let (key, value) = entry?;
                    out.push((
                        key.value().to_string(),
                        serde_json::from_slice(value.value())?,
                    ));
                }
            }
        }
        Ok(out)
    }

    pub fn scan_rev<T: DeserializeOwned>(
        &self,
        table: Table,
        before: Option<&str>,
        limit: usize,
        mut keep: impl FnMut(&str, &T) -> bool,
    ) -> Result<(Vec<(String, T)>, bool)> {
        if limit == 0 {
            return Ok((Vec::new(), false));
        }
        let txn = self.db.begin_read()?;
        let table = txn.open_table(table.definition())?;
        let mut out: Vec<(String, T)> = Vec::with_capacity(limit);
        let mut has_more = false;
        macro_rules! drain {
            ($range:expr) => {
                for entry in $range {
                    let (key, value) = entry?;
                    let key = key.value().to_string();
                    let value: T = serde_json::from_slice(value.value())?;
                    if !keep(&key, &value) {
                        continue;
                    }
                    if out.len() == limit {
                        has_more = true;
                        break;
                    }
                    out.push((key, value));
                }
            };
        }
        match before {
            Some(cursor) => drain!(table.range::<&str>(..cursor)?.rev()),
            None => drain!(table.range::<&str>(..)?.rev()),
        }
        Ok((out, has_more))
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

    pub fn with_read_txn<R>(&self, apply: impl FnOnce(&ReadTransaction) -> Result<R>) -> Result<R> {
        let txn = self.db.begin_read()?;
        apply(&txn)
    }

    pub fn with_write_txn<R>(
        &self,
        apply: impl FnOnce(&WriteTransaction) -> Result<R>,
    ) -> Result<R> {
        let txn = self.db.begin_write()?;
        let output = apply(&txn)?;
        txn.commit()?;
        Ok(output)
    }

    pub fn count(&self, table: Table) -> Result<usize> {
        Ok(self.keys(table)?.len())
    }
}

pub fn prefix_upper_bound(prefix: &str) -> Option<String> {
    let mut bytes = prefix.as_bytes().to_vec();
    while let Some(last) = bytes.pop() {
        if last < u8::MAX {
            bytes.push(last + 1);
            return String::from_utf8(bytes).ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use super::*;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Counter {
        value: u64,
    }

    #[test]
    fn update_creates_mutates_and_removes_entries() {
        let store = Store::open_in_memory().unwrap();

        let created = store
            .update::<Counter, _>(Table::RateLimits, "key", |current| {
                assert!(current.is_none());
                (Some(Counter { value: 1 }), 1u64)
            })
            .unwrap();
        assert_eq!(created, 1);
        assert_eq!(
            store.get::<Counter>(Table::RateLimits, "key").unwrap(),
            Some(Counter { value: 1 })
        );

        let updated = store
            .update::<Counter, _>(Table::RateLimits, "key", |current| {
                let mut counter = current.unwrap();
                counter.value += 1;
                (Some(counter), 2u64)
            })
            .unwrap();
        assert_eq!(updated, 2);
        assert_eq!(
            store.get::<Counter>(Table::RateLimits, "key").unwrap(),
            Some(Counter { value: 2 })
        );

        store
            .update::<Counter, _>(Table::RateLimits, "key", |_| (None, ()))
            .unwrap();
        assert_eq!(
            store.get::<Counter>(Table::RateLimits, "key").unwrap(),
            None
        );
    }

    #[test]
    fn retain_removes_only_rejected_entries() {
        let store = Store::open_in_memory().unwrap();
        store
            .put(Table::RateLimits, "keep", &Counter { value: 1 })
            .unwrap();
        store
            .put(Table::RateLimits, "drop", &Counter { value: 2 })
            .unwrap();

        let removed = store
            .retain::<Counter>(Table::RateLimits, |_, counter| counter.value == 1)
            .unwrap();

        assert_eq!(removed, 1);
        assert_eq!(store.keys(Table::RateLimits).unwrap(), vec!["keep"]);
    }

    #[test]
    fn list_prefix_reads_only_the_matching_range() {
        let store = Store::open_in_memory().unwrap();
        store
            .put(Table::RateLimits, "aa:1", &Counter { value: 1 })
            .unwrap();
        store
            .put(Table::RateLimits, "aa:2", &Counter { value: 2 })
            .unwrap();
        store
            .put(Table::RateLimits, "aa0", &Counter { value: 9 })
            .unwrap();
        store
            .put(Table::RateLimits, "ab", &"not a counter".to_string())
            .unwrap();
        store
            .put(Table::RateLimits, "zz", &"not a counter".to_string())
            .unwrap();

        let entries: Vec<(String, Counter)> = store
            .list_prefix(Table::RateLimits, "aa:")
            .expect("unrelated values must not be deserialized");
        assert_eq!(
            entries,
            vec![
                ("aa:1".to_string(), Counter { value: 1 }),
                ("aa:2".to_string(), Counter { value: 2 }),
            ]
        );
        assert_eq!(store.count(Table::RateLimits).unwrap(), 5);
    }

    #[test]
    fn delete_prefix_removes_only_the_matching_range() {
        let store = Store::open_in_memory().unwrap();
        for key in ["a", "b:1", "b:2", "b0", "c"] {
            store
                .put(Table::RateLimits, key, &Counter { value: 1 })
                .unwrap();
        }

        assert_eq!(store.delete_prefix(Table::RateLimits, "b:").unwrap(), 2);

        let keys = store.keys(Table::RateLimits).unwrap();
        assert_eq!(keys, vec!["a", "b0", "c"]);
    }

    #[test]
    fn empty_prefix_touches_all_keys() {
        let store = Store::open_in_memory().unwrap();
        for key in ["a", "b"] {
            store
                .put(Table::RateLimits, key, &Counter { value: 1 })
                .unwrap();
        }
        assert_eq!(
            store
                .list_prefix::<Counter>(Table::RateLimits, "")
                .unwrap()
                .len(),
            2
        );
        assert_eq!(store.delete_prefix(Table::RateLimits, "").unwrap(), 2);
        assert_eq!(store.count(Table::RateLimits).unwrap(), 0);
    }

    #[test]
    fn scan_rev_walks_backwards_with_a_limit() {
        let store = Store::open_in_memory().unwrap();
        for (key, value) in [("001", 1), ("002", 2), ("003", 3), ("004", 4)] {
            store
                .put(Table::RateLimits, key, &Counter { value })
                .unwrap();
        }

        let (page, has_more) = store
            .scan_rev::<Counter>(Table::RateLimits, None, 2, |_, _| true)
            .unwrap();
        assert!(has_more);
        assert_eq!(
            page.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
            vec!["004", "003"]
        );

        let (page, has_more) = store
            .scan_rev::<Counter>(Table::RateLimits, Some("003"), 2, |_, counter| {
                counter.value != 2
            })
            .unwrap();
        assert!(!has_more);
        assert_eq!(
            page.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
            vec!["001"]
        );
    }

    #[test]
    fn scan_rev_reports_more_when_a_filtered_row_follows() {
        let store = Store::open_in_memory().unwrap();
        for (key, value) in [("001", 1), ("002", 2), ("003", 3)] {
            store
                .put(Table::RateLimits, key, &Counter { value })
                .unwrap();
        }
        let (page, has_more) = store
            .scan_rev::<Counter>(Table::RateLimits, None, 1, |_, _| true)
            .unwrap();
        assert!(has_more);
        assert_eq!(page.len(), 1);
    }

    #[test]
    fn multi_writer_handles_share_one_file() {
        let path = std::env::temp_dir().join(format!(
            "awg-storage-multi-writer-{}.redb",
            uuid::Uuid::new_v4()
        ));
        let first = Store::open_multi_writer(&path).unwrap();
        let second = Store::open_multi_writer(&path).unwrap();

        first
            .put(Table::RateLimits, "shared", &Counter { value: 1 })
            .unwrap();
        assert_eq!(
            second.get::<Counter>(Table::RateLimits, "shared").unwrap(),
            Some(Counter { value: 1 })
        );

        second
            .put(Table::RateLimits, "shared", &Counter { value: 2 })
            .unwrap();
        assert_eq!(
            first.get::<Counter>(Table::RateLimits, "shared").unwrap(),
            Some(Counter { value: 2 })
        );

        drop(first);
        drop(second);
        let _ = std::fs::remove_file(&path);
    }
}
