pub mod profiles;
pub mod share;

pub use profiles::ProfileService;
pub use share::ShareService;

use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
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
    validate_device_name, validate_peer_label,
};

#[derive(Debug, Clone)]
pub struct NewDevice {
    pub user_id: Uuid,
    pub group_id: Option<Uuid>,
    pub interface_id: Option<Uuid>,
    pub interface_ids: Vec<Uuid>,
    pub name: String,
    pub down_kbps: u32,
    pub up_kbps: u32,
    pub forwarding: Forwarding,
}

#[derive(Debug, Clone, Default)]
pub struct PeerChangeSet {
    pub name: Option<String>,
    pub ips: Option<std::collections::BTreeMap<Uuid, IpAddr>>,
    pub preshared_key: Option<String>,
    pub private_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PeerUndo {
    pub device: Device,
    pub peer: DevicePeer,
}

#[derive(Debug, Clone)]
pub struct DeviceProfile {
    pub peer_id: Uuid,
    pub label: String,
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
    group_locks: std::sync::Mutex<HashMap<Uuid, Arc<AsyncMutex<()>>>>,
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
            group_locks: std::sync::Mutex::new(HashMap::new()),
        }
    }

    async fn lock_group(&self, group_id: Uuid) -> OwnedMutexGuard<()> {
        let mutex = {
            let mut locks = self
                .group_locks
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            locks.retain(|existing, mutex| *existing == group_id || Arc::strong_count(mutex) > 1);
            locks
                .entry(group_id)
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        mutex.lock_owned().await
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

    pub async fn create(
        &self,
        user: &User,
        tariff: &Tariff,
        input: NewDevice,
        settings: &ObfuscationSettings,
    ) -> CoreResult<Device> {
        user.ensure_active()?;
        validate_device_name(&input.name)?;
        if let (Some(own), Some(requested)) = (user.group_id, input.group_id)
            && own != requested
        {
            return Err(CoreError::Forbidden(
                "user may only create devices in their own group".into(),
            ));
        }
        let group_id = input.group_id.or(user.group_id);
        let interfaces = self.resolve_interfaces(
            user,
            group_id,
            tariff,
            input.interface_id,
            &input.interface_ids,
        )?;
        let primary = interfaces
            .first()
            .cloned()
            .ok_or_else(|| CoreError::Invalid("at least one interface is required".into()))?;
        let group = self.network.get_group(primary.group_id)?;
        let _lock = self.lock_group(group.id).await;
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

        let now = Utc::now();
        let device = Device {
            id: Uuid::new_v4(),
            user_id: user.id,
            group_id: group.id,
            interface_id: primary.id,
            name: input.name.trim().to_string(),
            down_kbps: down,
            up_kbps: up,
            forwarding: ForwardingPolicy::normalize(input.forwarding),
            revoked: false,
            external: false,
            created_at: now,
            updated_at: now,
        };
        ForwardingPolicy::validate(&device, &existing)?;

        let all_peers = self.peers.list()?;
        let mut used: HashSet<IpAddr> = all_peers
            .iter()
            .flat_map(|p| p.ips.values().copied())
            .collect();

        let mut peers = Vec::with_capacity(interfaces.len());
        for interface in &interfaces {
            let ips = self.allocate_ips(
                interface.group_id,
                seed_from_uuid(device.id) ^ seed_from_uuid(interface.id),
                &mut used,
            )?;

            let keypair = generate_keypair();
            let psk = random_key();
            peers.push(DevicePeer {
                id: Uuid::new_v4(),
                device_id: device.id,
                interface_id: interface.id,
                label: interface.name.clone(),
                public_key: keypair.public_key,
                private_key_sealed: self.sealer.seal_str(&keypair.private_key)?,
                preshared_key_sealed: self.sealer.seal_str(&psk)?,
                ips,
                client_obf: generate_client_obf(settings),
                created_at: now,
            });
        }

        self.devices.save(&device)?;
        if let Err(error) = peers.iter().try_for_each(|peer| self.peers.save(peer)) {
            let _ = self.peers.delete_for_device(device.id);
            let _ = self.devices.delete(device.id);
            return Err(error);
        }
        Ok(device)
    }

    fn allocate_ips(
        &self,
        group_id: Uuid,
        seed: u64,
        used: &mut HashSet<IpAddr>,
    ) -> CoreResult<std::collections::BTreeMap<Uuid, IpAddr>> {
        let interface_group = self.network.get_group(group_id)?;
        let pools = self.network.list_pools(interface_group.id)?;
        let enabled_pools: Vec<_> = pools.into_iter().filter(|p| p.enabled).collect();
        if enabled_pools.is_empty() {
            return Err(CoreError::Conflict(
                "group has no enabled address pools".into(),
            ));
        }

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
                &to_v4(used),
                seed ^ seed_from_uuid(pool.id),
                gateway,
            )?;
            used.insert(IpAddr::V4(ip));
            ips.insert(pool.id, IpAddr::V4(ip));
        }
        Ok(ips)
    }

    pub async fn add_peer(
        &self,
        user: &User,
        _tariff: &Tariff,
        device_id: Uuid,
        interface_id: Uuid,
        label: Option<String>,
        settings: &ObfuscationSettings,
    ) -> CoreResult<DevicePeer> {
        user.ensure_active()?;
        let device = self.get(device_id)?;
        if device.user_id != user.id {
            return Err(CoreError::Forbidden(
                "device belongs to another user".into(),
            ));
        }
        if device.revoked {
            return Err(CoreError::Conflict("device is revoked".into()));
        }
        if device.external {
            return Err(CoreError::Conflict(
                "external device cannot host additional peers".into(),
            ));
        }
        let interface = self.ensure_interface_enabled(self.network.get_interface(interface_id)?)?;
        if interface.group_id != device.group_id {
            return Err(CoreError::Forbidden(
                "interface belongs to another group".into(),
            ));
        }
        if let Some(node_id) = user.node_id
            && interface.node_id != node_id
        {
            return Err(CoreError::Forbidden(
                "interface belongs to another node".into(),
            ));
        }
        if !device.interface_id.is_nil()
            && let Ok(primary) = self.network.get_interface(device.interface_id)
            && primary.node_id != interface.node_id
        {
            return Err(CoreError::Forbidden(
                "interface belongs to another node".into(),
            ));
        }

        let label = match label {
            Some(label) => {
                validate_peer_label(&label)?;
                label.trim().to_string()
            }
            None => interface.name.clone(),
        };

        let _lock = self.lock_group(device.group_id).await;
        let all_peers = self.peers.list()?;
        let mut used: HashSet<IpAddr> = all_peers
            .iter()
            .flat_map(|p| p.ips.values().copied())
            .collect();
        let peer_id = Uuid::new_v4();
        let ips = self.allocate_ips(
            interface.group_id,
            seed_from_uuid(device.id) ^ seed_from_uuid(interface.id) ^ seed_from_uuid(peer_id),
            &mut used,
        )?;

        let keypair = generate_keypair();
        let psk = random_key();
        let peer = DevicePeer {
            id: peer_id,
            device_id,
            interface_id,
            label,
            public_key: keypair.public_key,
            private_key_sealed: self.sealer.seal_str(&keypair.private_key)?,
            preshared_key_sealed: self.sealer.seal_str(&psk)?,
            ips,
            client_obf: generate_client_obf(settings),
            created_at: Utc::now(),
        };
        self.peers.save(&peer)?;
        Ok(peer)
    }

    pub fn remove_peer(&self, peer_id: Uuid) -> CoreResult<DevicePeer> {
        let peer = self
            .peers
            .find_peer(peer_id)?
            .ok_or_else(|| CoreError::NotFound("device peer".into()))?;
        let peers = self.peers.by_device(peer.device_id)?;
        if peers.len() <= 1 {
            return Err(CoreError::Conflict(
                "device must keep at least one peer".into(),
            ));
        }
        self.peers.delete_peer(peer_id)?;
        Ok(peer)
    }

    pub fn rename_peer(&self, peer_id: Uuid, label: String) -> CoreResult<DevicePeer> {
        validate_peer_label(&label)?;
        let mut peer = self
            .peers
            .find_peer(peer_id)?
            .ok_or_else(|| CoreError::NotFound("device peer".into()))?;
        peer.label = label.trim().to_string();
        self.peers.save(&peer)?;
        Ok(peer)
    }

    pub fn peer(&self, peer_id: Uuid) -> CoreResult<DevicePeer> {
        self.peers
            .find_peer(peer_id)?
            .ok_or_else(|| CoreError::NotFound("device peer".into()))
    }

    fn resolve_interfaces(
        &self,
        user: &User,
        group_id: Option<Uuid>,
        tariff: &Tariff,
        requested: Option<Uuid>,
        requested_many: &[Uuid],
    ) -> CoreResult<Vec<awg_network::Interface>> {
        if let Some(interface_id) = tariff.interface_id {
            let interface =
                self.ensure_interface_enabled(self.network.get_interface(interface_id)?)?;
            self.validate_interface_scope(user, group_id, &interface)?;
            return Ok(vec![interface]);
        }

        let mut requested_ids: Vec<Uuid> = Vec::new();
        for id in requested_many {
            if !requested_ids.contains(id) {
                requested_ids.push(*id);
            }
        }
        if requested_ids.is_empty()
            && let Some(id) = requested
        {
            requested_ids.push(id);
        }

        if requested_ids.is_empty() {
            return Ok(vec![self.auto_interface(user, group_id)?]);
        }

        let mut interfaces = Vec::with_capacity(requested_ids.len());
        for id in requested_ids {
            let interface = self.ensure_interface_enabled(self.network.get_interface(id)?)?;
            self.validate_interface_scope(user, group_id, &interface)?;
            interfaces.push(interface);
        }
        let primary_group = interfaces[0].group_id;
        if interfaces
            .iter()
            .any(|interface| interface.group_id != primary_group)
        {
            return Err(CoreError::Forbidden(
                "interfaces belong to different groups".into(),
            ));
        }
        Ok(interfaces)
    }

    fn auto_interface(
        &self,
        user: &User,
        group_id: Option<Uuid>,
    ) -> CoreResult<awg_network::Interface> {
        let interface = if let Some(node_id) = user.node_id {
            self.interface_for_node(node_id)?
        } else if let Some(group_id) = group_id {
            self.interface_for_group(group_id)?
        } else {
            return Err(CoreError::Invalid(
                "user has no node assigned; interface_id is required".into(),
            ));
        };
        self.validate_interface_scope(user, group_id, &interface)?;
        Ok(interface)
    }

    fn validate_interface_scope(
        &self,
        user: &User,
        group_id: Option<Uuid>,
        interface: &awg_network::Interface,
    ) -> CoreResult<()> {
        if let Some(node_id) = user.node_id
            && interface.node_id != node_id
        {
            return Err(CoreError::Forbidden(
                "interface belongs to another node".into(),
            ));
        }
        if let Some(group_id) = group_id
            && interface.group_id != group_id
        {
            return Err(CoreError::Forbidden(
                "interface belongs to another group".into(),
            ));
        }
        Ok(())
    }

    fn interface_for_node(&self, node_id: Uuid) -> CoreResult<awg_network::Interface> {
        let enabled: Vec<awg_network::Interface> = self
            .network
            .interfaces_by_node(node_id)?
            .into_iter()
            .filter(|interface| interface.enabled)
            .collect();
        match enabled.len() {
            0 => Err(CoreError::Invalid("node has no enabled interfaces".into())),
            1 => enabled
                .into_iter()
                .next()
                .ok_or_else(|| CoreError::Invalid("interface is missing".into())),
            _ => Err(CoreError::Invalid(
                "node has multiple enabled interfaces; interface_id is required".into(),
            )),
        }
    }

    fn interface_for_group(&self, group_id: Uuid) -> CoreResult<awg_network::Interface> {
        let enabled: Vec<awg_network::Interface> = self
            .network
            .interfaces_by_group(group_id)?
            .into_iter()
            .filter(|interface| interface.enabled)
            .collect();
        match enabled.len() {
            0 => Err(CoreError::Invalid(
                "group has no enabled interfaces yet".into(),
            )),
            1 => enabled
                .into_iter()
                .next()
                .ok_or_else(|| CoreError::Invalid("interface is missing".into())),
            _ => Err(CoreError::Invalid(
                "group has multiple enabled interfaces; interface_id is required".into(),
            )),
        }
    }

    fn ensure_interface_enabled(
        &self,
        interface: awg_network::Interface,
    ) -> CoreResult<awg_network::Interface> {
        if !interface.enabled {
            return Err(CoreError::Conflict("interface is disabled".into()));
        }
        Ok(interface)
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
            device.forwarding = ForwardingPolicy::normalize(forwarding);
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
            interface_id,
            name: name.trim().to_string(),
            down_kbps: 0,
            up_kbps: 0,
            forwarding: Forwarding::default(),
            revoked: false,
            external: false,
            created_at: now,
            updated_at: now,
        };
        let peer = DevicePeer {
            id: Uuid::new_v4(),
            device_id: device.id,
            interface_id,
            label: name.trim().to_string(),
            public_key: public_key.to_string(),
            private_key_sealed: self.sealer.seal_str(private_key)?,
            preshared_key_sealed: self.sealer.seal_str(preshared_key)?,
            ips,
            client_obf,
            created_at: now,
        };
        self.devices.save(&device)?;
        if let Err(error) = self.peers.save(&peer) {
            let _ = self.devices.delete(device.id);
            return Err(error);
        }
        Ok(device)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn import_external_peer(
        &self,
        user_id: Uuid,
        group_id: Uuid,
        name: &str,
        interface_id: Uuid,
        public_key: &str,
        preshared_key: &str,
        ips: std::collections::BTreeMap<Uuid, std::net::IpAddr>,
    ) -> CoreResult<Device> {
        validate_device_name(name)?;
        if public_key.trim().is_empty() {
            return Err(CoreError::Invalid("peer public key is required".into()));
        }
        if ips.is_empty() {
            return Err(CoreError::Invalid(
                "external peer needs at least one address".into(),
            ));
        }
        self.network.get_group(group_id)?;
        self.network.get_interface(interface_id)?;
        let now = Utc::now();
        let device = Device {
            id: Uuid::new_v4(),
            user_id,
            group_id,
            interface_id,
            name: name.trim().to_string(),
            down_kbps: 0,
            up_kbps: 0,
            forwarding: Forwarding::default(),
            revoked: false,
            external: true,
            created_at: now,
            updated_at: now,
        };
        let peer = DevicePeer {
            id: Uuid::new_v4(),
            device_id: device.id,
            interface_id,
            label: name.trim().to_string(),
            public_key: public_key.to_string(),
            private_key_sealed: String::new(),
            preshared_key_sealed: if preshared_key.is_empty() {
                String::new()
            } else {
                self.sealer.seal_str(preshared_key)?
            },
            ips,
            client_obf: awg_shared::obf::ClientObf {
                jc: 0,
                jmin: 0,
                jmax: 0,
                i1: String::new(),
                i2: String::new(),
                i3: String::new(),
                i4: String::new(),
                i5: String::new(),
                disable_cookies: false,
                keepalive_low: awg_shared::obf::default_keepalive_low(),
                keepalive_high: awg_shared::obf::default_keepalive_high(),
            },
            created_at: now,
        };
        self.devices.save(&device)?;
        if let Err(error) = self.peers.save(&peer) {
            let _ = self.devices.delete(device.id);
            return Err(error);
        }
        Ok(device)
    }

    pub fn apply_peer_update(
        &self,
        device_id: Uuid,
        interface_id: Uuid,
        changes: PeerChangeSet,
    ) -> CoreResult<Device> {
        self.apply_peer_update_tracked(device_id, interface_id, changes)
            .map(|(device, _)| device)
    }

    /// Applies an import-style peer update and returns the previous state so
    /// that a failed batch import can restore exactly this peer and device.
    pub fn apply_peer_update_tracked(
        &self,
        device_id: Uuid,
        interface_id: Uuid,
        changes: PeerChangeSet,
    ) -> CoreResult<(Device, PeerUndo)> {
        let mut device = self.get(device_id)?;
        let mut peer = self
            .peers
            .find(device_id, interface_id)?
            .ok_or_else(|| CoreError::NotFound("device peer".into()))?;
        let undo = PeerUndo {
            device: device.clone(),
            peer: peer.clone(),
        };
        if let Some(name) = changes.name {
            validate_device_name(&name)?;
            device.name = name.trim().to_string();
        }
        if let Some(ips) = changes.ips {
            if ips.is_empty() {
                return Err(CoreError::Invalid(
                    "device peer needs at least one address".into(),
                ));
            }
            peer.ips = ips;
        }
        if let Some(preshared_key) = changes.preshared_key {
            peer.preshared_key_sealed = if preshared_key.is_empty() {
                String::new()
            } else {
                self.sealer.seal_str(&preshared_key)?
            };
        }
        if let Some(private_key) = changes.private_key {
            peer.private_key_sealed = self.sealer.seal_str(&private_key)?;
            device.external = false;
        }
        let now = Utc::now();
        device.updated_at = now;
        self.peers.save(&peer)?;
        if let Err(error) = self.devices.save(&device) {
            let _ = self.peers.save(&undo.peer);
            return Err(error);
        }
        Ok((device, undo))
    }

    pub fn restore_peer(&self, undo: &PeerUndo) -> CoreResult<()> {
        self.peers.save(&undo.peer)?;
        self.devices.save(&undo.device)
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

    pub fn peers_for_devices(&self, device_ids: &[Uuid]) -> CoreResult<Vec<DevicePeer>> {
        self.peers.by_devices(device_ids)
    }

    pub fn all_peers(&self) -> CoreResult<Vec<DevicePeer>> {
        self.peers.list()
    }

    pub fn peers_for_interface(&self, interface_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
        self.peers.by_interface(interface_id)
    }

    pub fn peer_secrets(&self, peer: &DevicePeer) -> CoreResult<(String, String)> {
        let private_key = if peer.private_key_sealed.is_empty() {
            String::new()
        } else {
            self.sealer.open_str(&peer.private_key_sealed)?
        };
        Ok((private_key, self.peer_preshared_key(peer)?))
    }

    pub fn peer_preshared_key(&self, peer: &DevicePeer) -> CoreResult<String> {
        if peer.preshared_key_sealed.is_empty() {
            return Ok(String::new());
        }
        self.sealer.open_str(&peer.preshared_key_sealed)
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
