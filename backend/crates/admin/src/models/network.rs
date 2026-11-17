use serde::Deserialize;
use uuid::Uuid;

use awg_network::PoolMode;

#[derive(Debug, Deserialize)]
pub struct CreateTariffRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub max_devices: u32,
    #[serde(default)]
    pub device_down_kbps: u32,
    #[serde(default)]
    pub device_up_kbps: u32,
    #[serde(default)]
    pub group_down_kbps: u32,
    #[serde(default)]
    pub group_up_kbps: u32,
    pub traffic_quota_bytes: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateTariffRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub max_devices: Option<u32>,
    pub device_down_kbps: Option<u32>,
    pub device_up_kbps: Option<u32>,
    pub group_down_kbps: Option<u32>,
    pub group_up_kbps: Option<u32>,
    #[serde(default, with = "crate::models::double_option")]
    pub traffic_quota_bytes: Option<Option<u64>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub base_cidr: String,
    #[serde(default)]
    pub forwarding_default: bool,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateGroupRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub base_cidr: Option<String>,
    pub forwarding_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePoolRequest {
    pub name: String,
    pub cidr: String,
    pub mode: PoolMode,
    pub gateway: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdatePoolRequest {
    pub name: Option<String>,
    pub mode: Option<PoolMode>,
    #[serde(default, with = "crate::models::double_option")]
    pub gateway: Option<Option<String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateNodeRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInterfaceRequest {
    pub group_id: Uuid,
    pub node_id: Uuid,
    pub name: String,
    #[serde(default)]
    pub label: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub listen_port: u16,
    #[serde(default = "default_mtu")]
    pub mtu: u16,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateInterfaceRequest {
    pub label: Option<String>,
    pub endpoint_host: Option<String>,
    pub endpoint_port: Option<u16>,
    pub listen_port: Option<u16>,
    pub mtu: Option<u16>,
    pub enabled: Option<bool>,
}

fn default_mtu() -> u16 {
    1420
}
