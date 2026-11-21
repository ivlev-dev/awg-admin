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
    /// Seals the state, filling `revision` only when the caller left it empty.
    ///
    /// Administrators already build a deterministic, content-addressed revision;
    /// recomputing it here would discard that value and make an unchanged state
    /// look new on every publish.
    pub fn seal(mut self) -> Self {
        if self.revision.is_empty() {
            self.revision = self.compute_revision();
        }
        self
    }

    /// Deterministic content hash used when no revision was supplied.
    ///
    /// Mirrors the admin-side algorithm: the state is canonicalized
    /// (interfaces, peers, limits and forwarding rules sorted) before hashing,
    /// so equal content always yields the same revision. `generated_at` is
    /// intentionally left out.
    fn compute_revision(&self) -> String {
        let mut interfaces = self.interfaces.clone();
        interfaces.sort_by_key(|interface| interface.id);
        for interface in &mut interfaces {
            interface
                .peers
                .sort_by_key(|peer| (peer.device_id, peer.peer_id));
            interface.user_limits.sort_by_key(|limit| limit.user_id);
            interface
                .forwarding
                .sort_by_key(|rule| (rule.from_device_id, rule.to_device_id));
        }

        let mut hasher = Sha256::new();
        hasher.update(self.node_id.as_bytes());
        match serde_json::to_vec(&interfaces) {
            Ok(bytes) => hasher.update(bytes),
            Err(_) => hasher.update(b"unserializable"),
        }
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    use awg_shared::obf::HeaderRange;
    use chrono::TimeZone;

    fn at(timestamp: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(timestamp, 0).unwrap()
    }

    fn obf() -> InterfaceObf {
        InterfaceObf {
            h1: HeaderRange::new(1, 2),
            h2: HeaderRange::new(3, 4),
            h3: HeaderRange::new(5, 6),
            h4: HeaderRange::new(7, 8),
            s1: 10,
            s2: 20,
            s3: 30,
            s4: 40,
            header_protection_key: "key".to_string(),
            random_trailers: false,
        }
    }

    fn peer(device: u128, peer: u128, key: &str) -> DesiredPeer {
        DesiredPeer {
            peer_id: Uuid::from_u128(peer),
            device_id: Uuid::from_u128(device),
            user_id: Uuid::from_u128(device + 1_000),
            public_key: key.to_string(),
            preshared_key: String::new(),
            allowed_ips: vec!["10.0.0.2/32".to_string()],
            addresses: vec!["10.0.0.2/32".to_string()],
            down_kbps: 1_000,
            up_kbps: 500,
        }
    }

    fn interface(id: u128, name: &str) -> DesiredInterface {
        DesiredInterface {
            id: Uuid::from_u128(id),
            name: name.to_string(),
            listen_port: 51_820,
            mtu: 1_420,
            private_key: "private".to_string(),
            public_key: "public".to_string(),
            enabled: true,
            obf: obf(),
            addresses: vec!["10.0.0.1/24".to_string()],
            peers: vec![peer(1, 1, "a"), peer(2, 2, "b")],
            group_down_kbps: 10_000,
            group_up_kbps: 5_000,
            user_limits: vec![
                UserLimit {
                    user_id: Uuid::from_u128(2),
                    group_down_kbps: 2_000,
                    group_up_kbps: 1_000,
                },
                UserLimit {
                    user_id: Uuid::from_u128(1),
                    group_down_kbps: 3_000,
                    group_up_kbps: 1_500,
                },
            ],
            forwarding: vec![ForwardingRule {
                from_device_id: Uuid::from_u128(1),
                to_device_id: Uuid::from_u128(2),
                from_ip: "10.0.0.2".to_string(),
                to_ip: "10.0.0.3".to_string(),
            }],
        }
    }

    fn state(revision: &str, generated_at: DateTime<Utc>) -> DesiredState {
        DesiredState {
            node_id: Uuid::from_u128(7),
            revision: revision.to_string(),
            generated_at,
            interfaces: vec![interface(1, "wg0"), interface(2, "wg1")],
        }
    }

    #[test]
    fn seal_keeps_a_non_empty_revision() {
        let sealed = state("admin-revision", at(1_700_000_000)).seal();

        assert_eq!(sealed.revision, "admin-revision");
    }

    #[test]
    fn seal_fills_an_empty_revision() {
        let sealed = state("", at(1_700_000_000)).seal();

        assert_eq!(sealed.revision.len(), 64);
        assert!(
            sealed.revision.chars().all(|c| c.is_ascii_hexdigit()),
            "revision must be hex: {}",
            sealed.revision
        );
        assert_eq!(sealed.clone().seal().revision, sealed.revision);
    }

    #[test]
    fn equal_states_share_a_revision() {
        let first = state("", at(1_700_000_000)).seal();
        let second = state("", at(1_700_000_001)).seal();

        assert_eq!(first.revision, second.revision);
    }

    #[test]
    fn generated_at_does_not_change_the_revision() {
        let earlier = state("", at(1_700_000_000)).seal();
        let later = state("", at(1_900_000_000)).seal();

        assert_eq!(earlier.revision, later.revision);
    }

    #[test]
    fn revision_ignores_collection_ordering() {
        let mut first = interface(1, "wg0");
        let mut second = interface(2, "wg1");
        first.peers.reverse();
        second.user_limits.reverse();

        let ordered = DesiredState {
            node_id: Uuid::from_u128(7),
            revision: String::new(),
            generated_at: at(1_700_000_000),
            interfaces: vec![interface(1, "wg0"), interface(2, "wg1")],
        }
        .seal();
        let shuffled = DesiredState {
            node_id: Uuid::from_u128(7),
            revision: String::new(),
            generated_at: at(1_700_000_000),
            interfaces: vec![second, first],
        }
        .seal();

        assert_eq!(ordered.revision, shuffled.revision);
    }

    #[test]
    fn content_changes_the_revision() {
        let baseline = state("", at(1_700_000_000)).seal();
        let mut changed = state("", at(1_700_000_000));
        changed.interfaces[0].mtu = 1_280;
        let changed = changed.seal();

        assert_ne!(baseline.revision, changed.revision);
    }
}
