use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_clients::{Forwarding, ShareFormat};

#[derive(Debug, Deserialize)]
pub struct CreateDeviceRequest {
    pub user_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub interface_id: Option<Uuid>,
    #[serde(default)]
    pub interface_ids: Vec<Uuid>,
    pub name: String,
    #[serde(default)]
    pub down_kbps: u32,
    #[serde(default)]
    pub up_kbps: u32,
    pub forwarding: Option<Forwarding>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppDeviceRequest {
    pub name: Option<String>,
    #[serde(default)]
    pub interface_ids: Vec<Uuid>,
}

impl AppDeviceRequest {
    pub fn resolved_name(&self) -> Result<String, String> {
        let name = self
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "name is required".to_string())?;
        if name.chars().count() > 64 {
            return Err("name must be 1..64 characters".into());
        }
        Ok(name.to_string())
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateDeviceRequest {
    pub name: Option<String>,
    pub down_kbps: Option<u32>,
    pub up_kbps: Option<u32>,
    pub forwarding: Option<Forwarding>,
    pub revoked: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct DevicePageParams {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub q: Option<String>,
    pub status: Option<String>,
    pub interface_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTunnelRequest {
    pub interface_id: Uuid,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTunnelRequest {
    pub label: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateShareRequest {
    pub interface_id: Uuid,
    pub format: ShareFormat,
    pub ttl_secs: Option<u64>,
    pub max_uses: Option<u32>,
    #[serde(default)]
    pub one_time: bool,
}

impl CreateShareRequest {
    pub fn resolved_max_uses(&self) -> Result<Option<u32>, String> {
        match (self.one_time, self.max_uses) {
            (true, Some(_)) => Err("one_time and max_uses are mutually exclusive".into()),
            (true, None) => Ok(Some(1)),
            (false, max_uses) => Ok(max_uses),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(one_time: bool, max_uses: Option<u32>) -> CreateShareRequest {
        CreateShareRequest {
            interface_id: Uuid::nil(),
            format: ShareFormat::Conf,
            ttl_secs: None,
            max_uses,
            one_time,
        }
    }

    #[test]
    fn one_time_resolves_to_single_use() {
        assert_eq!(request(true, None).resolved_max_uses(), Ok(Some(1)));
        assert_eq!(request(false, None).resolved_max_uses(), Ok(None));
        assert_eq!(request(false, Some(5)).resolved_max_uses(), Ok(Some(5)));
    }

    #[test]
    fn one_time_conflicts_with_max_uses() {
        assert!(request(true, Some(1)).resolved_max_uses().is_err());
    }
}
