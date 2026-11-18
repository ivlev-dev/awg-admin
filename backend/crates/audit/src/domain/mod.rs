use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

pub const DEFAULT_AUDIT_LIMIT: usize = 100;
pub const MAX_AUDIT_LIMIT: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub at: DateTime<Utc>,
    pub actor_id: Option<Uuid>,
    pub actor_login: String,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub status: u16,
    pub ip: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewAuditEntry {
    pub actor_id: Option<Uuid>,
    pub actor_login: String,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub status: u16,
    pub ip: Option<String>,
    pub details: Option<String>,
}

impl AuditEntry {
    pub fn from_new(input: NewAuditEntry) -> Self {
        Self {
            id: Uuid::new_v4(),
            at: Utc::now(),
            actor_id: input.actor_id,
            actor_login: input.actor_login,
            action: input.action,
            entity: input.entity,
            entity_id: input.entity_id,
            status: input.status,
            ip: input.ip,
            details: input.details,
        }
    }

    pub fn validate(&self) -> CoreResult<()> {
        if self.actor_login.trim().is_empty() {
            return Err(CoreError::Invalid("audit actor login is required".into()));
        }
        if self.action.trim().is_empty() {
            return Err(CoreError::Invalid("audit action is required".into()));
        }
        if self.entity.trim().is_empty() {
            return Err(CoreError::Invalid("audit entity is required".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditPage {
    pub items: Vec<AuditEntry>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AuditFilter {
    pub action: Option<String>,
    pub entity: Option<String>,
    pub actor: Option<String>,
    pub status: Option<u16>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

impl AuditFilter {
    pub fn is_empty(&self) -> bool {
        self.action.is_none()
            && self.entity.is_none()
            && self.actor.is_none()
            && self.status.is_none()
            && self.from.is_none()
            && self.to.is_none()
    }

    pub fn validate(&self) -> CoreResult<()> {
        if let (Some(from), Some(to)) = (self.from, self.to)
            && from > to
        {
            return Err(CoreError::Invalid(
                "audit filter: from must not exceed to".into(),
            ));
        }
        Ok(())
    }

    pub fn matches(&self, entry: &AuditEntry) -> bool {
        if let Some(action) = &self.action
            && entry.action != *action
        {
            return false;
        }
        if let Some(entity) = &self.entity
            && entry.entity != *entity
        {
            return false;
        }
        if let Some(actor) = &self.actor
            && !entry
                .actor_login
                .to_lowercase()
                .contains(&actor.to_lowercase())
        {
            return false;
        }
        if let Some(status) = self.status
            && entry.status != status
        {
            return false;
        }
        let at = entry.at.timestamp();
        if let Some(from) = self.from
            && at < from
        {
            return false;
        }
        if let Some(to) = self.to
            && at > to
        {
            return false;
        }
        true
    }
}

pub fn validate_audit_cursor(cursor: &str) -> CoreResult<()> {
    let Some((micros, id)) = cursor.split_once(':') else {
        return Err(CoreError::Invalid("invalid audit cursor".into()));
    };
    if micros.len() != 20 || !micros.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CoreError::Invalid("invalid audit cursor".into()));
    }
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(CoreError::Invalid("invalid audit cursor".into()));
    }
    Ok(())
}

pub trait AuditRepository: Send + Sync {
    fn record(&self, entry: &AuditEntry) -> CoreResult<()>;
    fn list_page_filtered(
        &self,
        limit: usize,
        before: Option<&str>,
        filter: &AuditFilter,
    ) -> CoreResult<AuditPage>;
    fn prune(&self, before: DateTime<Utc>) -> CoreResult<usize>;
    fn delete_filtered(&self, filter: &AuditFilter) -> CoreResult<usize>;

    fn list_page(&self, limit: usize, before: Option<&str>) -> CoreResult<AuditPage> {
        self.list_page_filtered(limit, before, &AuditFilter::default())
    }

    fn list(&self, limit: usize) -> CoreResult<Vec<AuditEntry>> {
        Ok(self.list_page(limit, None)?.items)
    }
}
