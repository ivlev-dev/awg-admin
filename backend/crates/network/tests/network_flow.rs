use std::sync::Arc;

use awg_network::domain::CidrPoolRepository;
use awg_network::{
    CidrPool, NetworkService, NewInterface, NewPool, Node, NodeMetricsUpdate, NodeStatus, PoolMode,
    RedbCidrPoolRepository, RedbGroupRepository, RedbInterfaceRepository, RedbNodeRepository,
};
use awg_shared::CoreError;
use awg_shared::crypto::Sealer;
use awg_shared::obf::ObfuscationSettings;
use awg_storage::Store;
use base64::Engine;
use chrono::Utc;

fn sealer() -> Arc<Sealer> {
    let key = base64::engine::general_purpose::STANDARD.encode([9u8; 32]);
    Arc::new(Sealer::from_master_key(&key).unwrap())
}

fn service_with_store() -> (NetworkService, Arc<Store>) {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let network = NetworkService::new(
        Arc::new(RedbGroupRepository::new(store.clone())),
        Arc::new(RedbNodeRepository::new(store.clone())),
        Arc::new(RedbInterfaceRepository::new(store.clone())),
        Arc::new(RedbCidrPoolRepository::new(store.clone())),
        sealer(),
    );
    (network, store)
}

fn service() -> NetworkService {
    service_with_store().0
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

fn pool(name: &str, cidr: &str, gateway: Option<&str>) -> NewPool {
    NewPool {
        name: name.into(),
        cidr: cidr.into(),
        mode: PoolMode::Auto,
        gateway: gateway.map(str::to_string),
    }
}

#[test]
fn pools_wider_than_slash_16_are_rejected() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();

    let err = network
        .add_pool(group.id, pool("wide", "10.0.0.0/15", None))
        .unwrap_err();

    assert!(matches!(err, CoreError::Invalid(message) if message.contains("/16")));
    assert!(network.list_pools(group.id).unwrap().is_empty());
}

#[test]
fn correct_pool_gateway_is_accepted() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();

    let plain = network
        .add_pool(group.id, pool("a", "10.1.0.0/24", Some("10.1.0.1")))
        .unwrap();
    assert_eq!(plain.gateway.as_deref(), Some("10.1.0.1"));

    let with_prefix = network
        .add_pool(group.id, pool("b", "10.2.0.0/24", Some("10.2.0.1/24")))
        .unwrap();
    assert_eq!(with_prefix.gateway.as_deref(), Some("10.2.0.1/24"));
}

#[test]
fn pool_gateway_outside_the_pool_is_rejected() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();

    let err = network
        .add_pool(group.id, pool("a", "10.1.0.0/24", Some("10.2.0.1")))
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(message) if message.contains("outside")));

    let err = network
        .add_pool(group.id, pool("b", "10.1.0.0/24", Some("10.2.0.1/24")))
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(message) if message.contains("outside")));
}

#[test]
fn pool_gateway_on_boundary_addresses_is_rejected() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();

    for gateway in ["10.1.0.0", "10.1.0.255"] {
        let err = network
            .add_pool(group.id, pool("a", "10.1.0.0/24", Some(gateway)))
            .unwrap_err();
        assert!(
            matches!(err, CoreError::Invalid(message) if message.contains("network or broadcast")),
            "unexpected result for {gateway}"
        );
    }
}

#[test]
fn update_pool_validates_the_new_gateway() {
    let network = service();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();
    let saved = network
        .add_pool(group.id, pool("a", "10.1.0.0/24", None))
        .unwrap();

    let err = network
        .update_pool(saved.id, None, None, Some(Some("10.9.0.1".into())), None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)));

    let updated = network
        .update_pool(saved.id, None, None, Some(Some("10.1.0.2".into())), None)
        .unwrap();
    assert_eq!(updated.gateway.as_deref(), Some("10.1.0.2"));
}

#[test]
fn enabling_an_overlapping_pool_after_update_is_rejected() {
    let (network, store) = service_with_store();
    let group = network
        .create_group("Main", "", "10.0.0.0/14", false)
        .unwrap();
    let active = network
        .add_pool(group.id, pool("active", "10.1.0.0/24", None))
        .unwrap();

    let now = Utc::now();
    let hidden = CidrPool {
        id: uuid::Uuid::new_v4(),
        group_id: group.id,
        name: "hidden".into(),
        cidr: "10.1.0.128/25".into(),
        mode: PoolMode::Auto,
        gateway: None,
        enabled: false,
        created_at: now,
        updated_at: now,
    };
    RedbCidrPoolRepository::new(store)
        .save(&hidden)
        .expect("disabled pool is stored directly");

    let err = network
        .update_pool(hidden.id, None, None, None, Some(true))
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict(message) if message.contains("overlaps")));

    // A pool never conflicts with itself and disabling a conflicting pool is allowed.
    assert!(
        network
            .update_pool(active.id, Some("renamed".into()), None, None, Some(true))
            .is_ok()
    );
    assert!(
        network
            .update_pool(hidden.id, None, None, None, Some(false))
            .is_ok()
    );
}

#[test]
fn authenticate_node_uses_the_token_index_and_stops_after_deletion() {
    let network = service();
    let (node, token) = network.create_node("node-a").unwrap();

    assert_eq!(network.authenticate_node(&token).unwrap().id, node.id);
    assert!(network.authenticate_node("wrong").is_err());

    network.delete_node(node.id).unwrap();
    assert!(network.authenticate_node(&token).is_err());
}

#[test]
fn concurrent_metrics_and_status_updates_keep_both_fields() {
    let network = Arc::new(service());
    let (node, _) = network.create_node("node-a").unwrap();
    let id = node.id;

    let metrics = {
        let network = network.clone();
        std::thread::spawn(move || {
            for step in 0..25 {
                let update = NodeMetricsUpdate {
                    cpu_load: f64::from(step),
                    mem_used_bytes: 100,
                    mem_total_bytes: 200,
                    kernel_version: "6.8.0".into(),
                    worker_version: "0.1.0".into(),
                    uptime_secs: step as u64,
                };
                network.record_metrics(id, update).unwrap();
            }
        })
    };

    let status = {
        let network = network.clone();
        std::thread::spawn(move || {
            for _ in 0..25 {
                network
                    .mark_node(id, NodeStatus::Online, Some("0.2.0".into()))
                    .unwrap();
            }
        })
    };

    metrics.join().expect("metrics thread does not panic");
    status.join().expect("status thread does not panic");

    let stored = network.get_node(id).unwrap();
    assert_eq!(stored.cpu_load, Some(24.0));
    assert_eq!(stored.uptime_secs, Some(24));
    assert_eq!(stored.mem_used_bytes, Some(100));
    assert_eq!(stored.status, NodeStatus::Online);
    assert_eq!(stored.version.as_deref(), Some("0.2.0"));
    assert!(stored.last_seen.is_some());
    assert!(stored.metrics_at.is_some());
}

#[test]
fn stale_token_index_row_never_authenticates() {
    let (network, store) = service_with_store();
    let (node, token) = network.create_node("node-a").unwrap();

    // Simulate a desynchronized index: the row still points at the node, but
    // the node's stored hash no longer matches the token that was issued.
    let mut forged = node.clone();
    forged.token_hash = "00".repeat(32);
    store
        .put(awg_storage::Table::Nodes, &node.id.to_string(), &forged)
        .unwrap();

    assert!(network.authenticate_node(&token).is_err());
}
