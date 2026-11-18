use std::collections::HashMap;
use std::sync::Arc;

use ipnet::Ipv4Net;
use uuid::Uuid;

use awg_clients::{DevicePeer, DeviceService, ForwardingPolicy};
use awg_identity::IdentityService;
use awg_network::{CidrPool, NetworkService};
use awg_orchestration::{
    DesiredInterface, DesiredPeer, DesiredState, ForwardingRule, SnapshotSource, UserLimit,
};
use awg_shared::cidr::{address_with_prefix, parse_net};
use awg_statistics::{StatsScope, StatsService};
use awg_tariffs::{Tariff, TariffService};

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
            if let Some(tariff_id) = user.tariff_id
                && !tariffs.contains_key(&tariff_id)
                && let Ok(tariff) = self.tariffs.get(tariff_id)
            {
                tariffs.insert(tariff_id, tariff);
            }
        }
        let mut user_tariffs: HashMap<Uuid, &Tariff> = HashMap::new();
        for user in &users {
            if let Some(tariff_id) = user.tariff_id
                && let Some(tariff) = tariffs.get(&tariff_id)
            {
                user_tariffs.insert(user.id, tariff);
            }
        }

        let mut desired = Vec::with_capacity(interfaces.len());
        if interfaces.is_empty() {
            return Ok(DesiredState {
                node_id,
                revision: String::new(),
                generated_at: chrono::Utc::now(),
                interfaces: desired,
            });
        }

        let devices = self.devices.list_all()?;
        let mut devices_by_group: HashMap<Uuid, Vec<awg_clients::Device>> = HashMap::new();
        for device in devices {
            devices_by_group
                .entry(device.group_id)
                .or_default()
                .push(device);
        }

        let peers = self.devices.all_peers()?;
        let mut peer_index: HashMap<(Uuid, Uuid), &DevicePeer> = HashMap::new();
        for peer in &peers {
            peer_index
                .entry((peer.device_id, peer.interface_id))
                .or_insert(peer);
        }

        let pools = self.network.list_all_pools()?;
        let mut pools_by_group: HashMap<Uuid, Vec<&CidrPool>> = HashMap::new();
        let mut pool_by_id: HashMap<Uuid, &CidrPool> = HashMap::new();
        let mut pool_nets: HashMap<Uuid, Option<Ipv4Net>> = HashMap::new();
        for pool in &pools {
            pools_by_group.entry(pool.group_id).or_default().push(pool);
            pool_by_id.insert(pool.id, pool);
            pool_nets.insert(pool.id, parse_net(&pool.cidr).ok());
        }

        let mut used_cache: HashMap<Uuid, u64> = HashMap::new();

        for interface in interfaces {
            let group_devices: Vec<awg_clients::Device> = devices_by_group
                .get(&interface.group_id)
                .map(|devices| {
                    devices
                        .iter()
                        .filter(|device| device.interface_id == interface.id)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            let group_pools = pools_by_group
                .get(&interface.group_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);

            let mut server_addresses = Vec::new();
            for pool in group_pools {
                if !pool.enabled {
                    continue;
                }
                if let Some(gateway) = &pool.gateway {
                    if gateway.contains('/') {
                        server_addresses.push(gateway.clone());
                    } else if let Some(net) = pool_nets.get(&pool.id).copied().flatten() {
                        server_addresses.push(format!("{gateway}/{}", net.prefix_len()));
                    }
                }
            }

            let mut user_limits = Vec::new();
            for user in &users {
                if !group_devices
                    .iter()
                    .any(|d| d.user_id == user.id && !d.revoked)
                {
                    continue;
                }
                let (down, up) = match user_tariffs.get(&user.id) {
                    Some(tariff) => {
                        let used = used_bytes_cached(&self.stats, &mut used_cache, user.id);
                        if tariff.period_usage_exceeded(used) {
                            (1, 1)
                        } else {
                            (tariff.group_down_kbps, tariff.group_up_kbps)
                        }
                    }
                    None => (0, 0),
                };
                user_limits.push(UserLimit {
                    user_id: user.id,
                    group_down_kbps: down,
                    group_up_kbps: up,
                });
            }

            let mut peers = Vec::new();
            let mut peer_by_device: HashMap<Uuid, (Vec<String>, Vec<String>)> = HashMap::new();
            for device in group_devices.iter().filter(|d| !d.revoked) {
                let Some(peer) = peer_index.get(&(device.id, interface.id)).copied() else {
                    continue;
                };
                let preshared_key = self.devices.peer_preshared_key(peer)?;
                let used = used_bytes_cached(&self.stats, &mut used_cache, device.user_id);
                let blocked = user_tariffs
                    .get(&device.user_id)
                    .map(|t| t.period_usage_exceeded(used))
                    .unwrap_or(false);
                let (down, up) = if blocked {
                    (1, 1)
                } else {
                    (device.down_kbps, device.up_kbps)
                };
                let mut addresses = Vec::new();
                let mut allowed = Vec::new();
                for (pool_id, ip) in &peer.ips {
                    let Some(pool) = pool_by_id.get(pool_id) else {
                        continue;
                    };
                    if pool.group_id != interface.group_id {
                        continue;
                    }
                    if let Some(net) = pool_nets.get(pool_id).copied().flatten()
                        && let std::net::IpAddr::V4(v4) = ip
                    {
                        addresses.push(address_with_prefix(*v4, net));
                        allowed.push(format!("{v4}/32"));
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

fn used_bytes_cached(stats: &StatsService, cache: &mut HashMap<Uuid, u64>, user_id: Uuid) -> u64 {
    *cache.entry(user_id).or_insert_with(|| {
        stats
            .used_bytes(StatsScope::User(user_id))
            .unwrap_or_default()
    })
}

fn first_ip(address: Option<&String>) -> Option<String> {
    address.map(|value| value.split('/').next().unwrap_or(value).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::{BTreeMap, HashMap};
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use base64::Engine;
    use chrono::Utc;

    use awg_clients::domain::{DevicePeerRepository, DeviceRepository};
    use awg_clients::{
        Device, DevicePeer, Forwarding, RedbDevicePeerRepository, RedbDeviceRepository,
    };
    use awg_identity::domain::UserRepository;
    use awg_identity::{
        CaptureMailer, IdentityService, JwtIssuer, RedbEmailVerificationRepository,
        RedbUserRepository, Role, User, UserStatus,
    };
    use awg_network::domain::CidrPoolRepository;
    use awg_network::{
        CidrPool, NetworkService, NewInterface, NewPool, PoolMode, RedbCidrPoolRepository,
        RedbGroupRepository, RedbInterfaceRepository, RedbNodeRepository,
    };
    use awg_shared::CoreResult;
    use awg_shared::crypto::Sealer;
    use awg_shared::obf::{ClientObf, ObfuscationSettings};
    use awg_statistics::{Bucket, CounterState, StatsHub, StatsRepository, StatsScope};
    use awg_storage::Store;
    use awg_tariffs::{NewTariff, RedbTariffRepository, TariffService};

    struct CountingDevices {
        inner: RedbDeviceRepository,
        list_calls: AtomicUsize,
        by_user_calls: AtomicUsize,
        by_group_calls: AtomicUsize,
    }

    impl CountingDevices {
        fn new(inner: RedbDeviceRepository) -> Self {
            Self {
                inner,
                list_calls: AtomicUsize::new(0),
                by_user_calls: AtomicUsize::new(0),
                by_group_calls: AtomicUsize::new(0),
            }
        }

        fn reset(&self) {
            self.list_calls.store(0, Ordering::SeqCst);
            self.by_user_calls.store(0, Ordering::SeqCst);
            self.by_group_calls.store(0, Ordering::SeqCst);
        }
    }

    impl DeviceRepository for CountingDevices {
        fn find(&self, id: Uuid) -> CoreResult<Option<Device>> {
            self.inner.find(id)
        }

        fn list(&self) -> CoreResult<Vec<Device>> {
            self.list_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.list()
        }

        fn by_user(&self, user_id: Uuid) -> CoreResult<Vec<Device>> {
            self.by_user_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.by_user(user_id)
        }

        fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Device>> {
            self.by_group_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.by_group(group_id)
        }

        fn save(&self, device: &Device) -> CoreResult<()> {
            self.inner.save(device)
        }

        fn delete(&self, id: Uuid) -> CoreResult<()> {
            self.inner.delete(id)
        }
    }

    struct CountingPeers {
        inner: RedbDevicePeerRepository,
        list_calls: AtomicUsize,
        by_device_calls: AtomicUsize,
    }

    impl CountingPeers {
        fn new(inner: RedbDevicePeerRepository) -> Self {
            Self {
                inner,
                list_calls: AtomicUsize::new(0),
                by_device_calls: AtomicUsize::new(0),
            }
        }

        fn reset(&self) {
            self.list_calls.store(0, Ordering::SeqCst);
            self.by_device_calls.store(0, Ordering::SeqCst);
        }
    }

    impl DevicePeerRepository for CountingPeers {
        fn find(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<Option<DevicePeer>> {
            self.inner.find(device_id, interface_id)
        }

        fn list(&self) -> CoreResult<Vec<DevicePeer>> {
            self.list_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.list()
        }

        fn by_device(&self, device_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
            self.by_device_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.by_device(device_id)
        }

        fn by_interface(&self, interface_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
            self.inner.by_interface(interface_id)
        }

        fn save(&self, peer: &DevicePeer) -> CoreResult<()> {
            self.inner.save(peer)
        }

        fn delete_for_device(&self, device_id: Uuid) -> CoreResult<usize> {
            self.inner.delete_for_device(device_id)
        }

        fn delete(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<()> {
            self.inner.delete(device_id, interface_id)
        }
    }

    struct CountingPools {
        inner: RedbCidrPoolRepository,
        list_calls: AtomicUsize,
        by_group_calls: AtomicUsize,
    }

    impl CountingPools {
        fn new(inner: RedbCidrPoolRepository) -> Self {
            Self {
                inner,
                list_calls: AtomicUsize::new(0),
                by_group_calls: AtomicUsize::new(0),
            }
        }

        fn reset(&self) {
            self.list_calls.store(0, Ordering::SeqCst);
            self.by_group_calls.store(0, Ordering::SeqCst);
        }
    }

    impl CidrPoolRepository for CountingPools {
        fn find(&self, id: Uuid) -> CoreResult<Option<CidrPool>> {
            self.inner.find(id)
        }

        fn list(&self) -> CoreResult<Vec<CidrPool>> {
            self.list_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.list()
        }

        fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<CidrPool>> {
            self.by_group_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.by_group(group_id)
        }

        fn save(&self, pool: &CidrPool) -> CoreResult<()> {
            self.inner.save(pool)
        }

        fn delete(&self, id: Uuid) -> CoreResult<()> {
            self.inner.delete(id)
        }
    }

    struct CountingStats {
        series_calls: AtomicUsize,
        usage: HashMap<Uuid, u64>,
    }

    impl CountingStats {
        fn new(usage: HashMap<Uuid, u64>) -> Self {
            Self {
                series_calls: AtomicUsize::new(0),
                usage,
            }
        }

        fn reset(&self) {
            self.series_calls.store(0, Ordering::SeqCst);
        }

        fn used(&self) -> usize {
            self.series_calls.load(Ordering::SeqCst)
        }
    }

    impl StatsRepository for CountingStats {
        fn counter(
            &self,
            _node_id: Uuid,
            _interface_id: Uuid,
            _device_id: Uuid,
        ) -> CoreResult<Option<CounterState>> {
            Ok(None)
        }

        fn save_counter(
            &self,
            _node_id: Uuid,
            _interface_id: Uuid,
            _device_id: Uuid,
            _state: &CounterState,
        ) -> CoreResult<()> {
            Ok(())
        }

        fn add_bucket(&self, _scope: StatsScope, _hour: i64, _rx: u64, _tx: u64) -> CoreResult<()> {
            Ok(())
        }

        fn series(
            &self,
            scope: StatsScope,
            from_hour: i64,
            _to_hour: i64,
        ) -> CoreResult<Vec<Bucket>> {
            self.series_calls.fetch_add(1, Ordering::SeqCst);
            let Some(id) = scope.id() else {
                return Ok(Vec::new());
            };
            let used = self.usage.get(&id).copied().unwrap_or(0);
            if used == 0 {
                return Ok(Vec::new());
            }
            Ok(vec![Bucket {
                scope,
                hour: from_hour,
                rx: used,
                tx: 0,
            }])
        }

        fn cleanup_before(&self, _hour: i64) -> CoreResult<usize> {
            Ok(0)
        }
    }

    struct Fixture {
        builder: SnapshotBuilder,
        node_id: Uuid,
        iface_a1_id: Uuid,
        devices: Arc<CountingDevices>,
        peers: Arc<CountingPeers>,
        pools: Arc<CountingPools>,
        stats: Arc<CountingStats>,
    }

    impl Fixture {
        fn reset_calls(&self) {
            self.devices.reset();
            self.peers.reset();
            self.pools.reset();
            self.stats.reset();
        }
    }

    fn sealer() -> Arc<Sealer> {
        let key = base64::engine::general_purpose::STANDARD.encode([21u8; 32]);
        Arc::new(Sealer::from_master_key(&key).unwrap())
    }

    fn client_obf() -> ClientObf {
        ClientObf {
            jc: 0,
            jmin: 0,
            jmax: 0,
            i1: String::new(),
            i2: String::new(),
            i3: String::new(),
            i4: String::new(),
            i5: String::new(),
            disable_cookies: false,
        }
    }

    fn interface(name: &str) -> NewInterface {
        NewInterface {
            name: name.into(),
            label: name.into(),
            endpoint_host: "vpn.example.com".into(),
            endpoint_port: 51820,
            listen_port: 51820,
            mtu: 1420,
        }
    }

    fn device(user_id: Uuid, group_id: Uuid, name: &str, down: u32, up: u32) -> Device {
        let now = Utc::now();
        Device {
            id: Uuid::new_v4(),
            user_id,
            group_id,
            interface_id: Uuid::nil(),
            name: name.into(),
            down_kbps: down,
            up_kbps: up,
            forwarding: Forwarding::default(),
            revoked: false,
            external: false,
            created_at: now,
            updated_at: now,
        }
    }

    fn peer(
        sealer: &Sealer,
        device: &Device,
        interface_id: Uuid,
        public_key: &str,
        ips: BTreeMap<Uuid, IpAddr>,
    ) -> DevicePeer {
        DevicePeer {
            device_id: device.id,
            interface_id,
            public_key: public_key.into(),
            private_key_sealed: sealer.seal_str("private-key").unwrap(),
            preshared_key_sealed: sealer.seal_str("preshared-key").unwrap(),
            ips,
            client_obf: client_obf(),
            created_at: Utc::now(),
        }
    }

    fn user(login: &str, tariff_id: Option<Uuid>) -> User {
        let now = Utc::now();
        User {
            id: Uuid::new_v4(),
            login: login.into(),
            password_hash: String::new(),
            role: Role::User,
            tariff_id,
            group_id: None,
            disabled: false,
            email: None,
            status: UserStatus::Active,
            totp_secret_sealed: None,
            totp_enabled: false,
            recovery_codes: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    fn seed() -> Fixture {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let sealer = sealer();
        let devices_repo = Arc::new(CountingDevices::new(RedbDeviceRepository::new(
            store.clone(),
        )));
        let peers_repo = Arc::new(CountingPeers::new(RedbDevicePeerRepository::new(
            store.clone(),
        )));
        let pools_repo = Arc::new(CountingPools::new(RedbCidrPoolRepository::new(
            store.clone(),
        )));
        let network = Arc::new(NetworkService::new(
            Arc::new(RedbGroupRepository::new(store.clone())),
            Arc::new(RedbNodeRepository::new(store.clone())),
            Arc::new(RedbInterfaceRepository::new(store.clone())),
            pools_repo.clone(),
            sealer.clone(),
        ));
        let users_repo = Arc::new(RedbUserRepository::new(store.clone()));
        let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
            store.clone(),
        ))));

        let group_a = network
            .create_group("alpha", "", "10.0.0.0/12", false)
            .unwrap();
        let group_b = network
            .create_group("beta", "", "10.20.0.0/16", false)
            .unwrap();

        let pool_a = network
            .add_pool(
                group_a.id,
                NewPool {
                    name: "clients".into(),
                    cidr: "10.1.0.0/24".into(),
                    mode: PoolMode::Auto,
                    gateway: Some("10.1.0.1".into()),
                },
            )
            .unwrap();
        let pool_a_extra = network
            .add_pool(
                group_a.id,
                NewPool {
                    name: "guests".into(),
                    cidr: "10.2.0.0/24".into(),
                    mode: PoolMode::Auto,
                    gateway: None,
                },
            )
            .unwrap();
        let _pool_a_slash = network
            .add_pool(
                group_a.id,
                NewPool {
                    name: "slash".into(),
                    cidr: "10.3.0.0/24".into(),
                    mode: PoolMode::Auto,
                    gateway: Some("10.3.0.1/24".into()),
                },
            )
            .unwrap();
        let pool_a_disabled = network
            .add_pool(
                group_a.id,
                NewPool {
                    name: "disabled".into(),
                    cidr: "10.4.0.0/24".into(),
                    mode: PoolMode::Auto,
                    gateway: Some("10.4.0.1".into()),
                },
            )
            .unwrap();
        network
            .update_pool(pool_a_disabled.id, None, None, None, Some(false))
            .unwrap();
        let pool_b = network
            .add_pool(
                group_b.id,
                NewPool {
                    name: "clients".into(),
                    cidr: "10.20.0.0/24".into(),
                    mode: PoolMode::Auto,
                    gateway: None,
                },
            )
            .unwrap();

        let (node, _) = network.create_node("node-a").unwrap();
        let iface_a0 = network
            .add_interface(
                group_a.id,
                node.id,
                interface("awg0"),
                &ObfuscationSettings::default(),
            )
            .unwrap();
        let iface_a1 = network
            .add_interface(
                group_a.id,
                node.id,
                interface("awg1"),
                &ObfuscationSettings::default(),
            )
            .unwrap();
        let iface_b0 = network
            .add_interface(
                group_b.id,
                node.id,
                interface("awg2"),
                &ObfuscationSettings::default(),
            )
            .unwrap();

        let tariff_a = tariffs
            .create(NewTariff {
                name: "blocked".into(),
                description: String::new(),
                max_devices: 5,
                device_down_kbps: 5000,
                device_up_kbps: 2000,
                group_down_kbps: 10_000,
                group_up_kbps: 5000,
                traffic_quota_bytes: Some(1000),
                interface_id: None,
            })
            .unwrap();
        let tariff_b = tariffs
            .create(NewTariff {
                name: "free".into(),
                description: String::new(),
                max_devices: 5,
                device_down_kbps: 4000,
                device_up_kbps: 1500,
                group_down_kbps: 20_000,
                group_up_kbps: 8000,
                traffic_quota_bytes: None,
                interface_id: None,
            })
            .unwrap();

        let user_a = user("alpha", Some(tariff_a.id));
        let user_b = user("beta", Some(tariff_b.id));
        let user_c = user("gamma", None);

        let phone = Device {
            interface_id: iface_a0.id,
            forwarding: Forwarding {
                to_own_devices: true,
                allowed_devices: Vec::new(),
            },
            ..device(user_a.id, group_a.id, "phone", 3000, 1000)
        };
        let laptop = Device {
            interface_id: iface_a0.id,
            forwarding: Forwarding {
                to_own_devices: false,
                allowed_devices: vec![phone.id],
            },
            ..device(user_a.id, group_a.id, "laptop", 2000, 800)
        };
        let lonely = Device {
            interface_id: iface_a0.id,
            ..device(user_a.id, group_a.id, "lonely", 1500, 500)
        };
        let ghost = Device {
            interface_id: iface_a0.id,
            ..device(user_c.id, group_a.id, "ghost", 1200, 400)
        };
        let tablet = Device {
            interface_id: iface_b0.id,
            ..device(user_b.id, group_b.id, "tablet", 4000, 1500)
        };
        let revoked = Device {
            interface_id: iface_a0.id,
            revoked: true,
            ..device(user_a.id, group_a.id, "revoked", 900, 300)
        };

        let phone_ips = BTreeMap::from([
            (pool_a.id, IpAddr::V4(Ipv4Addr::new(10, 1, 0, 2))),
            (pool_a_extra.id, IpAddr::V4(Ipv4Addr::new(10, 2, 0, 5))),
        ]);
        let laptop_ips = BTreeMap::from([
            (pool_a.id, IpAddr::V4(Ipv4Addr::new(10, 1, 0, 3))),
            (pool_a_disabled.id, IpAddr::V4(Ipv4Addr::new(10, 4, 0, 9))),
        ]);
        let ghost_ips = BTreeMap::from([(pool_a.id, IpAddr::V4(Ipv4Addr::new(10, 1, 0, 4)))]);
        let tablet_ips = BTreeMap::from([(pool_b.id, IpAddr::V4(Ipv4Addr::new(10, 20, 0, 7)))]);
        let revoked_ips = BTreeMap::from([(pool_a.id, IpAddr::V4(Ipv4Addr::new(10, 1, 0, 5)))]);

        let peers = vec![
            peer(
                &sealer,
                &phone,
                iface_a0.id,
                "key-phone-a0",
                phone_ips.clone(),
            ),
            peer(&sealer, &laptop, iface_a0.id, "key-laptop-a0", laptop_ips),
            peer(&sealer, &ghost, iface_a0.id, "key-ghost-a0", ghost_ips),
            peer(&sealer, &tablet, iface_b0.id, "key-tablet-b0", tablet_ips),
            peer(
                &sealer,
                &revoked,
                iface_a0.id,
                "key-revoked-a0",
                revoked_ips,
            ),
        ];

        for item in [&phone, &laptop, &lonely, &ghost, &tablet, &revoked] {
            devices_repo.save(item).unwrap();
        }
        for item in &peers {
            peers_repo.save(item).unwrap();
        }
        for item in [&user_a, &user_b, &user_c] {
            users_repo.save(item).unwrap();
        }

        let identity = Arc::new(IdentityService::new(
            users_repo,
            Arc::new(awg_identity::Argon2Hasher::default()),
            Arc::new(JwtIssuer::new(
                b"test-secret-with-at-least-32-bytes!!",
                900,
                86_400,
                "awg-admin",
                "awg-admin",
                store.clone(),
            )),
            Arc::new(RedbEmailVerificationRepository::new(store.clone())),
            Arc::new(CaptureMailer::new()),
            sealer.clone(),
            "https://panel.test".into(),
        ));

        let stats = Arc::new(CountingStats::new(HashMap::from([(user_a.id, 5000)])));
        let devices = Arc::new(awg_clients::DeviceService::new(
            devices_repo.clone(),
            peers_repo.clone(),
            network.clone(),
            tariffs.clone(),
            sealer.clone(),
        ));

        Fixture {
            builder: SnapshotBuilder {
                network,
                devices,
                identity,
                tariffs,
                stats: Arc::new(StatsService::new(stats.clone(), Arc::new(StatsHub::new(8)))),
            },
            node_id: node.id,
            iface_a1_id: iface_a1.id,
            devices: devices_repo,
            peers: peers_repo,
            pools: pools_repo,
            stats,
        }
    }

    fn legacy_build(
        builder: &SnapshotBuilder,
        node_id: Uuid,
    ) -> awg_shared::CoreResult<DesiredState> {
        let interfaces = builder.network.interfaces_by_node(node_id)?;
        let mut users = builder.identity.list()?;
        users.sort_by_key(|u| u.id);
        let mut tariffs = HashMap::new();
        for user in &users {
            if let Some(tariff_id) = user.tariff_id
                && let Ok(tariff) = builder.tariffs.get(tariff_id)
            {
                tariffs.insert(tariff_id, tariff);
            }
        }
        let mut user_tariffs: HashMap<Uuid, &Tariff> = HashMap::new();
        for user in &users {
            if let Some(tariff_id) = user.tariff_id
                && let Some(tariff) = tariffs.get(&tariff_id)
            {
                user_tariffs.insert(user.id, tariff);
            }
        }

        let mut desired = Vec::new();
        for interface in interfaces {
            let group_devices = builder
                .devices
                .list_all()?
                .into_iter()
                .filter(|d| {
                    d.group_id == interface.group_id && d.interface_id == interface.id && !d.revoked
                })
                .collect::<Vec<_>>();
            let pools = builder.network.list_pools(interface.group_id)?;
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
                let (down, up) = match user_tariffs.get(&user.id) {
                    Some(tariff) => {
                        let used = builder
                            .stats
                            .used_bytes(StatsScope::User(user.id))
                            .unwrap_or(0);
                        if tariff.period_usage_exceeded(used) {
                            (1, 1)
                        } else {
                            (tariff.group_down_kbps, tariff.group_up_kbps)
                        }
                    }
                    None => (0, 0),
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
                let Some(peer) = builder
                    .devices
                    .peers_for(device.id)?
                    .into_iter()
                    .find(|p| p.interface_id == interface.id)
                else {
                    continue;
                };
                let (private_key, preshared_key) = builder.devices.peer_secrets(&peer)?;
                let _ = private_key;
                let blocked = builder
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
                    if let Ok(net) = parse_net(&pool.cidr)
                        && let std::net::IpAddr::V4(v4) = ip
                    {
                        addresses.push(address_with_prefix(*v4, net));
                        allowed.push(format!("{v4}/32"));
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
                private_key: builder.network.interface_private_key(&interface)?,
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

    #[test]
    fn snapshot_matches_previous_composition() {
        let fixture = seed();
        let legacy = legacy_build(&fixture.builder, fixture.node_id).unwrap();

        fixture.reset_calls();
        let current = fixture.builder.build(fixture.node_id).unwrap();

        assert_eq!(
            serde_json::to_value(&current.interfaces).unwrap(),
            serde_json::to_value(&legacy.interfaces).unwrap()
        );
        assert_eq!(current.node_id, fixture.node_id);
        assert_eq!(current.interfaces.len(), 3);
        let peers_of = |name: &str| {
            current
                .interfaces
                .iter()
                .find(|i| i.name == name)
                .unwrap()
                .peers
                .len()
        };
        assert_eq!(peers_of("awg0"), 3);
        assert_eq!(peers_of("awg1"), 0);
        assert_eq!(peers_of("awg2"), 1);
    }

    #[test]
    fn devices_appear_only_on_their_interface() {
        let fixture = seed();
        let state = fixture.builder.build(fixture.node_id).unwrap();
        let devices = fixture.builder.devices.list_all().unwrap();
        let phone = devices.iter().find(|d| d.name == "phone").unwrap();
        let tablet = devices.iter().find(|d| d.name == "tablet").unwrap();

        let awg0 = state
            .interfaces
            .iter()
            .find(|interface| interface.name == "awg0")
            .unwrap();
        let awg1 = state
            .interfaces
            .iter()
            .find(|interface| interface.name == "awg1")
            .unwrap();
        let awg2 = state
            .interfaces
            .iter()
            .find(|interface| interface.name == "awg2")
            .unwrap();

        assert_eq!(awg1.id, fixture.iface_a1_id);
        assert!(awg1.peers.is_empty());
        assert!(awg0.peers.iter().any(|peer| peer.device_id == phone.id));
        assert!(awg0.peers.iter().all(|peer| peer.device_id != tablet.id));
        assert_eq!(awg2.peers.len(), 1);
        assert_eq!(awg2.peers[0].device_id, tablet.id);
    }

    #[test]
    fn snapshot_bulk_loads_and_caches_usage() {
        let fixture = seed();
        fixture.reset_calls();
        let state = fixture.builder.build(fixture.node_id).unwrap();

        assert_eq!(state.interfaces.len(), 3);
        assert_eq!(fixture.devices.list_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.devices.by_user_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.devices.by_group_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.peers.list_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.peers.by_device_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.pools.list_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.pools.by_group_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.stats.used(), 3);
    }

    #[test]
    fn previous_n_plus_one_call_counts() {
        let fixture = seed();
        fixture.reset_calls();
        legacy_build(&fixture.builder, fixture.node_id).unwrap();

        assert_eq!(fixture.devices.list_calls.load(Ordering::SeqCst), 3);
        assert_eq!(fixture.peers.by_device_calls.load(Ordering::SeqCst), 5);
        assert_eq!(fixture.peers.list_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.pools.by_group_calls.load(Ordering::SeqCst), 3);
        assert_eq!(fixture.pools.list_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.stats.used(), 6);
    }

    #[test]
    fn empty_node_skips_device_and_pool_reads() {
        let fixture = seed();
        fixture.reset_calls();
        let state = fixture.builder.build(Uuid::new_v4()).unwrap();

        assert!(state.interfaces.is_empty());
        assert_eq!(fixture.devices.list_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.peers.list_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.pools.list_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.stats.used(), 0);
    }
}
