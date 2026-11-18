use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use awg_shared::obf::InterfaceObf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesiredState {
    pub node_id: Uuid,
    pub revision: String,
    pub generated_at: DateTime<Utc>,
    pub interfaces: Vec<DesiredInterface>,
}

impl DesiredState {
    pub fn seal(mut self) -> Self {
        self.revision = self.compute_revision();
        self
    }

    fn compute_revision(&self) -> String {
        let mut clone = self.clone();
        clone.revision.clear();
        let bytes = serde_json::to_vec(&clone).unwrap_or_default();
        let digest = Sha256::digest(&bytes);
        digest[..8]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesiredInterface {
    pub id: Uuid,
    pub name: String,
    pub listen_port: u16,
    pub mtu: u16,
    pub private_key: String,
    pub public_key: String,
    pub enabled: bool,
    pub obf: InterfaceObf,
    pub addresses: Vec<String>,
    pub peers: Vec<DesiredPeer>,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
    pub user_limits: Vec<UserLimit>,
    pub forwarding: Vec<ForwardingRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLimit {
    pub user_id: Uuid,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesiredPeer {
    #[serde(default)]
    pub peer_id: Uuid,
    pub device_id: Uuid,
    pub user_id: Uuid,
    pub public_key: String,
    pub preshared_key: String,
    pub allowed_ips: Vec<String>,
    pub addresses: Vec<String>,
    pub down_kbps: u32,
    pub up_kbps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardingRule {
    pub from_device_id: Uuid,
    pub to_device_id: Uuid,
    pub from_ip: String,
    pub to_ip: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkerStats {
    pub revision: String,
    pub at: DateTime<Utc>,
    pub interfaces: Vec<InterfaceCounters>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InterfaceCounters {
    pub interface_id: Uuid,
    pub rx_total: u64,
    pub tx_total: u64,
    pub epoch: i64,
    pub peers: Vec<PeerCounters>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PeerCounters {
    #[serde(default)]
    pub peer_id: Uuid,
    pub device_id: Uuid,
    pub public_key: String,
    pub rx_total: u64,
    pub tx_total: u64,
    pub last_handshake: i64,
}
