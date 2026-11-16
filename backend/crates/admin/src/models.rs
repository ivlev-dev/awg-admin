use serde::Deserialize;
use uuid::Uuid;

use awg_clients::{Forwarding, ShareFormat};
use awg_identity::Role;
use awg_network::PoolMode;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub login: String,
    pub password: String,
    #[serde(default)]
    pub totp_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    #[serde(default)]
    pub login: Option<String>,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyEmailRequest {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ResendVerificationRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ApproveUserRequest {
    pub tariff_id: Uuid,
    #[serde(default)]
    pub group_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct EnableTotpRequest {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct DisableTotpRequest {
    pub password: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: Option<String>,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub login: String,
    pub password: String,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateUserRequest {
    pub role: Option<Role>,
    #[serde(default, with = "double_option")]
    pub tariff_id: Option<Option<Uuid>>,
    #[serde(default, with = "double_option")]
    pub group_id: Option<Option<Uuid>>,
    pub disabled: Option<bool>,
}

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
    #[serde(default, with = "double_option")]
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
    #[serde(default, with = "double_option")]
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

#[derive(Debug, Deserialize)]
pub struct CreateDeviceRequest {
    pub user_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub name: String,
    #[serde(default)]
    pub down_kbps: u32,
    #[serde(default)]
    pub up_kbps: u32,
    pub forwarding: Option<Forwarding>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateDeviceRequest {
    pub name: Option<String>,
    pub down_kbps: Option<u32>,
    pub up_kbps: Option<u32>,
    pub forwarding: Option<Forwarding>,
    pub revoked: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateShareRequest {
    pub interface_id: Uuid,
    pub format: ShareFormat,
    pub ttl_secs: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub obfuscation: Option<awg_shared::obf::ObfuscationSettings>,
    pub share_default_ttl_secs: Option<u64>,
    pub stats_retention_days: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct ImportPool {
    pub name: String,
    pub cidr: String,
    #[serde(default = "default_pool_mode")]
    pub mode: PoolMode,
    pub gateway: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportInterfaceForm {
    pub name: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub listen_port: u16,
    #[serde(default = "default_mtu")]
    pub mtu: u16,
}

#[derive(Debug, Deserialize)]
pub struct ImportClient {
    pub name: String,
    pub config: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportInterfaceRequest {
    pub server_config: String,
    pub name: String,
    #[serde(default)]
    pub label: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub listen_port: u16,
    #[serde(default = "default_mtu")]
    pub mtu: u16,
    #[serde(default)]
    pub pools: Vec<ImportPool>,
    #[serde(default)]
    pub clients: Vec<ImportClient>,
}

#[derive(Debug, Deserialize)]
pub struct BatchImportRequest {
    pub node_id: Uuid,
    pub group_name: String,
    #[serde(default)]
    pub group_description: String,
    pub base_cidr: String,
    #[serde(default)]
    pub owner_user_id: Option<Uuid>,
    #[serde(default)]
    pub interfaces: Vec<ImportInterfaceRequest>,
}

#[derive(Debug, Deserialize)]
pub struct ClientsImportRequest {
    #[serde(default)]
    pub interface_id: Option<Uuid>,
    #[serde(default)]
    pub owner_user_id: Option<Uuid>,
    pub clients: Vec<ImportClient>,
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub server_config: String,
    pub node_id: Uuid,
    pub group_name: String,
    #[serde(default)]
    pub group_description: String,
    pub base_cidr: String,
    pub pools: Vec<ImportPool>,
    pub interface: ImportInterfaceForm,
    #[serde(default)]
    pub clients: Vec<ImportClient>,
    pub owner_user_id: Option<Uuid>,
}

fn default_mtu() -> u16 {
    1420
}

fn default_pool_mode() -> PoolMode {
    PoolMode::Auto
}

mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}
