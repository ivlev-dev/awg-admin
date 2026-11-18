use std::sync::Arc;

use awg_shared::CoreResult;

use chrono::{DateTime, Utc};

use crate::domain::{
    AuditEntry, AuditFilter, AuditPage, AuditRepository, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT,
    NewAuditEntry, validate_audit_cursor,
};

pub struct AuditService {
    repo: Arc<dyn AuditRepository>,
}

impl AuditService {
    pub fn new(repo: Arc<dyn AuditRepository>) -> Self {
        Self { repo }
    }

    pub fn record(&self, entry: AuditEntry) -> CoreResult<()> {
        entry.validate()?;
        self.repo.record(&entry)
    }

    pub fn log(&self, input: NewAuditEntry) -> CoreResult<AuditEntry> {
        let entry = AuditEntry::from_new(input);
        self.record(entry.clone())?;
        Ok(entry)
    }

    pub fn list(&self, limit: usize) -> CoreResult<Vec<AuditEntry>> {
        Ok(self
            .list_page_filtered(limit, None, &AuditFilter::default())?
            .items)
    }

    pub fn list_page(&self, limit: usize, before: Option<&str>) -> CoreResult<AuditPage> {
        self.list_page_filtered(limit, before, &AuditFilter::default())
    }

    pub fn list_page_filtered(
        &self,
        limit: usize,
        before: Option<&str>,
        filter: &AuditFilter,
    ) -> CoreResult<AuditPage> {
        let limit = if limit == 0 {
            DEFAULT_AUDIT_LIMIT
        } else {
            limit.clamp(1, MAX_AUDIT_LIMIT)
        };
        if let Some(cursor) = before {
            validate_audit_cursor(cursor)?;
        }
        filter.validate()?;
        self.repo.list_page_filtered(limit, before, filter)
    }

    pub fn delete_filtered(&self, filter: &AuditFilter) -> CoreResult<usize> {
        filter.validate()?;
        self.repo.delete_filtered(filter)
    }

    pub fn prune(&self, before: DateTime<Utc>) -> CoreResult<usize> {
        self.repo.prune(before)
    }
}
