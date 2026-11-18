use std::sync::Arc;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use chrono::{DateTime, Utc};

use crate::domain::{AuditEntry, AuditFilter, AuditPage, AuditRepository, validate_audit_cursor};

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

    fn list_page_filtered(
        &self,
        limit: usize,
        before: Option<&str>,
        filter: &AuditFilter,
    ) -> CoreResult<AuditPage> {
        if limit == 0 {
            return Ok(AuditPage {
                items: Vec::new(),
                next_cursor: None,
            });
        }
        if let Some(cursor) = before {
            validate_audit_cursor(cursor)?;
        }
        filter.validate()?;

        let (entries, has_more) = self
            .store
            .scan_rev::<AuditEntry>(Table::Audit, before, limit, |_, entry| {
                filter.matches(entry)
            })
            .map_err(map_err)?;

        let next_cursor = if has_more {
            entries.last().map(|(key, _)| key.clone())
        } else {
            None
        };
        let items = entries.into_iter().map(|(_, entry)| entry).collect();

        Ok(AuditPage { items, next_cursor })
    }

    fn delete_filtered(&self, filter: &AuditFilter) -> CoreResult<usize> {
        filter.validate()?;
        self.store
            .retain::<AuditEntry>(Table::Audit, |_, entry| !filter.matches(entry))
            .map_err(map_err)
    }

    fn prune(&self, before: DateTime<Utc>) -> CoreResult<usize> {
        self.store
            .retain::<AuditEntry>(Table::Audit, |_, entry| entry.at >= before)
            .map_err(map_err)
    }
}
