use serde::Deserialize;
use uuid::Uuid;

use awg_network::PoolMode;

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
