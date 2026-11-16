use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use awg_clients::{DeviceService, ForwardingPolicy};
use awg_identity::IdentityService;
use awg_network::NetworkService;
use awg_orchestration::{
    DesiredInterface, DesiredPeer, DesiredState, ForwardingRule, SnapshotSource, UserLimit,
};
use awg_shared::cidr::{address_with_prefix, parse_net};
use awg_statistics::{StatsScope, StatsService};
use awg_tariffs::TariffService;

pub struct SnapshotBuilder {
    pub network: Arc<NetworkService>,
    pub devices: Arc<DeviceService>,
    pub identity: Arc<IdentityService>,
    pub tariffs: Arc<TariffService>,
    pub stats: Arc<StatsService>,
}

impl SnapshotSource for SnapshotBuilder {
    fn build(&self, node_id: Uuid) -> awg_shared::CoreResult<DesiredState> {
        let interfaces = self.network.interfaces_by_node(node_id)?;
        let mut users = self.identity.list()?;
        users.sort_by_key(|u| u.id);
        let mut tariffs = HashMap::new();
        for user in &users {
            if let Some(tariff_id) = user.tariff_id {
                if let Ok(tariff) = self.tariffs.get(tariff_id) {
                    tariffs.insert(tariff_id, tariff);
                }
            }
        }
        let mut user_tariffs: HashMap<Uuid, &awg_tariffs::Tariff> = HashMap::new();
        for user in &users {
            if let Some(tariff_id) = user.tariff_id {
                if let Some(tariff) = tariffs.get(&tariff_id) {
                    user_tariffs.insert(user.id, tariff);
                }
            }
        }

        let mut desired = Vec::new();
        for interface in interfaces {
            let group_devices = self
                .devices
                .list_all()?
                .into_iter()
                .filter(|d| d.group_id == interface.group_id && !d.revoked)
                .collect::<Vec<_>>();
            let pools = self.network.list_pools(interface.group_id)?;
            let pool_map: HashMap<Uuid, _> = pools.iter().map(|p| (p.id, p)).collect();

            let mut server_addresses = Vec::new();
            for pool in &pools {
                if !pool.enabled {
                    continue;
                }
                if let Some(gateway) = &pool.gateway {
                    if gateway.contains('/') {
                        server_addresses.push(gateway.clone());
                    } else if let Ok(net) = parse_net(&pool.cidr) {
                        server_addresses.push(format!("{gateway}/{}", net.prefix_len()));
                    }
                }
            }

            let mut user_limits = Vec::new();
            for user in &users {
                let owned: Vec<_> = group_devices
                    .iter()
                    .filter(|d| d.user_id == user.id)
                    .collect();
                if owned.is_empty() {
                    continue;
                }
                let Some(tariff) = user_tariffs.get(&user.id) else {
                    continue;
                };
                let used = self
                    .stats
                    .used_bytes(StatsScope::User(user.id))
                    .unwrap_or(0);
                let (down, up) = if tariff.period_usage_exceeded(used) {
                    (1, 1)
                } else {
                    (tariff.group_down_kbps, tariff.group_up_kbps)
                };
                user_limits.push(UserLimit {
                    user_id: user.id,
                    group_down_kbps: down,
                    group_up_kbps: up,
                });
            }

            let mut peers = Vec::new();
            let mut peer_by_device: HashMap<Uuid, (Vec<String>, Vec<String>)> = HashMap::new();
            for device in &group_devices {
                let Some(peer) = self
                    .devices
                    .peers_for(device.id)?
                    .into_iter()
                    .find(|p| p.interface_id == interface.id)
                else {
                    continue;
                };
                let (private_key, preshared_key) = self.devices.peer_secrets(&peer)?;
                let _ = private_key;
                let blocked = self
                    .stats
                    .used_bytes(StatsScope::User(device.user_id))
                    .ok()
                    .and_then(|used| {
                        user_tariffs
                            .get(&device.user_id)
                            .map(|t| t.period_usage_exceeded(used))
                    })
                    .unwrap_or(false);
                let (down, up) = if blocked {
                    (1, 1)
                } else {
                    (device.down_kbps, device.up_kbps)
                };
                let mut addresses = Vec::new();
                let mut allowed = Vec::new();
                for (pool_id, ip) in &peer.ips {
                    let Some(pool) = pool_map.get(pool_id) else {
                        continue;
                    };
                    if let Ok(net) = parse_net(&pool.cidr) {
                        if let std::net::IpAddr::V4(v4) = ip {
                            addresses.push(address_with_prefix(*v4, net));
                            allowed.push(format!("{v4}/32"));
                        }
                    }
                }
                peer_by_device.insert(device.id, (addresses.clone(), allowed.clone()));
                peers.push(DesiredPeer {
                    device_id: device.id,
                    user_id: device.user_id,
                    public_key: peer.public_key.clone(),
                    preshared_key,
                    allowed_ips: allowed,
                    addresses,
                    down_kbps: down,
                    up_kbps: up,
                });
            }

            let mut forwarding = Vec::new();
            for (from, to) in ForwardingPolicy::allowed_pairs(&group_devices) {
                let (Some(from_peer), Some(to_peer)) =
                    (peer_by_device.get(&from), peer_by_device.get(&to))
                else {
                    continue;
                };
                let Some(from_ip) = first_ip(from_peer.0.first()) else {
                    continue;
                };
                let Some(to_ip) = first_ip(to_peer.0.first()) else {
                    continue;
                };
                forwarding.push(ForwardingRule {
                    from_device_id: from,
                    to_device_id: to,
                    from_ip,
                    to_ip,
                });
            }

            desired.push(DesiredInterface {
                id: interface.id,
                name: interface.name.clone(),
                listen_port: interface.listen_port,
                mtu: interface.mtu,
                private_key: self.network.interface_private_key(&interface)?,
                public_key: interface.public_key.clone(),
                enabled: interface.enabled,
                obf: interface.obf.clone(),
                addresses: server_addresses,
                peers,
                group_down_kbps: 0,
                group_up_kbps: 0,
                user_limits,
                forwarding,
            });
        }

        Ok(DesiredState {
            node_id,
            revision: String::new(),
            generated_at: chrono::Utc::now(),
            interfaces: desired,
        })
    }
}

fn first_ip(address: Option<&String>) -> Option<String> {
    address.map(|value| value.split('/').next().unwrap_or(value).to_string())
}
