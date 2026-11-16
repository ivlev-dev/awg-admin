use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tariff {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub max_devices: u32,
    pub device_down_kbps: u32,
    pub device_up_kbps: u32,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
    pub traffic_quota_bytes: Option<u64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Tariff {
    pub fn validate(&self) -> CoreResult<()> {
        if self.name.trim().is_empty() {
            return Err(CoreError::Invalid("tariff name is required".into()));
        }
        if self.max_devices == 0 {
            return Err(CoreError::Invalid(
                "tariff must allow at least one device".into(),
            ));
        }
        if self.device_down_kbps > 0
            && self.group_down_kbps > 0
            && self.device_down_kbps > self.group_down_kbps
        {
            return Err(CoreError::Invalid(
                "device download limit cannot exceed the group limit".into(),
            ));
        }
        if self.device_up_kbps > 0
            && self.group_up_kbps > 0
            && self.device_up_kbps > self.group_up_kbps
        {
            return Err(CoreError::Invalid(
                "device upload limit cannot exceed the group limit".into(),
            ));
        }
        Ok(())
    }

    pub fn period_usage_exceeded(&self, used_bytes: u64) -> bool {
        matches!(self.traffic_quota_bytes, Some(quota) if quota > 0 && used_bytes >= quota)
    }
}

pub trait TariffRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Tariff>>;
    fn list(&self) -> CoreResult<Vec<Tariff>>;
    fn save(&self, tariff: &Tariff) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}
