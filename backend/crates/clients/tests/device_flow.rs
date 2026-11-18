use std::collections::BTreeMap;
use std::net::IpAddr;
use std::sync::Arc;

use base64::Engine;
use chrono::Utc;
use uuid::Uuid;

use awg_clients::{
    DeviceService, Forwarding, NewDevice, ProfileService, RedbDevicePeerRepository,
    RedbDeviceRepository,
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

struct Fixture {
    devices: DeviceService,
    profiles: ProfileService,
    tariffs: Arc<TariffService>,
    network: Arc<NetworkService>,
    group_id: Uuid,
    node_id: Uuid,
    interface_id: Uuid,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 500_000,
                up_kbps: 500_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "laptop".into(),
                down_kbps: 10_000,
                up_kbps: 10_000,
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    assert_eq!(fixture.devices.list_for_user(user.id).unwrap().len(), 2);

    let refused = fixture.devices.create(
        &user,
        &tariff,
        NewDevice {
            user_id: user.id,
            group_id: Some(fixture.group_id),
            interface_id: Some(fixture.interface_id),
            name: "tablet".into(),
            down_kbps: 1,
            up_kbps: 1,
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
    assert!(profiles[0].conf.contains("RandomTrailers = 1"));

    let group_devices = fixture.devices.list_all().unwrap();
    assert_eq!(group_devices.len(), 2);
    fixture.devices.delete(second.id).unwrap();
    assert_eq!(fixture.devices.peers_for(second.id).unwrap().len(), 0);
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(other),
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: None,
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: None,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "one".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "two".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "one".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let second_id = Uuid::new_v4();
    // duplicate + self-ish list cleared when all
    let second = fixture
        .devices
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "two".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
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
        .create(
            &owner,
            &tariff,
            NewDevice {
                user_id: owner.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "one".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let other_owner = user(fixture.group_id, tariff.id);
    // foreign: allowed device from other user
    let other_device = fixture
        .devices
        .create(
            &other_owner,
            &tariff,
            NewDevice {
                user_id: other_owner.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "other".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let res = fixture.devices.create(
        &owner,
        &tariff,
        NewDevice {
            user_id: owner.id,
            group_id: Some(fixture.group_id),
            interface_id: Some(fixture.interface_id),
            name: "bad".into(),
            down_kbps: 1_000,
            up_kbps: 1_000,
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
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "phone".into(),
                down_kbps: 10_000,
                up_kbps: 10_000,
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();
    let second = fixture
        .devices
        .create(
            &user,
            &tariff,
            NewDevice {
                user_id: user.id,
                group_id: Some(fixture.group_id),
                interface_id: Some(fixture.interface_id),
                name: "laptop".into(),
                down_kbps: 10_000,
                up_kbps: 10_000,
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
