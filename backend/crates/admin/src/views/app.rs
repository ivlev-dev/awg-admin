use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use awg_clients::DeviceProfile;
use awg_tariffs::Tariff;

use crate::views::{DeviceView, QuotaView, UserView};

pub const REVISION_LEN: usize = 16;

#[derive(Debug, Serialize)]
pub struct AppTariffView {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub max_devices: u32,
    pub device_down_kbps: u32,
    pub device_up_kbps: u32,
    pub traffic_quota_bytes: Option<u64>,
}

impl From<&Tariff> for AppTariffView {
    fn from(tariff: &Tariff) -> Self {
        Self {
            id: tariff.id,
            name: tariff.name.clone(),
            description: tariff.description.clone(),
            max_devices: tariff.max_devices,
            device_down_kbps: tariff.device_down_kbps,
            device_up_kbps: tariff.device_up_kbps,
            traffic_quota_bytes: tariff.traffic_quota_bytes,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DeviceConfigView {
    pub interface_id: Uuid,
    pub interface_name: String,
    pub node_id: Uuid,
    pub endpoint: String,
    pub addresses: Vec<String>,
    pub conf: String,
    pub revision: String,
}

impl From<DeviceProfile> for DeviceConfigView {
    fn from(profile: DeviceProfile) -> Self {
        let revision = revision(&profile.conf);
        Self {
            interface_id: profile.interface_id,
            interface_name: profile.interface_name,
            node_id: profile.node_id,
            endpoint: profile.endpoint,
            addresses: profile.addresses,
            conf: profile.conf,
            revision,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AppBootstrapView {
    pub user: UserView,
    pub tariff: Option<AppTariffView>,
    pub quota: QuotaView,
    pub devices: Vec<DeviceView>,
}

#[derive(Debug, Serialize)]
pub struct AppDeviceView {
    pub device: DeviceView,
    pub config: DeviceConfigView,
}

pub fn revision(conf: &str) -> String {
    let digest = Sha256::digest(conf.as_bytes());
    digest
        .iter()
        .take(REVISION_LEN / 2)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_is_stable_hex_prefix_of_sha256() {
        let conf = "[Interface]\nPrivateKey = key\n";
        let first = revision(conf);
        assert_eq!(first, revision(conf));
        assert_eq!(first.len(), REVISION_LEN);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(first, first.to_ascii_lowercase());

        let second = revision("[Interface]\nPrivateKey = other\n");
        assert_ne!(first, second);
        assert_eq!(second.len(), REVISION_LEN);
    }
}
