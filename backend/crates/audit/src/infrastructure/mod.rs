use std::sync::Arc;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use chrono::{DateTime, Utc};

use crate::domain::{AuditEntry, AuditPage, AuditRepository, validate_audit_cursor};

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

    fn list_page(&self, limit: usize, before: Option<&str>) -> CoreResult<AuditPage> {
        if limit == 0 {
            return Ok(AuditPage {
                items: Vec::new(),
                next_cursor: None,
            });
        }
        if let Some(cursor) = before {
            validate_audit_cursor(cursor)?;
        }

        let mut keys = self.store.keys(Table::Audit).map_err(map_err)?;
        keys.sort();
        let filtered: Vec<String> = match before {
            Some(cursor) => keys
                .into_iter()
                .filter(|key| key.as_str() < cursor)
                .collect(),
            None => keys,
        };

        let total = filtered.len();
        let start = total.saturating_sub(limit);
        let mut page_keys: Vec<String> = filtered[start..].to_vec();
        page_keys.reverse();

        let mut items = Vec::with_capacity(page_keys.len());
        for key in &page_keys {
            if let Some(entry) = self
                .store
                .get::<AuditEntry>(Table::Audit, key)
                .map_err(map_err)?
            {
                items.push(entry);
            }
        }

        let next_cursor = if start > 0 && !page_keys.is_empty() {
            page_keys.last().cloned()
        } else {
            None
        };

        Ok(AuditPage { items, next_cursor })
    }

    fn prune(&self, before: DateTime<Utc>) -> CoreResult<usize> {
        let keys = self.store.keys(Table::Audit).map_err(map_err)?;
        let mut removed = 0;
        for key in keys {
            if let Some(entry) = self
                .store
                .get::<AuditEntry>(Table::Audit, &key)
                .map_err(map_err)?
                && entry.at < before
            {
                self.store.delete(Table::Audit, &key).map_err(map_err)?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}
