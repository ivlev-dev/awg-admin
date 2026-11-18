use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};

use crate::config::Environment;
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

    fn delete_peer(&self, peer_id: Uuid) -> CoreResult<()> {
        self.inner.delete_peer(peer_id)
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
        id: Uuid::new_v4(),
        device_id: device.id,
        interface_id,
        label: public_key.into(),
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

pub struct AppEnv {
    pub state: Arc<crate::state::AppState>,
    pub store: Arc<Store>,
    pub group_id: Uuid,
    pub node_id: Uuid,
    pub interface_ids: Vec<Uuid>,
    pub tariff_id: Uuid,
    pub owner_id: Uuid,
    pub owner_token: String,
    pub other_id: Uuid,
    pub other_token: String,
}

pub const OWNER_EMAIL: &str = "owner@example.com";
pub const OTHER_EMAIL: &str = "other@example.com";
pub const PASSWORD: &str = "password123";
pub const MOCK_PAYMENT_SECRET: &str = "mock-payment-secret-for-tests-0123456789";

fn app_config(
    billing_enabled: bool,
    environment: Environment,
    dev_mail_token: Option<String>,
    mock_billing: bool,
) -> crate::config::Config {
    use crate::config::{
        Config, ConfigInput, DEFAULT_ADMIN_EMAIL, DEFAULT_APP_VERIFY_URL, DEFAULT_JWT_AUDIENCE,
        DEFAULT_JWT_ISSUER,
    };

    let master_key = base64::engine::general_purpose::STANDARD.encode([13u8; 32]);
    let production = environment.is_production();
    Config::from_input(ConfigInput {
        environment,
        bind: "127.0.0.1:0".into(),
        grpc_bind: "127.0.0.1:0".into(),
        db_path: ":memory:".into(),
        master_key: Some(master_key),
        jwt_secret: Some("test-secret-with-at-least-32-bytes!!".into()),
        jwt_issuer: DEFAULT_JWT_ISSUER.into(),
        jwt_audience: DEFAULT_JWT_AUDIENCE.into(),
        access_ttl_secs: 900,
        refresh_ttl_secs: 86_400,
        admin_login: "admin".into(),
        admin_email: DEFAULT_ADMIN_EMAIL.into(),
        admin_password: if production {
            "production-password-123".into()
        } else {
            "admin12345".into()
        },
        dns: "1.1.1.1".into(),
        cors_origins: String::new(),
        share_ttl_secs: 3600,
        public_url: "https://panel.test".into(),
        app_verify_url: DEFAULT_APP_VERIFY_URL.into(),
        trusted_proxies: String::new(),
        dev_mail_token,
        rate_limit_store: "memory".into(),
        login_rate_limit: 100,
        login_rate_window_secs: 60,
        refresh_rate_limit: 100,
        refresh_rate_window_secs: 60,
        register_rate_limit: 100,
        register_rate_window_secs: 60,
        resend_rate_limit: 100,
        resend_rate_window_secs: 60,
        forgot_rate_limit: 100,
        forgot_rate_window_secs: 60,
        http_timeout_secs: 30,
        shutdown_grace_secs: 10,
        mail_mode: "log".into(),
        smtp_url: None,
        smtp_from: None,
        metrics_token: None,
        billing_enabled: if billing_enabled { "true" } else { "false" }.into(),
        billing_currency: "RUB".into(),
        billing_trial_days: "0".into(),
        payment_provider: if mock_billing { "mock" } else { "noop" }.into(),
        payment_secret: if mock_billing {
            MOCK_PAYMENT_SECRET.into()
        } else {
            String::new()
        },
        backup_dir: String::new(),
        backup_interval_secs: 0,
        backup_keep: 7,
    })
    .unwrap()
}

pub fn app_env() -> AppEnv {
    app_env_with(false, Environment::Development, None, false)
}

pub fn app_env_with_billing(billing_enabled: bool) -> AppEnv {
    app_env_with(billing_enabled, Environment::Development, None, false)
}

pub fn app_env_with_mock_billing() -> AppEnv {
    app_env_with(true, Environment::Development, None, true)
}

pub fn app_env_production() -> AppEnv {
    app_env_with(false, Environment::Production, None, false)
}

pub fn app_env_with_dev_mail_token(token: &str) -> AppEnv {
    app_env_with(
        false,
        Environment::Development,
        Some(token.to_string()),
        false,
    )
}

fn app_env_with(
    billing_enabled: bool,
    environment: Environment,
    dev_mail_token: Option<String>,
    mock_billing: bool,
) -> AppEnv {
    use std::time::Duration;

    use awg_audit::AuditService;
    use awg_audit::RedbAuditRepository;
    use awg_billing::{
        BillingService, MockGateway, NoopGateway, PaymentGateway, RedbInvoiceRepository,
        RedbPaymentEventRepository, RedbPaymentMethodRepository, RedbPlanRepository,
        RedbSubscriptionRepository,
    };
    use awg_clients::{ProfileService, RedbShareLinkRepository, ShareService};
    use awg_identity::{
        Argon2Hasher, CaptureMailer, IdentityService, JwtIssuer, NewUser,
        RedbEmailVerificationRepository, RedbUserRepository, Role,
    };
    use awg_network::{InterfaceChanges, NewInterface};
    use awg_orchestration::{OrchestrationService, WorkerRegistry};
    use awg_statistics::{RedbStatsRepository, StatsHub, StatsService};
    use awg_tariffs::NewTariff;

    use crate::controllers::billing::TariffCatalogAdapter;
    use crate::directory::{DevicesAdapter, NodesAdapter};
    use crate::idempotency::IdempotencyStore;
    use crate::rate_limit::{MemoryRateLimiter, RateLimitScope, RateLimiter};
    use crate::settings::SettingsStore;
    use crate::snapshot::SnapshotBuilder;
    use crate::state::AppState;

    let config = Arc::new(app_config(
        billing_enabled,
        environment,
        dev_mail_token,
        mock_billing,
    ));
    let store = Arc::new(Store::open_in_memory().unwrap());
    let key = base64::engine::general_purpose::STANDARD.encode([13u8; 32]);
    let sealer = Arc::new(Sealer::from_master_key(&key).unwrap());

    let network = Arc::new(NetworkService::new(
        Arc::new(RedbGroupRepository::new(store.clone())),
        Arc::new(RedbNodeRepository::new(store.clone())),
        Arc::new(RedbInterfaceRepository::new(store.clone())),
        Arc::new(RedbCidrPoolRepository::new(store.clone())),
        sealer.clone(),
    ));
    let group = network
        .create_group("mobile", "", "10.20.0.1/24", false)
        .unwrap();
    network
        .add_pool(
            group.id,
            NewPool {
                name: "clients".into(),
                cidr: "10.20.0.0/24".into(),
                mode: PoolMode::Auto,
                gateway: Some("10.20.0.1".into()),
            },
        )
        .unwrap();
    let (node, _) = network.create_node("node-mobile").unwrap();
    let mut interface_ids = Vec::new();
    for (name, enabled) in [
        ("awg-b", true),
        ("awg-a", true),
        ("awg-0", false),
        ("awg-c", true),
    ] {
        let interface = network
            .add_interface(
                group.id,
                node.id,
                NewInterface {
                    name: name.into(),
                    label: name.into(),
                    endpoint_host: "vpn.example.com".into(),
                    endpoint_port: 51820,
                    listen_port: 51820,
                    mtu: 1420,
                },
                &ObfuscationSettings::default(),
            )
            .unwrap();
        if !enabled {
            network
                .update_interface(
                    interface.id,
                    InterfaceChanges {
                        enabled: Some(false),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        interface_ids.push(interface.id);
    }

    let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
        store.clone(),
    ))));
    let tariff = tariffs
        .create(NewTariff {
            name: "mobile".into(),
            description: "Mobile plan".into(),
            max_devices: 2,
            device_down_kbps: 100_000,
            device_up_kbps: 50_000,
            group_down_kbps: 0,
            group_up_kbps: 0,
            traffic_quota_bytes: Some(1_000_000_000),
            interface_id: None,
        })
        .unwrap();

    let identity = Arc::new(IdentityService::new(
        Arc::new(RedbUserRepository::new(store.clone())),
        Arc::new(Argon2Hasher::default()),
        Arc::new(JwtIssuer::new(
            &config.jwt_secret,
            config.access_ttl_secs,
            config.refresh_ttl_secs,
            &config.jwt_issuer,
            &config.jwt_audience,
            store.clone(),
        )),
        Arc::new(RedbEmailVerificationRepository::new(store.clone())),
        Arc::new(CaptureMailer::new()),
        sealer.clone(),
        config.public_url.clone(),
    ));

    let owner = identity
        .create(NewUser {
            email: OWNER_EMAIL.into(),
            password: PASSWORD.into(),
            role: Role::User,
            tariff_id: Some(tariff.id),
            group_id: Some(group.id),
            node_id: Some(node.id),
        })
        .unwrap();
    let other = identity
        .create(NewUser {
            email: OTHER_EMAIL.into(),
            password: PASSWORD.into(),
            role: Role::User,
            tariff_id: None,
            group_id: Some(group.id),
            node_id: Some(node.id),
        })
        .unwrap();
    let owner_token = identity
        .login(OWNER_EMAIL, PASSWORD, &metadata_none())
        .unwrap()
        .access_token;
    let other_token = identity
        .login(OTHER_EMAIL, PASSWORD, &metadata_none())
        .unwrap()
        .access_token;

    let device_repo = Arc::new(RedbDeviceRepository::new(store.clone()));
    let peer_repo = Arc::new(RedbDevicePeerRepository::new(store.clone()));
    let devices = Arc::new(DeviceService::new(
        device_repo.clone(),
        peer_repo.clone(),
        network.clone(),
        tariffs.clone(),
        sealer.clone(),
    ));
    let profiles = Arc::new(ProfileService::new(
        device_repo,
        peer_repo,
        network.clone(),
        sealer.clone(),
        config.dns.clone(),
    ));
    let share = Arc::new(ShareService::new(
        Arc::new(RedbShareLinkRepository::new(store.clone())),
        profiles.clone(),
    ));
    let stats_hub = Arc::new(StatsHub::new(64));
    let stats = Arc::new(StatsService::new(
        Arc::new(RedbStatsRepository::new(store.clone())),
        stats_hub.clone(),
    ));
    let registry = Arc::new(WorkerRegistry::new());
    let subscriptions = Arc::new(RedbSubscriptionRepository::new(store.clone()));
    let gateway: Arc<dyn PaymentGateway> = if config.billing.provider.is_mock() {
        Arc::new(
            MockGateway::from_config(
                &config.payment_secret,
                &config.public_url,
                awg_billing::DEFAULT_MOCK_TOLERANCE_SECS,
            )
            .unwrap(),
        )
    } else {
        Arc::new(NoopGateway)
    };
    let billing = Arc::new(BillingService::new(
        Arc::new(RedbPlanRepository::new(store.clone())),
        subscriptions,
        Arc::new(RedbInvoiceRepository::new(store.clone())),
        Arc::new(RedbPaymentMethodRepository::new(store.clone())),
        Arc::new(RedbPaymentEventRepository::new(store.clone())),
        Arc::new(TariffCatalogAdapter::new(tariffs.clone())),
        gateway,
        config.billing.settings(),
    ));
    let snapshot = Arc::new(SnapshotBuilder {
        network: network.clone(),
        devices: devices.clone(),
        identity: identity.clone(),
        tariffs: tariffs.clone(),
        stats: stats.clone(),
        billing: config.billing.enabled.then(|| billing.clone()),
    });
    let orchestration = Arc::new(OrchestrationService::new(
        registry.clone(),
        snapshot,
        stats.clone(),
        Arc::new(DevicesAdapter::new(devices.clone())),
        Arc::new(NodesAdapter::new(network.clone())),
    ));
    let settings = Arc::new(SettingsStore::new(store.clone()));
    let idempotency = Arc::new(IdempotencyStore::new(store.clone(), sealer.clone()));
    let audit = Arc::new(AuditService::new(Arc::new(RedbAuditRepository::new(
        store.clone(),
    ))));
    let backend: Arc<dyn RateLimiter> = Arc::new(MemoryRateLimiter::new());
    let scope = |prefix: &'static str| {
        RateLimitScope::new(backend.clone(), prefix, 100, Duration::from_secs(60))
    };

    let state = Arc::new(AppState {
        config,
        identity,
        tariffs,
        network,
        devices,
        profiles,
        share,
        stats,
        stats_hub,
        registry,
        orchestration,
        settings,
        audit,
        billing,
        idempotency,
        login_limiter: scope("login"),
        refresh_limiter: scope("refresh"),
        register_limiter: scope("register"),
        resend_limiter: scope("resend"),
        forgot_limiter: scope("forgot"),
    });

    AppEnv {
        state,
        store,
        group_id: group.id,
        node_id: node.id,
        interface_ids,
        tariff_id: tariff.id,
        owner_id: owner.id,
        owner_token,
        other_id: other.id,
        other_token,
    }
}

fn metadata_none() -> awg_identity::SessionMetadata {
    awg_identity::SessionMetadata {
        user_agent: None,
        ip: None,
    }
}
