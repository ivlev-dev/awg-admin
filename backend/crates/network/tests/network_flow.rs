use std::sync::Arc;

use awg_network::{
    NetworkService, NewInterface, NewPool, Node, NodeMetricsUpdate, PoolMode,
    RedbCidrPoolRepository, RedbGroupRepository, RedbInterfaceRepository, RedbNodeRepository,
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

#[test]
fn rotating_node_token_invalidates_the_old_token() {
    let network = service();
    let (node, old_token) = network.create_node("node-a").unwrap();
    let issued_at = node.token_issued_at.unwrap();

    let (rotated, new_token) = network.rotate_node_token(node.id).unwrap();

    assert_ne!(new_token, old_token);
    assert_eq!(rotated.id, node.id);
    assert!(rotated.token_issued_at.unwrap() >= issued_at);
    assert!(network.authenticate_node(&old_token).is_err());
    assert_eq!(network.authenticate_node(&new_token).unwrap().id, node.id);
    assert_eq!(
        network.get_node(node.id).unwrap().token_hash,
        rotated.token_hash
    );
}

#[test]
fn rotating_unknown_node_fails() {
    let network = service();
    assert!(network.rotate_node_token(uuid::Uuid::new_v4()).is_err());
}

#[test]
fn records_node_metrics() {
    let network = service();
    let (node, _) = network.create_node("node-a").unwrap();

    let saved = network
        .record_metrics(
            node.id,
            NodeMetricsUpdate {
                cpu_load: 0.5,
                mem_used_bytes: 1024,
                mem_total_bytes: 2048,
                kernel_version: "6.8.0".into(),
                worker_version: "0.1.0".into(),
                uptime_secs: 100,
            },
        )
        .unwrap();

    assert_eq!(saved.cpu_load, Some(0.5));
    assert_eq!(saved.mem_used_bytes, Some(1024));
    assert_eq!(saved.mem_total_bytes, Some(2048));
    assert_eq!(saved.kernel_version.as_deref(), Some("6.8.0"));
    assert_eq!(saved.worker_version.as_deref(), Some("0.1.0"));
    assert_eq!(saved.uptime_secs, Some(100));
    assert!(saved.metrics_at.is_some());

    let stored = network.get_node(node.id).unwrap();
    assert_eq!(stored.cpu_load, Some(0.5));
    assert!(stored.metrics_at.is_some());
}

#[test]
fn legacy_node_json_deserializes_without_new_fields() {
    let raw = r#"{
        "id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        "name": "legacy",
        "token_hash": "abc",
        "status": "offline",
        "last_seen": null,
        "version": null,
        "created_at": "2024-01-01T00:00:00Z"
    }"#;

    let node: Node = serde_json::from_str(raw).unwrap();

    assert_eq!(node.name, "legacy");
    assert!(node.token_issued_at.is_none());
    assert!(node.cpu_load.is_none());
    assert!(node.mem_used_bytes.is_none());
    assert!(node.mem_total_bytes.is_none());
    assert!(node.kernel_version.is_none());
    assert!(node.worker_version.is_none());
    assert!(node.uptime_secs.is_none());
    assert!(node.metrics_at.is_none());
}

#[test]
fn node_with_metrics_round_trips_through_json() {
    let network = service();
    let (node, _) = network.create_node("node-a").unwrap();
    let saved = network
        .record_metrics(
            node.id,
            NodeMetricsUpdate {
                cpu_load: 0.25,
                mem_used_bytes: 512,
                mem_total_bytes: 1024,
                kernel_version: "6.9.0".into(),
                worker_version: "0.2.0".into(),
                uptime_secs: 42,
            },
        )
        .unwrap();

    let encoded = serde_json::to_string(&saved).unwrap();
    let decoded: Node = serde_json::from_str(&encoded).unwrap();

    assert_eq!(decoded.token_issued_at, saved.token_issued_at);
    assert_eq!(decoded.cpu_load, Some(0.25));
    assert_eq!(decoded.metrics_at, saved.metrics_at);
}
