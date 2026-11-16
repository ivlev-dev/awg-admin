use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{QuotaState, Tariff, TariffRepository};

#[derive(Debug, Clone)]
pub struct NewTariff {
    pub name: String,
    pub description: String,
    pub max_devices: u32,
    pub device_down_kbps: u32,
    pub device_up_kbps: u32,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
    pub traffic_quota_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct TariffChanges {
    pub name: Option<String>,
    pub description: Option<String>,
    pub max_devices: Option<u32>,
    pub device_down_kbps: Option<u32>,
    pub device_up_kbps: Option<u32>,
    pub group_down_kbps: Option<u32>,
    pub group_up_kbps: Option<u32>,
    pub traffic_quota_bytes: Option<Option<u64>>,
}

pub struct TariffService {
    repo: Arc<dyn TariffRepository>,
}

impl TariffService {
    pub fn new(repo: Arc<dyn TariffRepository>) -> Self {
        Self { repo }
    }

    pub fn list(&self) -> CoreResult<Vec<Tariff>> {
        self.repo.list()
    }

    pub fn get(&self, id: Uuid) -> CoreResult<Tariff> {
        self.repo
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("tariff".into()))
    }

    pub fn create(&self, input: NewTariff) -> CoreResult<Tariff> {
        let now = Utc::now();
        let tariff = Tariff {
            id: Uuid::new_v4(),
            name: input.name.trim().to_string(),
            description: input.description,
            max_devices: input.max_devices,
            device_down_kbps: input.device_down_kbps,
            device_up_kbps: input.device_up_kbps,
            group_down_kbps: input.group_down_kbps,
            group_up_kbps: input.group_up_kbps,
            traffic_quota_bytes: input.traffic_quota_bytes,
            created_at: now,
            updated_at: now,
        };
        tariff.validate()?;
        self.repo.save(&tariff)?;
        Ok(tariff)
    }

    pub fn update(&self, id: Uuid, changes: TariffChanges) -> CoreResult<Tariff> {
        let mut tariff = self.get(id)?;
        if let Some(name) = changes.name {
            tariff.name = name.trim().to_string();
        }
        if let Some(description) = changes.description {
            tariff.description = description;
        }
        if let Some(value) = changes.max_devices {
            tariff.max_devices = value;
        }
        if let Some(value) = changes.device_down_kbps {
            tariff.device_down_kbps = value;
        }
        if let Some(value) = changes.device_up_kbps {
            tariff.device_up_kbps = value;
        }
        if let Some(value) = changes.group_down_kbps {
            tariff.group_down_kbps = value;
        }
        if let Some(value) = changes.group_up_kbps {
            tariff.group_up_kbps = value;
        }
        if let Some(value) = changes.traffic_quota_bytes {
            tariff.traffic_quota_bytes = value;
        }
        tariff.updated_at = Utc::now();
        tariff.validate()?;
        self.repo.save(&tariff)?;
        Ok(tariff)
    }

    pub fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.repo.delete(id)
    }

    pub fn quota_state_for(
        &self,
        tariff_id: Option<Uuid>,
        used_bytes: u64,
    ) -> CoreResult<QuotaState> {
        let Some(tariff_id) = tariff_id else {
            return Ok(QuotaState::unlimited(used_bytes));
        };
        Ok(match self.repo.find(tariff_id)? {
            Some(tariff) => tariff.quota_state(used_bytes),
            None => QuotaState::unlimited(used_bytes),
        })
    }
}

pub struct LimitPolicy;

impl LimitPolicy {
    pub fn resolve_device_limits(
        tariff: &Tariff,
        requested_down: u32,
        requested_up: u32,
    ) -> (u32, u32) {
        (
            clamp_to(tariff.device_down_kbps, requested_down),
            clamp_to(tariff.device_up_kbps, requested_up),
        )
    }

    pub fn validate_group_sum(tariff: &Tariff, devices: &[(u32, u32)]) -> CoreResult<()> {
        let down: u64 = devices.iter().map(|(d, _)| *d as u64).sum();
        let up: u64 = devices.iter().map(|(_, u)| *u as u64).sum();
        if tariff.group_down_kbps > 0 && down > tariff.group_down_kbps as u64 {
            return Err(CoreError::Invalid(format!(
                "sum of device download limits ({down} kbps) exceeds the tariff group limit ({} kbps)",
                tariff.group_down_kbps
            )));
        }
        if tariff.group_up_kbps > 0 && up > tariff.group_up_kbps as u64 {
            return Err(CoreError::Invalid(format!(
                "sum of device upload limits ({up} kbps) exceeds the tariff group limit ({} kbps)",
                tariff.group_up_kbps
            )));
        }
        Ok(())
    }

    pub fn effective_limits(
        tariff: &Tariff,
        used_bytes: u64,
        devices: &[(u32, u32)],
    ) -> CoreResult<Vec<(u32, u32)>> {
        Self::validate_group_sum(tariff, devices)?;
        if tariff.period_usage_exceeded(used_bytes) {
            return Ok(devices.iter().map(|_| (1, 1)).collect());
        }
        Ok(devices.to_vec())
    }
}

fn clamp_to(tariff_max: u32, requested: u32) -> u32 {
    if tariff_max == 0 {
        requested
    } else if requested == 0 {
        tariff_max
    } else {
        requested.min(tariff_max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tariff() -> Tariff {
        Tariff {
            id: Uuid::new_v4(),
            name: "Test".into(),
            description: String::new(),
            max_devices: 5,
            device_down_kbps: 100_000,
            device_up_kbps: 50_000,
            group_down_kbps: 200_000,
            group_up_kbps: 100_000,
            traffic_quota_bytes: Some(10_000_000_000),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn device_limits_are_clamped_to_tariff() {
        let t = tariff();
        assert_eq!(
            LimitPolicy::resolve_device_limits(&t, 500_000, 0),
            (100_000, 50_000)
        );
        assert_eq!(
            LimitPolicy::resolve_device_limits(&t, 20_000, 10_000),
            (20_000, 10_000)
        );
    }

    #[test]
    fn group_sum_is_enforced() {
        let t = tariff();
        assert!(LimitPolicy::validate_group_sum(&t, &[(100_000, 50_000)]).is_ok());
        assert!(
            LimitPolicy::validate_group_sum(&t, &[(100_000, 50_000), (150_000, 10_000)]).is_err()
        );
    }

    #[test]
    fn quota_blocks_devices() {
        let t = tariff();
        let devices = vec![(10_000, 10_000)];
        assert_eq!(
            LimitPolicy::effective_limits(&t, 20_000_000_000, &devices).unwrap(),
            vec![(1, 1)]
        );
    }
}
