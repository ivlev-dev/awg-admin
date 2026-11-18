use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use awg_network::NetworkService;
use awg_shared::cidr::address_with_prefix;
use awg_shared::conf::{ClientConfParams, render_client_conf};
use awg_shared::crypto::Sealer;
use awg_shared::vpn::{VpnBundle, vpn_encode};
use awg_shared::{CoreError, CoreResult};

use crate::application::DeviceProfile;
use crate::domain::{Device, DevicePeer, DevicePeerRepository, DeviceRepository};

pub struct ProfileService {
    devices: Arc<dyn DeviceRepository>,
    peers: Arc<dyn DevicePeerRepository>,
    network: Arc<NetworkService>,
    sealer: Arc<Sealer>,
    dns: Vec<String>,
    allowed_ips: Vec<String>,
    persistent_keepalive: (u16, u16),
}

impl ProfileService {
    pub fn new(
        devices: Arc<dyn DeviceRepository>,
        peers: Arc<dyn DevicePeerRepository>,
        network: Arc<NetworkService>,
        sealer: Arc<Sealer>,
        dns: Vec<String>,
    ) -> Self {
        Self {
            devices,
            peers,
            network,
            sealer,
            dns,
            allowed_ips: vec!["0.0.0.0/0".into(), "::/0".into()],
            persistent_keepalive: (15, 25),
        }
    }

    pub fn build_all(&self, device_id: Uuid) -> CoreResult<(Device, Vec<DeviceProfile>)> {
        let device = self
            .devices
            .find(device_id)?
            .ok_or_else(|| CoreError::NotFound("device".into()))?;
        if device.revoked {
            return Err(CoreError::Forbidden("device is revoked".into()));
        }
        if device.external {
            return Err(external_profile_error());
        }
        let pools = self.network.list_pools(device.group_id)?;
        let pool_map: HashMap<Uuid, _> = pools.iter().map(|p| (p.id, p)).collect();
        let peer = self
            .peers
            .find(device_id, device.interface_id)?
            .or_else(|| {
                let peers = self.peers.by_device(device_id).ok()?;
                if peers.len() == 1 {
                    peers.into_iter().next()
                } else {
                    None
                }
            })
            .ok_or_else(|| CoreError::NotFound("device peer".into()))?;
        let profile = self.build(device_id, &device, &peer, &pool_map)?;
        Ok((device, vec![profile]))
    }

    pub fn build_one(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<DeviceProfile> {
        let device = self
            .devices
            .find(device_id)?
            .ok_or_else(|| CoreError::NotFound("device".into()))?;
        if device.revoked {
            return Err(CoreError::Forbidden("device is revoked".into()));
        }
        if device.external {
            return Err(external_profile_error());
        }
        let peer = self
            .peers
            .find(device_id, interface_id)?
            .ok_or_else(|| CoreError::NotFound("device peer".into()))?;
        let pools = self.network.list_pools(device.group_id)?;
        let pool_map: HashMap<Uuid, _> = pools.iter().map(|p| (p.id, p)).collect();
        self.build(device_id, &device, &peer, &pool_map)
    }

    fn build(
        &self,
        _device_id: Uuid,
        device: &Device,
        peer: &DevicePeer,
        pools: &HashMap<Uuid, &awg_network::CidrPool>,
    ) -> CoreResult<DeviceProfile> {
        let interface = self.network.get_interface(peer.interface_id)?;
        if !interface.enabled {
            return Err(CoreError::Conflict("interface is disabled".into()));
        }
        let mut addresses = Vec::new();
        for (pool_id, ip) in &peer.ips {
            if let Some(pool) = pools.get(pool_id) {
                let net = self.network.pool_net(pool)?;
                if let std::net::IpAddr::V4(v4) = ip {
                    addresses.push(address_with_prefix(*v4, net));
                }
            }
        }
        if peer.private_key_sealed.is_empty() {
            return Err(external_profile_error());
        }
        let private_key = self.sealer.open_str(&peer.private_key_sealed)?;
        let preshared_key = if peer.preshared_key_sealed.is_empty() {
            String::new()
        } else {
            self.sealer.open_str(&peer.preshared_key_sealed)?
        };
        let preshared_key = if preshared_key.is_empty() {
            None
        } else {
            Some(preshared_key)
        };
        let endpoint = format_endpoint(&interface.endpoint_host, interface.endpoint_port);

        let conf = render_client_conf(ClientConfParams {
            private_key: &private_key,
            addresses: &addresses,
            dns: &self.dns,
            mtu: interface.mtu,
            server_public_key: &interface.public_key,
            preshared_key: preshared_key.as_deref(),
            endpoint: &endpoint,
            allowed_ips: &self.allowed_ips,
            obf: &interface.obf,
            client: &peer.client_obf,
            persistent_keepalive: self.persistent_keepalive,
        });

        let vpn_link = vpn_encode(VpnBundle {
            conf: &conf,
            name: &device.name,
            host: &interface.endpoint_host,
            dns: &self.dns,
            client_obf: &peer.client_obf,
        })?;

        Ok(DeviceProfile {
            interface_id: interface.id,
            interface_name: interface.name,
            node_id: interface.node_id,
            endpoint,
            addresses,
            conf,
            vpn_link,
        })
    }
}

fn external_profile_error() -> CoreError {
    CoreError::Conflict(
        "external peer has no client profile: it was imported from the server configuration".into(),
    )
}

fn format_endpoint(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}
