use std::sync::Arc;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use crate::domain::{AuditEntry, AuditRepository};

const KEY_OFFSET_MICROS: i64 = 9_000_000_000_000_000;

pub fn audit_key(entry: &AuditEntry) -> String {
    let micros = entry
        .at
        .timestamp_micros()
        .saturating_add(KEY_OFFSET_MICROS);
    format!("{micros:020}:{}", entry.id)
}

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

pub struct RedbAuditRepository {
    store: Arc<Store>,
}

impl RedbAuditRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl AuditRepository for RedbAuditRepository {
    fn record(&self, entry: &AuditEntry) -> CoreResult<()> {
        self.store
            .put(Table::Audit, &audit_key(entry), entry)
            .map_err(map_err)
    }

    fn list(&self, limit: usize) -> CoreResult<Vec<AuditEntry>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let mut keys = self.store.keys(Table::Audit).map_err(map_err)?;
        keys.sort();
        let mut entries = Vec::with_capacity(limit.min(keys.len()));
        for key in keys.into_iter().rev().take(limit) {
            if let Some(entry) = self
                .store
                .get::<AuditEntry>(Table::Audit, &key)
                .map_err(map_err)?
            {
                entries.push(entry);
            }
        }
        Ok(entries)
    }
}
