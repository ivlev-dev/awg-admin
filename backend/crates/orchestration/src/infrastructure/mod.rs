use awg_proto as proto;
use sha2::{Digest, Sha256};

use crate::domain::{DesiredState, WorkerStats};

fn peer_identity(raw: &str, public_key: &str) -> uuid::Uuid {
    if let Ok(id) = raw.parse::<uuid::Uuid>()
        && !id.is_nil()
    {
        return id;
    }
    let digest = Sha256::digest(public_key.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes)
}

pub fn to_proto_state(state: &DesiredState) -> proto::DesiredState {
    proto::DesiredState {
        revision: state.revision.clone(),
        generated_at: state.generated_at.timestamp(),
        interfaces: state
            .interfaces
            .iter()
            .map(|interface| proto::DesiredInterface {
                id: interface.id.to_string(),
                name: interface.name.clone(),
                listen_port: interface.listen_port as u32,
                mtu: interface.mtu as u32,
                private_key: interface.private_key.clone(),
                public_key: interface.public_key.clone(),
                enabled: interface.enabled,
                h1: interface.obf.h1.spec(),
                h2: interface.obf.h2.spec(),
                h3: interface.obf.h3.spec(),
                h4: interface.obf.h4.spec(),
                s1: interface.obf.s1 as u32,
                s2: interface.obf.s2 as u32,
                s3: interface.obf.s3 as u32,
                s4: interface.obf.s4 as u32,
                header_protection_key: interface.obf.header_protection_key.clone(),
                random_trailers: interface.obf.random_trailers,
                addresses: interface.addresses.clone(),
                group_down_kbps: interface.group_down_kbps,
                group_up_kbps: interface.group_up_kbps,
                user_limits: interface
                    .user_limits
                    .iter()
                    .map(|limit| proto::UserLimit {
                        user_id: limit.user_id.to_string(),
                        group_down_kbps: limit.group_down_kbps,
                        group_up_kbps: limit.group_up_kbps,
                    })
                    .collect(),
                peers: interface
                    .peers
                    .iter()
                    .map(|peer| proto::DesiredPeer {
                        peer_id: peer.peer_id.to_string(),
                        device_id: peer.device_id.to_string(),
                        user_id: peer.user_id.to_string(),
                        public_key: peer.public_key.clone(),
                        preshared_key: peer.preshared_key.clone(),
                        allowed_ips: peer.allowed_ips.clone(),
                        addresses: peer.addresses.clone(),
                        down_kbps: peer.down_kbps,
                        up_kbps: peer.up_kbps,
                    })
                    .collect(),
                forwarding: interface
                    .forwarding
                    .iter()
                    .map(|rule| proto::ForwardingRule {
                        from_device_id: rule.from_device_id.to_string(),
                        to_device_id: rule.to_device_id.to_string(),
                        from_ip: rule.from_ip.clone(),
                        to_ip: rule.to_ip.clone(),
                    })
                    .collect(),
            })
            .collect(),
    }
}

pub fn from_proto_stats(snapshot: proto::StatsSnapshot) -> WorkerStats {
    WorkerStats {
        revision: snapshot.revision,
        at: chrono::DateTime::from_timestamp(snapshot.at, 0).unwrap_or_else(chrono::Utc::now),
        interfaces: snapshot
            .interfaces
            .into_iter()
            .map(|interface| crate::domain::InterfaceCounters {
                interface_id: interface.interface_id.parse().unwrap_or(uuid::Uuid::nil()),
                rx_total: interface.rx_total,
                tx_total: interface.tx_total,
                epoch: interface.epoch,
                peers: interface
                    .peers
                    .into_iter()
                    .map(|peer| crate::domain::PeerCounters {
                        peer_id: peer_identity(&peer.peer_id, &peer.public_key),
                        device_id: peer.device_id.parse().unwrap_or(uuid::Uuid::nil()),
                        public_key: peer.public_key,
                        rx_total: peer.rx_total,
                        tx_total: peer.tx_total,
                        last_handshake: peer.last_handshake,
                    })
                    .collect(),
            })
            .collect(),
    }
}
