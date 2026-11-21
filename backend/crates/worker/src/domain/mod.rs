use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct DesiredState {
    pub revision: String,
    pub interfaces: Vec<DesiredInterface>,
}

#[derive(Debug, Clone)]
pub struct DesiredInterface {
    pub id: Uuid,
    pub name: String,
    pub listen_port: u16,
    pub mtu: u16,
    pub private_key: String,
    pub public_key: String,
    pub enabled: bool,
    pub obf: WireObf,
    pub addresses: Vec<String>,
    pub peers: Vec<DesiredPeer>,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
    pub user_limits: Vec<UserLimit>,
    pub forwarding: Vec<ForwardingRule>,
}

#[derive(Debug, Clone)]
pub struct UserLimit {
    pub user_id: Uuid,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
}

#[derive(Debug, Clone)]
pub struct WireObf {
    pub h1: String,
    pub h2: String,
    pub h3: String,
    pub h4: String,
    pub s1: u16,
    pub s2: u16,
    pub s3: u16,
    pub s4: u16,
    pub header_protection_key: String,
    pub random_trailers: bool,
}

#[derive(Debug, Clone)]
pub struct DesiredPeer {
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

#[derive(Debug, Clone)]
pub struct ForwardingRule {
    pub from_device_id: Uuid,
    pub to_device_id: Uuid,
    pub from_ip: String,
    pub to_ip: String,
}

#[derive(Debug, Clone, Default)]
pub struct InterfaceRuntime {
    pub peers: Vec<PeerRuntime>,
}

#[derive(Debug, Clone, Default)]
pub struct PeerRuntime {
    pub public_key: String,
    pub allowed_ips: Vec<String>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub last_handshake: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerCounter {
    pub offset_rx: u64,
    pub offset_tx: u64,
    pub last_rx: u64,
    pub last_tx: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CounterBook {
    pub peers: HashMap<String, PeerCounter>,
    /// How many times the kernel counter went backwards (peer/interface reset).
    /// Not persisted: it describes the current worker process lifetime.
    #[serde(default, skip_serializing)]
    pub resets: u64,
}

impl CounterBook {
    pub fn observe(&mut self, key: &str, raw_rx: u64, raw_tx: u64) -> (u64, u64) {
        let entry = self.peers.entry(key.to_string()).or_insert(PeerCounter {
            offset_rx: 0,
            offset_tx: 0,
            last_rx: 0,
            last_tx: 0,
        });

        if raw_rx < entry.last_rx {
            entry.offset_rx = entry.offset_rx.saturating_add(entry.last_rx);
            self.resets = self.resets.saturating_add(1);
        }
        if raw_tx < entry.last_tx {
            entry.offset_tx = entry.offset_tx.saturating_add(entry.last_tx);
            self.resets = self.resets.saturating_add(1);
        }
        entry.last_rx = raw_rx;
        entry.last_tx = raw_tx;
        (
            entry.offset_rx.saturating_add(raw_rx),
            entry.offset_tx.saturating_add(raw_tx),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_survive_interface_reload() {
        let mut book = CounterBook::default();
        assert_eq!(book.observe("awg0|peer", 100, 200), (100, 200));
        assert_eq!(book.observe("awg0|peer", 400, 500), (400, 500));
        assert_eq!(book.observe("awg0|peer", 10, 20), (410, 520));
        assert_eq!(book.observe("awg0|peer", 60, 90), (460, 590));
    }

    #[test]
    fn counters_survive_worker_restart_with_continued_kernel_state() {
        let mut book = CounterBook::default();
        book.observe("awg0|peer", 1_000, 2_000);
        let json = serde_json::to_string(&book).unwrap();
        let mut restored: CounterBook = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.observe("awg0|peer", 1_500, 2_500), (1_500, 2_500));
    }
}
