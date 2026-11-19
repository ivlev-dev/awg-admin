use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use awg_audit::AuditEntry;

#[derive(Debug, Serialize)]
pub struct AuditEntryView {
    pub id: Uuid,
    pub at: DateTime<Utc>,
    pub actor_id: Option<Uuid>,
    pub actor_email: String,
    pub actor_login: String,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub status: u16,
    pub ip: Option<String>,
    pub details: Option<String>,
}

impl From<&AuditEntry> for AuditEntryView {
    fn from(entry: &AuditEntry) -> Self {
        Self {
            id: entry.id,
            at: entry.at,
            actor_id: entry.actor_id,
            actor_email: entry.actor_login.clone(),
            actor_login: entry.actor_login.clone(),
            action: entry.action.clone(),
            entity: entry.entity.clone(),
            entity_id: entry.entity_id.clone(),
            status: entry.status,
            ip: entry.ip.clone(),
            details: entry.details.clone(),
        }
    }
}
