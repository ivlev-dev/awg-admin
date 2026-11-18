use std::collections::BTreeMap;
use std::net::IpAddr;
use std::sync::Arc;

use base64::Engine;
use chrono::Utc;
use uuid::Uuid;

use awg_clients::{
    Device, DevicePeer, DeviceService, Forwarding, NewDevice, ProfileService,
    RedbDevicePeerRepository, RedbDeviceRepository,
};
use awg_identity::{Role, User};
use awg_network::{
    NetworkService, NewInterface, NewPool, PoolMode, RedbCidrPoolRepository, RedbGroupRepository,
    RedbInterfaceRepository, RedbNodeRepository,
};
use awg_shared::CoreError;
use awg_shared::crypto::{Sealer, generate_keypair};
use awg_shared::obf::ObfuscationSettings;
use awg_storage::Store;
use awg_tariffs::{NewTariff, RedbTariffRepository, TariffService};

trait SyncDeviceCalls {
    fn create_sync(
        &self,
        user: &User,
        tariff: &awg_tariffs::Tariff,
        input: NewDevice,
        settings: &ObfuscationSettings,
    ) -> awg_shared::CoreResult<Device>;

    fn add_peer_sync(
        &self,
        user: &User,
        tariff: &awg_tariffs::Tariff,
        device_id: Uuid,
        interface_id: Uuid,
        label: Option<String>,
        settings: &ObfuscationSettings,
    ) -> awg_shared::CoreResult<DevicePeer>;
}

impl SyncDeviceCalls for DeviceService {
    fn create_sync(
        &self,
        user: &User,
        tariff: &awg_tariffs::Tariff,
        input: NewDevice,
        settings: &ObfuscationSettings,
    ) -> awg_shared::CoreResult<Device> {
        block_on(self.create(user, tariff, input, settings))
    }

    fn add_peer_sync(
        &self,
        user: &User,
        tariff: &awg_tariffs::Tariff,
        device_id: Uuid,
        interface_id: Uuid,
        label: Option<String>,
        settings: &ObfuscationSettings,
    ) -> awg_shared::CoreResult<DevicePeer> {
        block_on(self.add_peer(user, tariff, device_id, interface_id, label, settings))
    }
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime")
        .block_on(future)
}

struct Fixture {
    devices: DeviceService,
    profiles: ProfileService,
    tariffs: Arc<TariffService>,
    network: Arc<NetworkService>,
    group_id: Uuid,
    node_id: Uuid,
    interface_id: Uuid,
    interface_ids: Vec<Uuid>,
}

fn fixture() -> Fixture {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let key = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
    let sealer = Arc::new(Sealer::from_master_key(&key).unwrap());

    let network = Arc::new(NetworkService::new(
        Arc::new(RedbGroupRepository::new(store.clone())),
        Arc::new(RedbNodeRepository::new(store.clone())),
        Arc::new(RedbInterfaceRepository::new(store.clone())),
        Arc::new(RedbCidrPoolRepository::new(store.clone())),
        sealer.clone(),
    ));
    let group = network
        .create_group("Main", "", "10.0.0.1/14", true)
        .unwrap();
    network
        .add_pool(
            group.id,
            NewPool {
                name: "clients".into(),
                cidr: "10.1.0.0/24".into(),
                mode: PoolMode::Auto,
                gateway: Some("10.1.0.1".into()),
            },
        )
        .unwrap();
    let (node, _) = network.create_node("node-a").unwrap();
    let mut interface_ids = Vec::new();
    for name in ["awg0", "awg1"] {
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
        interface_ids.push(interface.id);
    }

    let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
        store.clone(),
    ))));
    tariffs
        .create(NewTariff {
            name: "Basic".into(),
            description: String::new(),
            max_devices: 2,
            device_down_kbps: 50_000,
            device_up_kbps: 20_000,
            group_down_kbps: 80_000,
            group_up_kbps: 40_000,
            traffic_quota_bytes: None,
            interface_id: None,
        })
        .unwrap();

    let device_repo = Arc::new(RedbDeviceRepository::new(store.clone()));
    let peer_repo = Arc::new(RedbDevicePeerRepository::new(store.clone()));
    let devices = DeviceService::new(
        device_repo.clone(),
        peer_repo.clone(),
        network.clone(),
        tariffs.clone(),
        sealer.clone(),
    );
    let profiles = ProfileService::new(
        device_repo,
        peer_repo,
        network.clone(),
        sealer,
        vec!["1.1.1.1".into()],
    );

    Fixture {
        devices,
        profiles,
        tariffs,
        network,
        group_id: group.id,
        node_id: node.id,
        interface_id: interface_ids[0],
        interface_ids,
    }
}

fn user(group_id: Uuid, tariff_id: Uuid) -> User {
    let now = Utc::now();
    User {
        id: Uuid::new_v4(),
        login: "user".into(),
        password_hash: String::new(),
        role: Role::User,
        tariff_id: Some(tariff_id),
        group_id: Some(group_id),
        node_id: None,
        disabled: false,
        email: None,
        status: awg_identity::UserStatus::Active,
        totp_secret_sealed: None,
        totp_enabled: false,
        recovery_codes: Vec::new(),
        totp_pending_secret_sealed: None,
        totp_pending_recovery_codes: Vec::new(),
        last_totp_step: None,
        created_at: now,
        updated_at: now,
    }
}

fn node_user(node_id: Uuid, tariff_id: Uuid) -> User {
    let mut user = user(Uuid::nil(), tariff_id);
    user.group_id = None;
    user.node_id = Some(node_id);
    user
}

fn node_with_interface(fixture: &Fixture, name: &str) -> (Uuid, Uuid) {
    let (node, _) = fixture.network.create_node(name).unwrap();
    let interface = fixture
        .network
        .add_interface(
            fixture.group_id,
            node.id,
            NewInterface {
                name: "awg0".into(),
                label: name.into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    (node.id, interface.id)
}

#[test]
fn creates_single_peer_and_enforces_tariff() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);

    let first = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 500_000,
                up_kbps: 500_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding {
                    to_own_devices: true,
                    allowed_devices: vec![],
                },
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let peers = fixture.devices.peers_for(first.id).unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].interface_id, fixture.interface_id);
    assert_eq!(first.interface_id, fixture.interface_id);
    assert_eq!(first.down_kbps, 50_000);
    assert_eq!(first.up_kbps, 20_000);
    assert!(!peers[0].ips.is_empty());

    let second = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "laptop".into(),
                down_kbps: 10_000,
                up_kbps: 10_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    assert_eq!(fixture.devices.list_for_user(user.id).unwrap().len(), 2);

    let refused = fixture.devices.create_sync(
        &user,
        &tariff,
        NewDevice {
            user_id: user.id,
            group_id: Some(fixture.group_id),
            interface_id: Some(fixture.interface_id),
            name: "tablet".into(),
            down_kbps: 1,
            up_kbps: 1,
            interface_ids: Vec::new(),
            forwarding: Forwarding::default(),
        },
        &ObfuscationSettings::default(),
    );
    assert!(refused.is_err());

    let (_, profiles) = fixture.profiles.build_all(first.id).unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].interface_id, fixture.interface_id);
    assert!(profiles[0].conf.contains("PrivateKey"));
    assert!(profiles[0].vpn_link.starts_with("vpn://"));
    assert!(profiles[0].conf.contains("RandomTrailers = on"));
    assert!(profiles[0].conf.contains("DisableCookies = off"));
    let keepalive = profiles[0]
        .conf
        .lines()
        .find_map(|line| line.strip_prefix("PersistentKeepalive = "))
        .expect("keepalive line");
    let (low, high) = keepalive.split_once('-').expect("keepalive range");
    let low: u16 = low.parse().unwrap();
    let high: u16 = high.parse().unwrap();
    assert!(low >= 15 && high <= 25 && low < high);

    let group_devices = fixture.devices.list_all().unwrap();
    assert_eq!(group_devices.len(), 2);
    fixture.devices.delete(second.id).unwrap();
    assert_eq!(fixture.devices.peers_for(second.id).unwrap().len(), 0);
}

#[test]
fn keepalive_range_follows_obfuscation_settings() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let settings = ObfuscationSettings {
        keepalive_min: 40,
        keepalive_max: 50,
        ..Default::default()
    };

    let mut ranges = std::collections::HashSet::new();
    for name in ["ka-a", "ka-b"] {
        let device = fixture
            .devices
            .create_sync(
                &user,
                &tariff,
                NewDevice {
                    user_id: user.id,
                    group_id: Some(fixture.group_id),
                    interface_id: Some(fixture.interface_id),
                    name: name.into(),
                    down_kbps: 1_000,
                    up_kbps: 1_000,
                    interface_ids: Vec::new(),
                    forwarding: Forwarding::default(),
                },
                &settings,
            )
            .unwrap();
        let (_, profiles) = fixture.profiles.build_all(device.id).unwrap();
        let line = profiles[0]
            .conf
            .lines()
            .find_map(|line| {
                line.strip_prefix("PersistentKeepalive = ")
                    .map(str::to_string)
            })
            .expect("keepalive line");
        let (low, high) = line.split_once('-').expect("range");
        let low: u16 = low.parse().unwrap();
        let high: u16 = high.parse().unwrap();
        assert!(low >= 40);
        assert!(high <= 50);
        assert!(low < high);
        ranges.insert((low, high));
    }
    assert!(!ranges.is_empty());
}

#[test]
fn create_inherits_the_tariff_interface() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let tariff = fixture
        .tariffs
        .update(
            tariff.id,
            awg_tariffs::TariffChanges {
                interface_id: Some(Some(fixture.interface_id)),
                ..Default::default()
            },
        )
        .unwrap();

    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    assert_eq!(device.interface_id, fixture.interface_id);
    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].interface_id, fixture.interface_id);
}

#[test]
fn tariff_interface_takes_priority_over_request() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let interfaces = fixture.network.list_interfaces().unwrap();
    let other = interfaces
        .iter()
        .find(|interface| interface.id != fixture.interface_id)
        .unwrap()
        .id;
    let tariff = fixture
        .tariffs
        .update(
            tariff.id,
            awg_tariffs::TariffChanges {
                interface_id: Some(Some(other)),
                ..Default::default()
            },
        )
        .unwrap();

    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    assert_eq!(device.interface_id, other);
    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].interface_id, other);
}

#[test]
fn request_interface_is_used_when_tariff_has_none() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let other = fixture
        .network
        .list_interfaces()
        .unwrap()
        .into_iter()
        .find(|interface| interface.id != fixture.interface_id)
        .unwrap()
        .id;

    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(other),
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    assert_eq!(device.interface_id, other);
    assert_eq!(fixture.devices.peers_for(device.id).unwrap().len(), 1);
}

#[test]
fn create_uses_the_only_enabled_interface_of_the_user_node() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let (node_id, interface_id) = node_with_interface(&fixture, "node-b");
    let user = node_user(node_id, tariff.id);

    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    assert_eq!(device.interface_id, interface_id);
    assert_eq!(device.group_id, fixture.group_id);
    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].interface_id, interface_id);
}

#[test]
fn create_rejects_a_node_with_several_enabled_interfaces() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = node_user(fixture.node_id, tariff.id);

    let error = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));
    assert!(
        error.to_string().contains("multiple enabled interfaces"),
        "{error}"
    );
}

#[test]
fn create_rejects_a_node_without_enabled_interfaces() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let (node_id, interface_id) = node_with_interface(&fixture, "node-b");
    fixture
        .network
        .update_interface(
            interface_id,
            awg_network::InterfaceChanges {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    let user = node_user(node_id, tariff.id);

    let error = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));
    assert!(
        error.to_string().contains("no enabled interfaces"),
        "{error}"
    );
}

#[test]
fn create_forbids_an_interface_of_another_node() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let (node_id, _) = node_with_interface(&fixture, "node-b");
    let user = node_user(node_id, tariff.id);

    let error = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Forbidden(_)));
}

#[test]
fn tariff_interface_takes_priority_over_the_user_node() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let tariff = fixture
        .tariffs
        .update(
            tariff.id,
            awg_tariffs::TariffChanges {
                interface_id: Some(Some(fixture.interface_id)),
                ..Default::default()
            },
        )
        .unwrap();
    let user = node_user(fixture.node_id, tariff.id);

    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    assert_eq!(device.interface_id, fixture.interface_id);
    assert_eq!(
        fixture.devices.peers_for(device.id).unwrap()[0].interface_id,
        fixture.interface_id
    );
}

#[test]
fn create_requires_an_interface_when_the_group_has_several() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);

    let error = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));
    assert!(fixture.devices.list_all().unwrap().is_empty());
}

#[test]
fn create_requires_an_enabled_interface() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    for interface in fixture.network.list_interfaces().unwrap() {
        fixture
            .network
            .update_interface(
                interface.id,
                awg_network::InterfaceChanges {
                    enabled: Some(false),
                    ..Default::default()
                },
            )
            .unwrap();
    }

    let error = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));
}

#[test]
fn forwarding_is_scoped_to_the_user() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let first = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "one".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding {
                    to_own_devices: true,
                    allowed_devices: vec![],
                },
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let second = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "two".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let updated = fixture
        .devices
        .update(
            second.id,
            &tariff,
            None,
            None,
            None,
            Some(Forwarding {
                to_own_devices: false,
                allowed_devices: vec![first.id],
            }),
        )
        .unwrap();
    assert_eq!(updated.forwarding.allowed_devices, vec![first.id]);
}

#[test]
fn create_normalizes_forwarding() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let first = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "one".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let second_id = Uuid::new_v4();
    // duplicate + self-ish list cleared when all
    let second = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "two".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding {
                    to_own_devices: true,
                    allowed_devices: vec![first.id, first.id],
                },
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    assert!(second.forwarding.to_own_devices);
    assert!(second.forwarding.allowed_devices.is_empty());

    // update dedups/sorts
    let updated = fixture
        .devices
        .update(
            second.id,
            &tariff,
            None,
            None,
            None,
            Some(Forwarding {
                to_own_devices: false,
                allowed_devices: vec![first.id, first.id],
            }),
        )
        .unwrap();
    assert_eq!(updated.forwarding.allowed_devices, vec![first.id]);
    // persisted
    let fetched = fixture.devices.get(second.id).unwrap();
    assert_eq!(fetched.forwarding.allowed_devices, vec![first.id]);

    let _ = second_id;
}

#[test]
fn create_rejects_invalid_forwarding() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let owner = user(fixture.group_id, tariff.id);
    let first = fixture
        .devices
        .create_sync(
            &owner,
            &tariff,
            NewDevice {
                user_id: owner.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "one".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let other_owner = user(fixture.group_id, tariff.id);
    // foreign: allowed device from other user
    let other_device = fixture
        .devices
        .create_sync(
            &other_owner,
            &tariff,
            NewDevice {
                user_id: other_owner.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "other".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let res = fixture.devices.create_sync(
        &owner,
        &tariff,
        NewDevice {
            user_id: owner.id,
            group_id: Some(fixture.group_id),
            interface_id: Some(fixture.interface_id),
            name: "bad".into(),
            down_kbps: 1_000,
            up_kbps: 1_000,
            interface_ids: Vec::new(),
            forwarding: Forwarding {
                to_own_devices: false,
                allowed_devices: vec![other_device.id],
            },
        },
        &ObfuscationSettings::default(),
    );
    assert!(res.is_err());
    // self rejection via update to own id
    let res = fixture.devices.update(
        first.id,
        &tariff,
        None,
        None,
        None,
        Some(Forwarding {
            to_own_devices: false,
            allowed_devices: vec![first.id],
        }),
    );
    assert!(res.is_err());
}

#[test]
fn external_peer_has_no_private_key_and_no_profile() {
    let fixture = fixture();
    let interface = fixture.network.list_interfaces().unwrap()[0].clone();
    let pool = fixture
        .network
        .list_pools(fixture.group_id)
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let external = generate_keypair();
    let ips = BTreeMap::from([(pool.id, IpAddr::V4("10.1.0.5".parse().unwrap()))]);
    let device = fixture
        .devices
        .import_external_peer(
            Uuid::new_v4(),
            fixture.group_id,
            "external-abcdefgh",
            interface.id,
            &external.public_key,
            "psk-external",
            ips,
        )
        .unwrap();

    assert!(device.external);
    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 1);
    assert!(peers[0].private_key_sealed.is_empty());
    assert_eq!(peers[0].public_key, external.public_key);
    assert_eq!(
        fixture.devices.peer_preshared_key(&peers[0]).unwrap(),
        "psk-external"
    );
    assert_eq!(fixture.devices.peer_secrets(&peers[0]).unwrap().0, "");

    let error = fixture
        .profiles
        .build_one(device.id, interface.id)
        .expect_err("external peer has no client profile");
    assert!(matches!(error, CoreError::Conflict(message) if message.contains("external peer")));
    assert!(fixture.profiles.build_all(device.id).is_err());
}

#[test]
fn external_peer_requires_known_interface_and_addresses() {
    let fixture = fixture();
    let interface = fixture.network.list_interfaces().unwrap()[0].clone();
    let external = generate_keypair();
    let error = fixture
        .devices
        .import_external_peer(
            Uuid::new_v4(),
            fixture.group_id,
            "external-abcdefgh",
            interface.id,
            &external.public_key,
            "",
            BTreeMap::new(),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));

    let error = fixture
        .devices
        .import_external_peer(
            Uuid::new_v4(),
            fixture.group_id,
            "external-abcdefgh",
            Uuid::new_v4(),
            &external.public_key,
            "",
            BTreeMap::from([(Uuid::new_v4(), IpAddr::V4("10.1.0.5".parse().unwrap()))]),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::NotFound(_)));
}

#[test]
fn peers_for_devices_returns_only_requested_devices() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let first = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 10_000,
                up_kbps: 10_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let second = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "laptop".into(),
                down_kbps: 10_000,
                up_kbps: 10_000,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let only_first = fixture.devices.peers_for_devices(&[first.id]).unwrap();
    assert_eq!(only_first.len(), 1);
    assert!(only_first.iter().all(|peer| peer.device_id == first.id));

    let both = fixture
        .devices
        .peers_for_devices(&[first.id, second.id])
        .unwrap();
    assert_eq!(both.len(), 2);
    assert!(both.iter().any(|peer| peer.device_id == second.id));

    assert!(fixture.devices.peers_for_devices(&[]).unwrap().is_empty());
}

fn multi_device(fixture: &Fixture, user: &User) -> NewDevice {
    NewDevice {
        user_id: user.id,
        group_id: Some(fixture.group_id),
        interface_id: None,
        interface_ids: fixture.interface_ids.clone(),
        name: "multi".into(),
        down_kbps: 1_000,
        up_kbps: 1_000,
        forwarding: Forwarding::default(),
    }
}

#[test]
fn creates_one_peer_per_requested_interface() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);

    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .unwrap();

    assert_eq!(device.interface_id, fixture.interface_ids[0]);
    let mut peers = fixture.devices.peers_for(device.id).unwrap();
    peers.sort_by_key(|peer| peer.interface_id);
    let mut expected = fixture.interface_ids.clone();
    expected.sort();
    assert_eq!(
        peers
            .iter()
            .map(|peer| peer.interface_id)
            .collect::<Vec<_>>(),
        expected
    );
    assert!(peers.iter().all(|peer| !peer.ips.is_empty()));
    let first_ips: Vec<_> = peers[0].ips.values().copied().collect();
    let second_ips: Vec<_> = peers[1].ips.values().copied().collect();
    assert_ne!(first_ips, second_ips);

    let (_, profiles) = fixture.profiles.build_all(device.id).unwrap();
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].interface_name, "awg0");
    assert_eq!(profiles[1].interface_name, "awg1");
    assert_eq!(profiles[0].interface_id, fixture.interface_ids[0]);
    assert_eq!(profiles[1].interface_id, fixture.interface_ids[1]);
    assert!(
        profiles
            .iter()
            .all(|profile| profile.conf.contains("[Interface]"))
    );
    assert!(profiles[0].conf != profiles[1].conf);
}

#[test]
fn duplicate_interface_ids_do_not_duplicate_peers() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let mut input = multi_device(&fixture, &user);
    input.interface_ids = vec![
        fixture.interface_ids[0],
        fixture.interface_ids[1],
        fixture.interface_ids[0],
    ];

    let device = fixture
        .devices
        .create_sync(&user, &tariff, input, &ObfuscationSettings::default())
        .unwrap();

    assert_eq!(fixture.devices.peers_for(device.id).unwrap().len(), 2);
    let (_, profiles) = fixture.profiles.build_all(device.id).unwrap();
    assert_eq!(profiles.len(), 2);
}

#[test]
fn requested_interface_of_another_node_is_forbidden() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let (node_id, interface_id) = node_with_interface(&fixture, "node-b");
    let mut user = node_user(node_id, tariff.id);
    user.group_id = Some(fixture.group_id);

    let mut input = multi_device(&fixture, &user);
    input.group_id = None;
    input.interface_ids = vec![fixture.interface_ids[0], interface_id];

    let error = fixture
        .devices
        .create_sync(&user, &tariff, input, &ObfuscationSettings::default())
        .expect_err("interface belongs to another node");
    assert!(matches!(error, CoreError::Forbidden(_)));
    assert!(fixture.devices.list_all().unwrap().is_empty());
}

#[test]
fn requested_interfaces_must_share_the_device_group() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let other_group = fixture
        .network
        .create_group("Other", "", "10.30.0.0/16", false)
        .unwrap();
    fixture
        .network
        .add_pool(
            other_group.id,
            NewPool {
                name: "clients".into(),
                cidr: "10.30.0.0/24".into(),
                mode: PoolMode::Auto,
                gateway: None,
            },
        )
        .unwrap();
    let other_interface = fixture
        .network
        .add_interface(
            other_group.id,
            fixture.node_id,
            NewInterface {
                name: "awg9".into(),
                label: "awg9".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let mut user = node_user(fixture.node_id, tariff.id);
    user.group_id = None;

    let mut input = multi_device(&fixture, &user);
    input.group_id = None;
    input.interface_ids = vec![fixture.interface_ids[0], other_interface.id];

    let error = fixture
        .devices
        .create_sync(&user, &tariff, input, &ObfuscationSettings::default())
        .expect_err("interfaces belong to different groups");
    assert!(matches!(error, CoreError::Forbidden(_)));
}

#[test]
fn tariff_interface_ignores_the_requested_list() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let tariff = fixture
        .tariffs
        .update(
            tariff.id,
            awg_tariffs::TariffChanges {
                interface_id: Some(Some(fixture.interface_ids[1])),
                ..Default::default()
            },
        )
        .unwrap();
    let user = user(fixture.group_id, tariff.id);
    let mut input = multi_device(&fixture, &user);
    input.interface_ids = vec![fixture.interface_ids[0]];

    let device = fixture
        .devices
        .create_sync(&user, &tariff, input, &ObfuscationSettings::default())
        .unwrap();

    assert_eq!(device.interface_id, fixture.interface_ids[1]);
    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].interface_id, fixture.interface_ids[1]);
}

#[test]
fn requested_disabled_interface_is_rejected() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    fixture
        .network
        .update_interface(
            fixture.interface_ids[1],
            awg_network::InterfaceChanges {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    let user = user(fixture.group_id, tariff.id);

    let error = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .expect_err("interface is disabled");
    assert!(matches!(error, CoreError::Conflict(_)));
}

#[test]
fn add_peer_creates_an_extra_tunnel_on_the_same_interface() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let peer = fixture
        .devices
        .add_peer_sync(
            &user,
            &tariff,
            device.id,
            fixture.interface_ids[0],
            Some("second".into()),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    assert_eq!(peer.label, "second");
    assert_eq!(peer.interface_id, fixture.interface_ids[0]);

    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 3);
    let mut addresses: Vec<IpAddr> = peers
        .iter()
        .flat_map(|peer| peer.ips.values().copied())
        .collect();
    let total = addresses.len();
    addresses.sort();
    addresses.dedup();
    assert_eq!(addresses.len(), total, "peer addresses must be unique");

    let (_, profiles) = fixture.profiles.build_all(device.id).unwrap();
    assert_eq!(profiles.len(), 3);
    assert_eq!(
        profiles
            .iter()
            .filter(|profile| profile.interface_id == fixture.interface_ids[0])
            .count(),
        2
    );

    let primary = fixture
        .profiles
        .build_one(device.id, fixture.interface_ids[0])
        .unwrap();
    assert_eq!(primary.label, "awg0");

    let by_peer = fixture.profiles.build_peer(device.id, peer.id).unwrap();
    assert_eq!(by_peer.peer_id, peer.id);
    assert_eq!(by_peer.label, "second");
    assert_ne!(primary.conf, by_peer.conf);
}

#[test]
fn add_peer_rejects_a_foreign_interface() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let other_group = fixture
        .network
        .create_group("Other", "", "10.30.0.0/16", false)
        .unwrap();
    fixture
        .network
        .add_pool(
            other_group.id,
            NewPool {
                name: "clients".into(),
                cidr: "10.30.0.0/24".into(),
                mode: PoolMode::Auto,
                gateway: None,
            },
        )
        .unwrap();
    let other_interface = fixture
        .network
        .add_interface(
            other_group.id,
            fixture.node_id,
            NewInterface {
                name: "awg9".into(),
                label: "awg9".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let error = fixture
        .devices
        .add_peer_sync(
            &user,
            &tariff,
            device.id,
            other_interface.id,
            None,
            &ObfuscationSettings::default(),
        )
        .expect_err("interface belongs to another group");
    assert!(matches!(error, CoreError::Forbidden(_)));
    assert_eq!(fixture.devices.peers_for(device.id).unwrap().len(), 2);
}

#[test]
fn add_peer_rejects_a_foreign_device() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let mut stranger = user.clone();
    stranger.id = Uuid::new_v4();

    let error = fixture
        .devices
        .add_peer_sync(
            &stranger,
            &tariff,
            device.id,
            fixture.interface_ids[0],
            None,
            &ObfuscationSettings::default(),
        )
        .expect_err("device belongs to another user");
    assert!(matches!(error, CoreError::Forbidden(_)));
}

#[test]
fn remove_peer_keeps_at_least_one_tunnel() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let peers = fixture.devices.peers_for(device.id).unwrap();
    assert_eq!(peers.len(), 2);

    let removed = fixture.devices.remove_peer(peers[0].id).unwrap();
    assert_eq!(removed.id, peers[0].id);
    assert_eq!(fixture.devices.peers_for(device.id).unwrap().len(), 1);
    assert!(fixture.devices.peer(peers[0].id).is_err());

    let last = fixture.devices.peers_for(device.id).unwrap().remove(0);
    let error = fixture
        .devices
        .remove_peer(last.id)
        .expect_err("last peer must stay");
    assert!(matches!(error, CoreError::Conflict(_)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_creates_respect_the_device_limit() {
    let fixture = Arc::new(fixture());
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let owner = user(fixture.group_id, tariff.id);
    let mut tasks = Vec::new();
    for index in 0..10u32 {
        let fixture = fixture.clone();
        let owner = owner.clone();
        let tariff = tariff.clone();
        tasks.push(tokio::spawn(async move {
            fixture
                .devices
                .create(
                    &owner,
                    &tariff,
                    NewDevice {
                        user_id: owner.id,
                        group_id: Some(fixture.group_id),
                        interface_id: Some(fixture.interface_id),
                        name: format!("device-{index}"),
                        down_kbps: 1,
                        up_kbps: 1,
                        interface_ids: Vec::new(),
                        forwarding: Forwarding::default(),
                    },
                    &ObfuscationSettings::default(),
                )
                .await
        }));
    }

    let mut created = 0;
    for task in tasks {
        if task.await.unwrap().is_ok() {
            created += 1;
        }
    }
    assert_eq!(
        created, 2,
        "max_devices=2 must be enforced under concurrency"
    );
    assert_eq!(fixture.devices.list_for_user(owner.id).unwrap().len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_add_peer_allocates_unique_addresses() {
    let fixture = Arc::new(fixture());
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let owner = user(fixture.group_id, tariff.id);
    let device = fixture
        .devices
        .create(
            &owner,
            &tariff,
            NewDevice {
                user_id: owner.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 1,
                up_kbps: 1,
                interface_ids: Vec::new(),
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .await
        .unwrap();

    let mut tasks = Vec::new();
    for index in 0..10u32 {
        let fixture = fixture.clone();
        let owner = owner.clone();
        let tariff = tariff.clone();
        tasks.push(tokio::spawn(async move {
            fixture
                .devices
                .add_peer(
                    &owner,
                    &tariff,
                    device.id,
                    fixture.interface_id,
                    Some(format!("peer-{index}")),
                    &ObfuscationSettings::default(),
                )
                .await
        }));
    }

    let mut addresses = std::collections::HashSet::new();
    let mut success = 0;
    for task in tasks {
        if let Ok(peer) = task.await.unwrap() {
            success += 1;
            for address in peer.ips.values() {
                assert!(addresses.insert(*address), "address {address} was reused");
            }
        }
    }
    assert_eq!(success, 10);
    let peers = fixture.devices.peers_for(device.id).unwrap();
    let unique: std::collections::HashSet<_> = peers
        .iter()
        .flat_map(|peer| peer.ips.values().copied())
        .collect();
    assert_eq!(unique.len(), peers.len());
}

#[test]
fn rename_peer_changes_primary_order_and_label() {
    let fixture = fixture();
    let tariff = fixture.tariffs.list().unwrap().remove(0);
    let user = user(fixture.group_id, tariff.id);
    let device = fixture
        .devices
        .create_sync(
            &user,
            &tariff,
            multi_device(&fixture, &user),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let extra = fixture
        .devices
        .add_peer_sync(
            &user,
            &tariff,
            device.id,
            fixture.interface_ids[0],
            Some("zzz".into()),
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let renamed = fixture.devices.rename_peer(extra.id, "aaa".into()).unwrap();
    assert_eq!(renamed.label, "aaa");
    let primary = fixture
        .profiles
        .build_one(device.id, fixture.interface_ids[0])
        .unwrap();
    assert_eq!(primary.peer_id, extra.id);

    let error = fixture
        .devices
        .rename_peer(extra.id, "   ".into())
        .expect_err("empty label");
    assert!(matches!(error, CoreError::Invalid(_)));
}
