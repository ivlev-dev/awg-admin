pub mod profiles;
pub mod share;

pub use profiles::ProfileService;
pub use share::ShareService;

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use awg_identity::User;
use awg_network::NetworkService;
use awg_shared::cidr::seed_from_uuid;
use awg_shared::crypto::{Sealer, generate_keypair, random_key};
use awg_shared::obf::{ObfuscationSettings, generate_client_obf};
use awg_shared::{CoreError, CoreResult};
use awg_tariffs::{LimitPolicy, Tariff, TariffService};

use crate::domain::{
    Device, DevicePeer, DevicePeerRepository, DeviceRepository, Forwarding, ForwardingPolicy,
    validate_device_name,
};

#[derive(Debug, Clone)]
pub struct NewDevice {
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub down_kbps: u32,
    pub up_kbps: u32,
    pub forwarding: Forwarding,
}

#[derive(Debug, Clone)]
pub struct DeviceProfile {
    pub interface_id: Uuid,
    pub interface_name: String,
    pub node_id: Uuid,
    pub endpoint: String,
    pub addresses: Vec<String>,
    pub conf: String,
    pub vpn_link: String,
}

pub struct DeviceService {
    devices: Arc<dyn DeviceRepository>,
    peers: Arc<dyn DevicePeerRepository>,
    network: Arc<NetworkService>,
    tariffs: Arc<TariffService>,
    sealer: Arc<Sealer>,
}

impl DeviceService {
    pub fn new(
        devices: Arc<dyn DeviceRepository>,
        peers: Arc<dyn DevicePeerRepository>,
        network: Arc<NetworkService>,
        tariffs: Arc<TariffService>,
        sealer: Arc<Sealer>,
    ) -> Self {
        Self {
            devices,
            peers,
            network,
            tariffs,
            sealer,
        }
    }

    pub fn list_all(&self) -> CoreResult<Vec<Device>> {
        self.devices.list()
    }

    pub fn list_for_user(&self, user_id: Uuid) -> CoreResult<Vec<Device>> {
        self.devices.by_user(user_id)
    }

    pub fn get(&self, id: Uuid) -> CoreResult<Device> {
        self.devices
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("device".into()))
    }

    pub fn create(
        &self,
        user: &User,
        tariff: &Tariff,
        input: NewDevice,
        settings: &ObfuscationSettings,
    ) -> CoreResult<Device> {
        user.ensure_active()?;
        validate_device_name(&input.name)?;
        let group_id = user.group_id.unwrap_or(input.group_id);
        if user.group_id.is_some() && user.group_id != Some(input.group_id) {
            return Err(CoreError::Forbidden(
                "user may only create devices in their own group".into(),
            ));
        }
        let group = self.network.get_group(group_id)?;
        let interfaces = self.network.interfaces_by_group(group_id)?;
        if interfaces.iter().filter(|i| i.enabled).count() == 0 {
            return Err(CoreError::Conflict(
                "group has no enabled interfaces yet".into(),
            ));
        }
        let existing = self.devices.by_user(user.id)?;
        if existing.iter().filter(|d| !d.revoked).count() as u32 >= tariff.max_devices {
            return Err(CoreError::Conflict(format!(
                "tariff allows at most {} devices",
                tariff.max_devices
            )));
        }
        let (down, up) = LimitPolicy::resolve_device_limits(tariff, input.down_kbps, input.up_kbps);
        let mut limits: Vec<(u32, u32)> = existing
            .iter()
            .filter(|d| !d.revoked)
            .map(|d| (d.down_kbps, d.up_kbps))
            .collect();
        limits.push((down, up));
        LimitPolicy::validate_group_sum(tariff, &limits)?;

        let pools = self.network.list_pools(group.id)?;
        let enabled_pools: Vec<_> = pools.into_iter().filter(|p| p.enabled).collect();
        if enabled_pools.is_empty() {
            return Err(CoreError::Conflict(
                "group has no enabled address pools".into(),
            ));
        }

        let now = Utc::now();
        let device = Device {
            id: Uuid::new_v4(),
            user_id: user.id,
            group_id: group.id,
            name: input.name.trim().to_string(),
            down_kbps: down,
            up_kbps: up,
            forwarding: input.forwarding,
            revoked: false,
            created_at: now,
            updated_at: now,
        };
        ForwardingPolicy::validate(&device, &existing)?;

        let all_peers = self.peers.list()?;
        let mut used: HashSet<IpAddr> = all_peers
            .iter()
            .flat_map(|p| p.ips.values().copied())
            .collect();

        let mut ips = std::collections::BTreeMap::new();
        for pool in &enabled_pools {
            let net = self.network.pool_net(pool)?;
            let gateway = pool
                .gateway
                .as_deref()
                .and_then(|g| g.split('/').next())
                .and_then(|g| g.parse().ok());
            let ip = awg_network::SubnetAllocator::allocate(
                net,
                &to_v4(&used),
                seed_from_uuid(device.id) ^ seed_from_uuid(pool.id),
                gateway,
            )?;
            used.insert(IpAddr::V4(ip));
            ips.insert(pool.id, IpAddr::V4(ip));
        }

        let mut peers = Vec::new();
        for interface in interfaces.iter().filter(|i| i.enabled) {
            let keypair = generate_keypair();
            let psk = random_key();
            peers.push(DevicePeer {
                device_id: device.id,
                interface_id: interface.id,
                public_key: keypair.public_key,
                private_key_sealed: self.sealer.seal_str(&keypair.private_key)?,
                preshared_key_sealed: self.sealer.seal_str(&psk)?,
                ips: ips.clone(),
                client_obf: generate_client_obf(settings),
                created_at: now,
            });
        }

        self.devices.save(&device)?;
        for peer in &peers {
            self.peers.save(peer)?;
        }
        Ok(device)
    }

    pub fn update(
        &self,
        id: Uuid,
        tariff: &Tariff,
        name: Option<String>,
        down_kbps: Option<u32>,
        up_kbps: Option<u32>,
        forwarding: Option<Forwarding>,
    ) -> CoreResult<Device> {
        let mut device = self.get(id)?;
        let user_devices = self.devices.by_user(device.user_id)?;
        if let Some(name) = name {
            validate_device_name(&name)?;
            device.name = name.trim().to_string();
        }
        if let Some(down) = down_kbps {
            device.down_kbps = down;
        }
        if let Some(up) = up_kbps {
            device.up_kbps = up;
        }
        let (down, up) =
            LimitPolicy::resolve_device_limits(tariff, device.down_kbps, device.up_kbps);
        device.down_kbps = down;
        device.up_kbps = up;
        if let Some(forwarding) = forwarding {
            device.forwarding = forwarding;
        }
        ForwardingPolicy::validate(&device, &user_devices)?;
        let mut limits: Vec<(u32, u32)> = user_devices
            .iter()
            .filter(|d| !d.revoked && d.id != device.id)
            .map(|d| (d.down_kbps, d.up_kbps))
            .collect();
        limits.push((device.down_kbps, device.up_kbps));
        LimitPolicy::validate_group_sum(tariff, &limits)?;
        device.updated_at = Utc::now();
        self.devices.save(&device)?;
        Ok(device)
    }

    pub fn apply_limits(&self, id: Uuid, down: u32, up: u32) -> CoreResult<Device> {
        let mut device = self.get(id)?;
        device.down_kbps = down;
        device.up_kbps = up;
        device.updated_at = Utc::now();
        self.devices.save(&device)?;
        Ok(device)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn import_device(
        &self,
        user_id: Uuid,
        group_id: Uuid,
        name: &str,
        interface_id: Uuid,
        private_key: &str,
        public_key: &str,
        preshared_key: &str,
        ips: std::collections::BTreeMap<Uuid, std::net::IpAddr>,
        client_obf: awg_shared::obf::ClientObf,
    ) -> CoreResult<Device> {
        validate_device_name(name)?;
        self.network.get_group(group_id)?;
        self.network.get_interface(interface_id)?;
        let now = Utc::now();
        let device = Device {
            id: Uuid::new_v4(),
            user_id,
            group_id,
            name: name.trim().to_string(),
            down_kbps: 0,
            up_kbps: 0,
            forwarding: Forwarding::default(),
            revoked: false,
            created_at: now,
            updated_at: now,
        };
        let peer = DevicePeer {
            device_id: device.id,
            interface_id,
            public_key: public_key.to_string(),
            private_key_sealed: self.sealer.seal_str(private_key)?,
            preshared_key_sealed: self.sealer.seal_str(preshared_key)?,
            ips,
            client_obf,
            created_at: now,
        };
        self.devices.save(&device)?;
        self.peers.save(&peer)?;
        Ok(device)
    }

    pub fn revoke(&self, id: Uuid, revoked: bool) -> CoreResult<Device> {
        let mut device = self.get(id)?;
        device.revoked = revoked;
        device.updated_at = Utc::now();
        self.devices.save(&device)?;
        Ok(device)
    }

    pub fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.peers.delete_for_device(id)?;
        self.devices.delete(id)
    }

    pub fn peers_for(&self, device_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
        self.peers.by_device(device_id)
    }

    pub fn all_peers(&self) -> CoreResult<Vec<DevicePeer>> {
        self.peers.list()
    }

    pub fn peers_for_interface(&self, interface_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
        self.peers.by_interface(interface_id)
    }

    pub fn peer_secrets(&self, peer: &DevicePeer) -> CoreResult<(String, String)> {
        Ok((
            self.sealer.open_str(&peer.private_key_sealed)?,
            self.sealer.open_str(&peer.preshared_key_sealed)?,
        ))
    }

    pub fn tariff_for(&self, user: &User) -> CoreResult<Option<Tariff>> {
        match user.tariff_id {
            Some(id) => self.tariffs.get(id).map(Some),
            None => Ok(None),
        }
    }
}

fn to_v4(set: &HashSet<IpAddr>) -> HashSet<std::net::Ipv4Addr> {
    set.iter()
        .filter_map(|ip| match ip {
            IpAddr::V4(v4) => Some(*v4),
            IpAddr::V6(_) => None,
        })
        .collect()
}
