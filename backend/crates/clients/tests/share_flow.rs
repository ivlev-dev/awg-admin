use std::sync::{Arc, Barrier};

use base64::Engine;
use chrono::{Duration, Utc};
use uuid::Uuid;

use awg_clients::domain::ShareLinkRepository;
use awg_clients::{
    DeviceService, Forwarding, NewDevice, ProfileService, RedbDevicePeerRepository,
    RedbDeviceRepository, RedbShareLinkRepository, ShareConsume, ShareFormat, ShareLink,
    ShareLinkState, ShareService,
};
use awg_identity::{Role, User};
use awg_network::{
    NetworkService, NewInterface, NewPool, PoolMode, RedbCidrPoolRepository, RedbGroupRepository,
    RedbInterfaceRepository, RedbNodeRepository,
};
use awg_shared::CoreError;
use awg_shared::crypto::Sealer;
use awg_shared::obf::ObfuscationSettings;
use awg_storage::Store;
use awg_tariffs::{NewTariff, RedbTariffRepository, TariffService};

struct Fixture {
    devices: DeviceService,
    network: Arc<NetworkService>,
    profiles: Arc<ProfileService>,
    links: Arc<RedbShareLinkRepository>,
    group_id: Uuid,
    interface_id: Uuid,
    device_id: Uuid,
}

fn fixture() -> Fixture {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let key = base64::engine::general_purpose::STANDARD.encode([21u8; 32]);
    let sealer = Arc::new(Sealer::from_master_key(&key).unwrap());

    let network = Arc::new(NetworkService::new(
        Arc::new(RedbGroupRepository::new(store.clone())),
        Arc::new(RedbNodeRepository::new(store.clone())),
        Arc::new(RedbInterfaceRepository::new(store.clone())),
        Arc::new(RedbCidrPoolRepository::new(store.clone())),
        sealer.clone(),
    ));
    let group = network
        .create_group("Main", "", "10.0.0.1/14", false)
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
    let interface = network
        .add_interface(
            group.id,
            node.id,
            NewInterface {
                name: "awg0".into(),
                label: "awg0".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
        store.clone(),
    ))));
    let tariff = tariffs
        .create(NewTariff {
            name: "Basic".into(),
            description: String::new(),
            max_devices: 4,
            device_down_kbps: 50_000,
            device_up_kbps: 20_000,
            group_down_kbps: 80_000,
            group_up_kbps: 40_000,
            traffic_quota_bytes: None,
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
    let profiles = Arc::new(ProfileService::new(
        device_repo,
        peer_repo,
        network.clone(),
        sealer,
        vec!["1.1.1.1".into()],
    ));

    let now = Utc::now();
    let owner = User {
        id: Uuid::new_v4(),
        login: "owner".into(),
        password_hash: String::new(),
        role: Role::User,
        tariff_id: Some(tariff.id),
        group_id: Some(group.id),
        disabled: false,
        email: None,
        status: awg_identity::UserStatus::Active,
        totp_secret_sealed: None,
        totp_enabled: false,
        recovery_codes: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    let device = devices
        .create(
            &owner,
            &tariff,
            NewDevice {
                user_id: owner.id,
                group_id: group.id,
                name: "phone".into(),
                down_kbps: 1_000,
                up_kbps: 1_000,
                forwarding: Forwarding::default(),
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    Fixture {
        devices,
        network,
        profiles,
        links: Arc::new(RedbShareLinkRepository::new(store)),
        group_id: group.id,
        interface_id: interface.id,
        device_id: device.id,
    }
}

impl Fixture {
    fn service(&self) -> ShareService {
        ShareService::new(self.links.clone(), self.profiles.clone())
    }

    fn create(&self, max_uses: Option<u32>) -> ShareLink {
        self.service()
            .create(
                self.device_id,
                self.interface_id,
                Uuid::new_v4(),
                ShareFormat::Conf,
                3600,
                max_uses,
            )
            .unwrap()
    }
}

#[test]
fn one_time_link_is_consumed_once() {
    let fixture = fixture();
    let service = fixture.service();
    let link = fixture.create(Some(1));

    assert!(service.resolve(&link.token).is_ok());
    let error = service.resolve(&link.token).unwrap_err();
    assert!(matches!(error, CoreError::Forbidden(message) if message.contains("exhausted")));

    let stored = fixture.links.find(&link.token).unwrap().unwrap();
    assert_eq!(stored.uses, 1);
    assert_eq!(stored.state(Utc::now()), ShareLinkState::Exhausted);
}

#[test]
fn limited_link_allows_exact_number_of_uses() {
    let fixture = fixture();
    let service = fixture.service();
    let link = fixture.create(Some(3));

    for use_number in 1..=3 {
        assert!(service.resolve(&link.token).is_ok());
        let stored = fixture.links.find(&link.token).unwrap().unwrap();
        assert_eq!(stored.uses, use_number);
        assert_eq!(stored.remaining_uses(), Some(3 - use_number));
    }

    let error = service.resolve(&link.token).unwrap_err();
    assert!(matches!(error, CoreError::Forbidden(message) if message.contains("exhausted")));
}

#[test]
fn unlimited_link_does_not_exhaust() {
    let fixture = fixture();
    let service = fixture.service();
    let link = fixture.create(None);

    assert!(service.resolve(&link.token).is_ok());
    assert!(service.resolve(&link.token).is_ok());

    let stored = fixture.links.find(&link.token).unwrap().unwrap();
    assert_eq!(stored.uses, 2);
    assert_eq!(stored.remaining_uses(), None);
    assert_eq!(stored.state(Utc::now()), ShareLinkState::Active);
}

#[test]
fn revoke_all_for_device_marks_active_links() {
    let fixture = fixture();
    let service = fixture.service();
    let first = fixture.create(None);
    let second = fixture.create(Some(5));

    assert_eq!(service.revoke_all_for_device(fixture.device_id).unwrap(), 2);
    assert_eq!(service.revoke_all_for_device(fixture.device_id).unwrap(), 0);

    for link in [&first, &second] {
        let error = service.resolve(&link.token).unwrap_err();
        assert!(matches!(error, CoreError::Forbidden(message) if message.contains("revoked")));
        let stored = fixture.links.find(&link.token).unwrap().unwrap();
        assert!(stored.revoked_at.is_some());
    }

    let listed = service.list_for_device(fixture.device_id).unwrap();
    assert_eq!(listed.len(), 2);
    assert!(
        listed
            .iter()
            .all(|link| link.state(Utc::now()) == ShareLinkState::Revoked)
    );
}

#[test]
fn revoke_all_for_device_skips_other_devices() {
    let fixture = fixture();
    let service = fixture.service();
    let foreign = ShareLink {
        token: "foreign".into(),
        device_id: Uuid::new_v4(),
        interface_id: fixture.interface_id,
        created_by: Uuid::new_v4(),
        format: ShareFormat::Conf,
        expires_at: Utc::now() + Duration::hours(1),
        used_at: None,
        max_uses: None,
        uses: 0,
        revoked_at: None,
        created_at: Utc::now(),
    };
    fixture.links.save(&foreign).unwrap();
    fixture.create(None);

    assert_eq!(service.revoke_all_for_device(fixture.device_id).unwrap(), 1);
    let stored = fixture.links.find("foreign").unwrap().unwrap();
    assert!(stored.revoked_at.is_none());
}

#[test]
fn expired_link_is_rejected() {
    let fixture = fixture();
    let service = fixture.service();
    let link = fixture.create(None);
    let mut stored = fixture.links.find(&link.token).unwrap().unwrap();
    stored.expires_at = Utc::now() - Duration::seconds(1);
    fixture.links.save(&stored).unwrap();

    let error = service.resolve(&link.token).unwrap_err();
    assert!(matches!(error, CoreError::Forbidden(message) if message.contains("expired")));

    let listed = service.list_for_device(fixture.device_id).unwrap();
    assert_eq!(listed[0].state(Utc::now()), ShareLinkState::Expired);
}

#[test]
fn list_for_device_returns_every_state_sorted_by_creation() {
    let fixture = fixture();
    let service = fixture.service();
    let active = fixture.create(None);
    let exhausted = fixture.create(Some(1));
    let revoked = fixture.create(None);
    assert!(service.resolve(&exhausted.token).is_ok());
    let mut stored = fixture.links.find(&revoked.token).unwrap().unwrap();
    stored.revoked_at = Some(Utc::now());
    fixture.links.save(&stored).unwrap();
    let _ = active;

    let listed = service.list_for_device(fixture.device_id).unwrap();
    assert_eq!(listed.len(), 3);
    assert!(
        listed
            .windows(2)
            .all(|pair| pair[0].created_at >= pair[1].created_at)
    );
    let states: Vec<ShareLinkState> = listed.iter().map(|link| link.state(Utc::now())).collect();
    assert_eq!(
        states,
        vec![
            ShareLinkState::Revoked,
            ShareLinkState::Exhausted,
            ShareLinkState::Active
        ]
    );
}

#[test]
fn create_rejects_out_of_range_max_uses() {
    let fixture = fixture();
    let service = fixture.service();
    let error = service
        .create(
            fixture.device_id,
            fixture.interface_id,
            Uuid::new_v4(),
            ShareFormat::Conf,
            3600,
            Some(0),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));

    let error = service
        .create(
            fixture.device_id,
            fixture.interface_id,
            Uuid::new_v4(),
            ShareFormat::Conf,
            3600,
            Some(1001),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::Invalid(_)));
}

#[test]
fn missing_token_is_not_found() {
    let fixture = fixture();
    let service = fixture.service();
    let error = service.resolve("unknown").unwrap_err();
    assert!(matches!(error, CoreError::NotFound(_)));
}

#[test]
fn consume_is_atomic_under_concurrency() {
    let fixture = fixture();
    let link = ShareLink {
        token: "race".into(),
        device_id: fixture.device_id,
        interface_id: fixture.interface_id,
        created_by: Uuid::new_v4(),
        format: ShareFormat::Conf,
        expires_at: Utc::now() + Duration::hours(1),
        used_at: None,
        max_uses: Some(1),
        uses: 0,
        revoked_at: None,
        created_at: Utc::now(),
    };
    fixture.links.save(&link).unwrap();

    let barrier = Arc::new(Barrier::new(8));
    let mut handles = Vec::new();
    for _ in 0..8 {
        let links = fixture.links.clone();
        let barrier = barrier.clone();
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            match links.consume("race", Utc::now()).unwrap() {
                ShareConsume::Consumed(_) => 1,
                _ => 0,
            }
        }));
    }
    let successes: i32 = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .sum();
    assert_eq!(successes, 1);

    let stored = fixture.links.find("race").unwrap().unwrap();
    assert_eq!(stored.uses, 1);
}

#[test]
fn fixture_exposes_group_and_devices() {
    let fixture = fixture();
    assert_eq!(fixture.devices.list_all().unwrap().len(), 1);
    assert_eq!(fixture.network.list_interfaces().unwrap().len(), 1);
    assert_eq!(
        fixture.network.list_pools(fixture.group_id).unwrap().len(),
        1
    );
}
