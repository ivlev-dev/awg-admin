use std::sync::Arc;

use awg_shared::CoreResult;

use crate::domain::{
    AuditEntry, AuditRepository, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT, NewAuditEntry,
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
        let limit = if limit == 0 {
            DEFAULT_AUDIT_LIMIT
        } else {
            limit.min(MAX_AUDIT_LIMIT)
        };
        self.repo.list(limit)
    }
}
