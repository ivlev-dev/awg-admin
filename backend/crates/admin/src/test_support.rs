use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine;
use chrono::Utc;
use uuid::Uuid;

use awg_clients::domain::{DevicePeerRepository, DeviceRepository};
use awg_clients::{
    Device, DevicePeer, DeviceService, RedbDevicePeerRepository, RedbDeviceRepository,
};
use awg_network::domain::{CidrPoolRepository, InterfaceRepository};
use awg_network::{
    CidrPool, Interface, NetworkService, NewInterface, NewPool, PoolMode, RedbCidrPoolRepository,
    RedbGroupRepository, RedbInterfaceRepository, RedbNodeRepository,
};
use awg_shared::CoreResult;
use awg_shared::crypto::Sealer;
use awg_shared::obf::{ClientObf, ObfuscationSettings};
use awg_storage::Store;
use awg_tariffs::{RedbTariffRepository, TariffService};

pub struct CountingPeers {
    inner: RedbDevicePeerRepository,
    pub list_calls: AtomicUsize,
    pub by_device_calls: AtomicUsize,
    pub by_devices_calls: AtomicUsize,
}

impl CountingPeers {
    fn new(inner: RedbDevicePeerRepository) -> Self {
        Self {
            inner,
            list_calls: AtomicUsize::new(0),
            by_device_calls: AtomicUsize::new(0),
            by_devices_calls: AtomicUsize::new(0),
        }
    }

    pub fn list_calls(&self) -> usize {
        self.list_calls.load(Ordering::SeqCst)
    }

    pub fn by_device_calls(&self) -> usize {
        self.by_device_calls.load(Ordering::SeqCst)
    }

    pub fn by_devices_calls(&self) -> usize {
        self.by_devices_calls.load(Ordering::SeqCst)
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

    fn by_devices(&self, device_ids: &[Uuid]) -> CoreResult<Vec<DevicePeer>> {
        self.by_devices_calls.fetch_add(1, Ordering::SeqCst);
        self.inner.by_devices(device_ids)
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

pub struct CountingInterfaces {
    inner: RedbInterfaceRepository,
    pub list_calls: AtomicUsize,
    pub by_group_calls: AtomicUsize,
}

impl CountingInterfaces {
    fn new(inner: RedbInterfaceRepository) -> Self {
        Self {
            inner,
            list_calls: AtomicUsize::new(0),
            by_group_calls: AtomicUsize::new(0),
        }
    }

    pub fn list_calls(&self) -> usize {
        self.list_calls.load(Ordering::SeqCst)
    }

    pub fn by_group_calls(&self) -> usize {
        self.by_group_calls.load(Ordering::SeqCst)
    }
}

impl InterfaceRepository for CountingInterfaces {
    fn find(&self, id: Uuid) -> CoreResult<Option<Interface>> {
        self.inner.find(id)
    }

    fn list(&self) -> CoreResult<Vec<Interface>> {
        self.list_calls.fetch_add(1, Ordering::SeqCst);
        self.inner.list()
    }

    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Interface>> {
        self.by_group_calls.fetch_add(1, Ordering::SeqCst);
        self.inner.by_group(group_id)
    }

    fn by_node(&self, node_id: Uuid) -> CoreResult<Vec<Interface>> {
        self.inner.by_node(node_id)
    }

    fn save(&self, interface: &Interface) -> CoreResult<()> {
        self.inner.save(interface)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.inner.delete(id)
    }
}

pub struct CountingPools {
    inner: RedbCidrPoolRepository,
    pub list_calls: AtomicUsize,
    pub by_group_calls: AtomicUsize,
}

impl CountingPools {
    fn new(inner: RedbCidrPoolRepository) -> Self {
        Self {
            inner,
            list_calls: AtomicUsize::new(0),
            by_group_calls: AtomicUsize::new(0),
        }
    }

    pub fn list_calls(&self) -> usize {
        self.list_calls.load(Ordering::SeqCst)
    }

    pub fn by_group_calls(&self) -> usize {
        self.by_group_calls.load(Ordering::SeqCst)
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

pub struct Env {
    pub devices: DeviceService,
    pub network: Arc<NetworkService>,
    pub device_repo: Arc<RedbDeviceRepository>,
    pub peer_repo: Arc<RedbDevicePeerRepository>,
    pub peers: Arc<CountingPeers>,
    pub interfaces: Arc<CountingInterfaces>,
    pub pools: Arc<CountingPools>,
}

impl Default for Env {
    fn default() -> Self {
        Self::new()
    }
}

impl Env {
    pub fn new() -> Self {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let key = base64::engine::general_purpose::STANDARD.encode([13u8; 32]);
        let sealer = Arc::new(Sealer::from_master_key(&key).unwrap());
        let interfaces = Arc::new(CountingInterfaces::new(RedbInterfaceRepository::new(
            store.clone(),
        )));
        let pools = Arc::new(CountingPools::new(RedbCidrPoolRepository::new(
            store.clone(),
        )));
        let peers = Arc::new(CountingPeers::new(RedbDevicePeerRepository::new(
            store.clone(),
        )));
        let network = Arc::new(NetworkService::new(
            Arc::new(RedbGroupRepository::new(store.clone())),
            Arc::new(RedbNodeRepository::new(store.clone())),
            interfaces.clone(),
            pools.clone(),
            sealer.clone(),
        ));
        let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
            store.clone(),
        ))));
        let device_repo = Arc::new(RedbDeviceRepository::new(store.clone()));
        let peer_repo = Arc::new(RedbDevicePeerRepository::new(store.clone()));
        let devices = DeviceService::new(
            device_repo.clone(),
            peers.clone(),
            network.clone(),
            tariffs,
            sealer,
        );
        Self {
            devices,
            network,
            device_repo,
            peer_repo,
            peers,
            interfaces,
            pools,
        }
    }

    pub fn reset_calls(&self) {
        self.peers.list_calls.store(0, Ordering::SeqCst);
        self.peers.by_device_calls.store(0, Ordering::SeqCst);
        self.peers.by_devices_calls.store(0, Ordering::SeqCst);
        self.interfaces.list_calls.store(0, Ordering::SeqCst);
        self.interfaces.by_group_calls.store(0, Ordering::SeqCst);
        self.pools.list_calls.store(0, Ordering::SeqCst);
        self.pools.by_group_calls.store(0, Ordering::SeqCst);
    }
}

pub struct Sample {
    pub group_a: Uuid,
    pub group_b: Uuid,
    pub iface_a0: Uuid,
    pub iface_a1: Uuid,
    pub iface_b0: Uuid,
    pub devices: Vec<Device>,
}

pub fn seeded() -> (Env, Sample) {
    let env = Env::new();
    let group_a = env
        .network
        .create_group("alpha", "", "10.0.0.1/14", false)
        .unwrap();
    let group_b = env
        .network
        .create_group("beta", "", "10.10.0.0/24", false)
        .unwrap();
    let pool_a = env
        .network
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
    let pool_a_extra = env
        .network
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
    let pool_b = env
        .network
        .add_pool(
            group_b.id,
            NewPool {
                name: "clients".into(),
                cidr: "10.10.0.0/25".into(),
                mode: PoolMode::Auto,
                gateway: None,
            },
        )
        .unwrap();
    let (node, _) = env.network.create_node("node-a").unwrap();
    let iface_a0 = env
        .network
        .add_interface(
            group_a.id,
            node.id,
            interface("awg0"),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let iface_a1 = env
        .network
        .add_interface(
            group_a.id,
            node.id,
            interface("awg1"),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let iface_b0 = env
        .network
        .add_interface(
            group_b.id,
            node.id,
            interface("awg2"),
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    let phone = Device {
        interface_id: iface_a0.id,
        ..device(user_a, group_a.id, "phone")
    };
    let laptop = Device {
        interface_id: iface_a0.id,
        ..device(user_a, group_a.id, "laptop")
    };
    let tablet = Device {
        interface_id: iface_b0.id,
        ..device(user_b, group_b.id, "tablet")
    };
    let lonely = Device {
        interface_id: iface_a0.id,
        ..device(user_a, group_a.id, "lonely")
    };
    let phone_ips = BTreeMap::from([
        (pool_a.id, IpAddr::V4(Ipv4Addr::new(10, 1, 0, 2))),
        (pool_a_extra.id, IpAddr::V4(Ipv4Addr::new(10, 2, 0, 5))),
    ]);
    let laptop_ips = BTreeMap::from([(pool_a.id, IpAddr::V4(Ipv4Addr::new(10, 1, 0, 3)))]);
    let tablet_ips = BTreeMap::from([(pool_b.id, IpAddr::V4(Ipv4Addr::new(10, 10, 0, 7)))]);
    let peers = vec![
        peer(&phone, iface_a0.id, "key-phone-awg0", phone_ips.clone()),
        peer(&laptop, iface_a0.id, "key-laptop-awg0", laptop_ips),
        peer(&tablet, iface_b0.id, "key-tablet-awg2", tablet_ips),
    ];
    for item in [&phone, &laptop, &tablet, &lonely] {
        env.device_repo.save(item).unwrap();
    }
    for item in &peers {
        env.peer_repo.save(item).unwrap();
    }
    let devices = env.devices.list_all().unwrap();
    env.reset_calls();
    (
        env,
        Sample {
            group_a: group_a.id,
            group_b: group_b.id,
            iface_a0: iface_a0.id,
            iface_a1: iface_a1.id,
            iface_b0: iface_b0.id,
            devices,
        },
    )
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

fn device(user_id: Uuid, group_id: Uuid, name: &str) -> Device {
    let now = Utc::now();
    Device {
        id: Uuid::new_v4(),
        user_id,
        group_id,
        interface_id: Uuid::nil(),
        name: name.into(),
        down_kbps: 0,
        up_kbps: 0,
        forwarding: awg_clients::Forwarding::default(),
        revoked: false,
        external: false,
        created_at: now,
        updated_at: now,
    }
}

fn peer(
    device: &Device,
    interface_id: Uuid,
    public_key: &str,
    ips: BTreeMap<Uuid, IpAddr>,
) -> DevicePeer {
    DevicePeer {
        device_id: device.id,
        interface_id,
        public_key: public_key.into(),
        private_key_sealed: String::new(),
        preshared_key_sealed: String::new(),
        ips,
        client_obf: ClientObf {
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
        created_at: Utc::now(),
    }
}
