use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

pub const DEFAULT_AUDIT_LIMIT: usize = 100;
pub const MAX_AUDIT_LIMIT: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

pub trait AuditRepository: Send + Sync {
    fn record(&self, entry: &AuditEntry) -> CoreResult<()>;
    fn list(&self, limit: usize) -> CoreResult<Vec<AuditEntry>>;
}
