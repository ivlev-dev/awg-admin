use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use awg_network::{CidrPool, Group, Interface, Node, NodeStatus, PoolMode};
use awg_shared::obf::InterfaceObf;
use awg_tariffs::Tariff;

#[derive(Debug, Serialize)]
pub struct TariffView {
    #[serde(flatten)]
    pub tariff: Tariff,
    pub interface_name: Option<String>,
}

impl TariffView {
    pub fn build(tariff: Tariff, interface_name: Option<String>) -> Self {
        Self {
            tariff,
            interface_name,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GroupView {
    #[serde(flatten)]
    pub group: Group,
    pub interfaces: usize,
    pub devices: usize,
}

#[derive(Debug, Serialize)]
pub struct PoolView {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub cidr: String,
    pub mode: PoolMode,
    pub gateway: Option<String>,
    pub enabled: bool,
}

impl From<&CidrPool> for PoolView {
    fn from(pool: &CidrPool) -> Self {
        Self {
            id: pool.id,
            group_id: pool.group_id,
            name: pool.name.clone(),
            cidr: pool.cidr.clone(),
            mode: pool.mode,
            gateway: pool.gateway.clone(),
            enabled: pool.enabled,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct NodeView {
    pub id: Uuid,
    pub name: String,
    pub status: NodeStatus,
    pub online: bool,
    pub last_seen: Option<DateTime<Utc>>,
    pub version: Option<String>,
    pub interfaces: usize,
    pub token_issued_at: Option<DateTime<Utc>>,
    pub cpu_load: Option<f64>,
    pub mem_used_bytes: Option<u64>,
    pub mem_total_bytes: Option<u64>,
    pub kernel_version: Option<String>,
    pub worker_version: Option<String>,
    pub uptime_secs: Option<u64>,
    pub metrics_at: Option<DateTime<Utc>>,
}

impl NodeView {
    pub fn build(node: Node, online: bool, interfaces: usize) -> Self {
        Self {
            id: node.id,
            name: node.name,
            status: if online {
                NodeStatus::Online
            } else {
                NodeStatus::Offline
            },
            online,
            last_seen: node.last_seen,
            version: node.version,
            interfaces,
            token_issued_at: node.token_issued_at,
            cpu_load: node.cpu_load,
            mem_used_bytes: node.mem_used_bytes,
            mem_total_bytes: node.mem_total_bytes,
            kernel_version: node.kernel_version,
            worker_version: node.worker_version,
            uptime_secs: node.uptime_secs,
            metrics_at: node.metrics_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct InterfaceView {
    pub id: Uuid,
    pub group_id: Uuid,
    pub group_name: String,
    pub node_id: Uuid,
    pub node_name: String,
    pub name: String,
    pub label: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub listen_port: u16,
    pub mtu: u16,
    pub public_key: String,
    pub obf: InterfaceObf,
    pub enabled: bool,
    pub peers: usize,
}

impl InterfaceView {
    pub fn build(interface: &Interface, group_name: &str, node_name: &str, peers: usize) -> Self {
        Self {
            id: interface.id,
            group_id: interface.group_id,
            group_name: group_name.to_string(),
            node_id: interface.node_id,
            node_name: node_name.to_string(),
            name: interface.name.clone(),
            label: interface.label.clone(),
            endpoint_host: interface.endpoint_host.clone(),
            endpoint_port: interface.endpoint_port,
            listen_port: interface.listen_port,
            mtu: interface.mtu,
            public_key: interface.public_key.clone(),
            obf: interface.obf.clone(),
            enabled: interface.enabled,
            peers,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tariff(interface_id: Option<Uuid>) -> Tariff {
        let now = Utc::now();
        Tariff {
            id: Uuid::new_v4(),
            name: "Basic".into(),
            description: String::new(),
            max_devices: 1,
            device_down_kbps: 1,
            device_up_kbps: 1,
            group_down_kbps: 1,
            group_up_kbps: 1,
            traffic_quota_bytes: None,
            interface_id,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn tariff_view_exposes_interface_and_name() {
        let interface_id = Uuid::new_v4();
        let value = serde_json::to_value(TariffView::build(
            tariff(Some(interface_id)),
            Some("awg0".into()),
        ))
        .unwrap();
        assert_eq!(value["interface_id"], interface_id.to_string());
        assert_eq!(value["interface_name"], "awg0");
        assert_eq!(value["name"], "Basic");
    }

    #[test]
    fn tariff_view_without_interface_has_nulls() {
        let value = serde_json::to_value(TariffView::build(tariff(None), None)).unwrap();
        assert!(value["interface_id"].is_null());
        assert!(value["interface_name"].is_null());
    }
}
