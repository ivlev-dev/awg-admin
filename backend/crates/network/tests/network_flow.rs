use std::sync::Arc;

use awg_network::{
    NetworkService, NewInterface, NewPool, PoolMode, RedbCidrPoolRepository, RedbGroupRepository,
    RedbInterfaceRepository, RedbNodeRepository,
};
use awg_shared::crypto::Sealer;
use awg_shared::obf::ObfuscationSettings;
use awg_storage::Store;
use base64::Engine;

fn sealer() -> Arc<Sealer> {
    let key = base64::engine::general_purpose::STANDARD.encode([9u8; 32]);
    Arc::new(Sealer::from_master_key(&key).unwrap())
}

fn service() -> NetworkService {
    let store = Arc::new(Store::open_in_memory().unwrap());
    NetworkService::new(
        Arc::new(RedbGroupRepository::new(store.clone())),
        Arc::new(RedbNodeRepository::new(store.clone())),
        Arc::new(RedbInterfaceRepository::new(store.clone())),
        Arc::new(RedbCidrPoolRepository::new(store)),
        sealer(),
    )
}

fn interface(name: &str) -> NewInterface {
    NewInterface {
        name: name.into(),
        label: "test".into(),
        endpoint_host: "vpn.example.com".into(),
        endpoint_port: 51820,
        listen_port: 51820,
        mtu: 1420,
    }
}

#[test]
fn group_pool_node_and_interface_flow() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.1/14", false)
        .unwrap();
    let pool = network
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
    assert_eq!(pool.cidr, "10.1.0.0/24");

    assert!(
        network
            .add_pool(
                group.id,
                NewPool {
                    name: "outside".into(),
                    cidr: "11.0.0.0/24".into(),
                    mode: PoolMode::Auto,
                    gateway: None,
                },
            )
            .is_err()
    );

    let (node, token) = network.create_node("node-a").unwrap();
    let authenticated = network.authenticate_node(&token).unwrap();
    assert_eq!(authenticated.id, node.id);
    assert!(network.authenticate_node("wrong").is_err());

    let created = network
        .add_interface(
            group.id,
            node.id,
            interface("awg0"),
            &ObfuscationSettings::default(),
        )
        .unwrap();
    assert!(created.public_key.len() > 20);
    assert_eq!(network.interface_private_key(&created).unwrap().len(), 44);

    assert!(
        network
            .add_interface(
                group.id,
                node.id,
                interface("awg0"),
                &ObfuscationSettings::default(),
            )
            .is_err()
    );

    let rotated = network
        .rotate_interface(created.id, &ObfuscationSettings::default())
        .unwrap();
    assert_ne!(rotated.public_key, created.public_key);
}

#[test]
fn overlapping_pools_are_rejected() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();
    network
        .add_pool(
            group.id,
            NewPool {
                name: "a".into(),
                cidr: "10.1.0.0/24".into(),
                mode: PoolMode::Auto,
                gateway: None,
            },
        )
        .unwrap();
    assert!(
        network
            .add_pool(
                group.id,
                NewPool {
                    name: "b".into(),
                    cidr: "10.1.0.128/25".into(),
                    mode: PoolMode::RfOnly,
                    gateway: None,
                },
            )
            .is_err()
    );
}
