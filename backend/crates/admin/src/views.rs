use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use awg_audit::AuditEntry;
use awg_clients::{Device, DevicePeer, DeviceProfile, Forwarding, ShareLink};
use awg_identity::{Role, User, UserStatus};
use awg_network::{CidrPool, Group, Interface, NodeStatus, PoolMode};
use awg_shared::obf::InterfaceObf;
use awg_tariffs::{QuotaPeriod, QuotaState, Tariff};

#[derive(Debug, Serialize)]
pub struct UserView {
    pub id: Uuid,
    pub login: String,
    pub email: Option<String>,
    pub status: UserStatus,
    pub totp_enabled: bool,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub disabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&User> for UserView {
    fn from(user: &User) -> Self {
        Self {
            id: user.id,
            login: user.login.clone(),
            email: user.email.clone(),
            status: user.status,
            totp_enabled: user.totp_enabled,
            role: user.role,
            tariff_id: user.tariff_id,
            group_id: user.group_id,
            disabled: user.disabled,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AuthView {
    pub token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub user: UserView,
}

#[derive(Debug, Serialize)]
pub struct SessionView {
    pub jti: Uuid,
    pub family_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub used: bool,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

impl From<&awg_identity::RefreshSession> for SessionView {
    fn from(session: &awg_identity::RefreshSession) -> Self {
        Self {
            jti: session.jti,
            family_id: session.family_id,
            created_at: session.created_at,
            expires_at: session.expires_at,
            revoked: session.revoked,
            used: session.used,
            user_agent: session.user_agent.clone(),
            ip: session.ip.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TariffView {
    #[serde(flatten)]
    pub tariff: Tariff,
}

impl From<Tariff> for TariffView {
    fn from(tariff: Tariff) -> Self {
        Self { tariff }
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

#[derive(Debug, Serialize)]
pub struct PeerView {
    pub interface_id: Uuid,
    pub interface_name: String,
    pub public_key: String,
    pub addresses: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DeviceView {
    pub id: Uuid,
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub down_kbps: u32,
    pub up_kbps: u32,
    pub forwarding: Forwarding,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
    pub peers: Vec<PeerView>,
    pub addresses: Vec<String>,
}

impl DeviceView {
    pub fn build(
        device: &Device,
        peers: &[DevicePeer],
        names: &[(Uuid, String, Vec<String>)],
    ) -> Self {
        let peer_views = peers
            .iter()
            .map(|peer| {
                let (name, addresses) = names
                    .iter()
                    .find(|(id, _, _)| *id == peer.interface_id)
                    .map(|(_, name, addresses)| (name.clone(), addresses.clone()))
                    .unwrap_or_default();
                PeerView {
                    interface_id: peer.interface_id,
                    interface_name: name,
                    public_key: peer.public_key.clone(),
                    addresses,
                }
            })
            .collect();
        let mut all_addresses: Vec<String> = peers
            .iter()
            .flat_map(|peer| peer.ips.values().map(|ip| ip.to_string()))
            .collect();
        all_addresses.sort();
        all_addresses.dedup();
        Self {
            id: device.id,
            user_id: device.user_id,
            group_id: device.group_id,
            name: device.name.clone(),
            down_kbps: device.down_kbps,
            up_kbps: device.up_kbps,
            forwarding: device.forwarding.clone(),
            revoked: device.revoked,
            created_at: device.created_at,
            peers: peer_views,
            addresses: all_addresses,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ProfileView {
    pub interface_id: Uuid,
    pub interface_name: String,
    pub node_id: Uuid,
    pub endpoint: String,
    pub addresses: Vec<String>,
    pub conf: String,
    pub vpn_link: String,
}

impl From<DeviceProfile> for ProfileView {
    fn from(profile: DeviceProfile) -> Self {
        Self {
            interface_id: profile.interface_id,
            interface_name: profile.interface_name,
            node_id: profile.node_id,
            endpoint: profile.endpoint,
            addresses: profile.addresses,
            conf: profile.conf,
            vpn_link: profile.vpn_link,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ShareLinkView {
    pub token: String,
    pub device_id: Uuid,
    pub interface_id: Uuid,
    pub format: awg_clients::ShareFormat,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub url: String,
}

impl ShareLinkView {
    pub fn build(link: &ShareLink, public_base: &str) -> Self {
        let url = if public_base.is_empty() {
            format!("/api/v1/share/{}", link.token)
        } else {
            format!("{public_base}/api/v1/share/{}", link.token)
        };
        Self {
            token: link.token.clone(),
            device_id: link.device_id,
            interface_id: link.interface_id,
            format: link.format,
            expires_at: link.expires_at,
            created_at: link.created_at,
            url,
        }
    }
}

#[derive(Debug, Serialize, Default)]
pub struct TrafficTotals {
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Serialize)]
pub struct StatsPoint {
    pub at: DateTime<Utc>,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Serialize)]
pub struct OverviewView {
    pub today: TrafficTotals,
    pub month: TrafficTotals,
    pub nodes_online: usize,
    pub nodes_total: usize,
    pub interfaces: usize,
    pub groups: usize,
    pub devices: usize,
    pub users: usize,
    pub top_devices: Vec<DeviceTrafficView>,
}

#[derive(Debug, Serialize)]
pub struct DeviceTrafficView {
    pub device_id: Uuid,
    pub name: String,
    pub user_id: Uuid,
    pub rx: u64,
    pub tx: u64,
    pub online: bool,
}

#[derive(Debug, Serialize)]
pub struct QuotaView {
    pub used_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub exceeded: bool,
    pub remaining_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub reset_at: DateTime<Utc>,
}

impl QuotaView {
    pub fn build(state: QuotaState, period: QuotaPeriod) -> Self {
        Self {
            used_bytes: state.used_bytes,
            quota_bytes: state.quota_bytes,
            exceeded: state.exceeded,
            remaining_bytes: state.remaining_bytes,
            percent: state.percent,
            period_start: period.start,
            period_end: period.end,
            reset_at: period.reset_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct QuotaUserView {
    pub user_id: Uuid,
    pub login: String,
    pub used_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub exceeded: bool,
    pub percent: Option<f64>,
}

impl QuotaUserView {
    pub fn build(user_id: Uuid, login: &str, state: QuotaState) -> Self {
        Self {
            user_id,
            login: login.to_string(),
            used_bytes: state.used_bytes,
            quota_bytes: state.quota_bytes,
            exceeded: state.exceeded,
            percent: state.percent,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AuditEntryView {
    pub id: Uuid,
    pub at: DateTime<Utc>,
    pub actor_id: Option<Uuid>,
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
