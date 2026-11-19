use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{
    AppEnv, OTHER_EMAIL, OWNER_EMAIL, PASSWORD, app_env, app_env_with_billing,
};
use awg_network::InterfaceChanges;

fn router(env: &AppEnv) -> Router {
    routes::router(env.state.clone(), Readiness::new(env.store.clone()))
}

async fn call(
    app: Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    call_with_key(app, method, uri, token, None, body).await
}

async fn call_with_key(
    app: Router,
    method: &str,
    uri: &str,
    token: &str,
    idempotency_key: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_000))));
    if let Some(key) = idempotency_key {
        builder = builder.header("idempotency-key", key);
    }
    let payload = match body {
        Some(value) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&value).unwrap())
        }
        None => Body::empty(),
    };
    let response = app.oneshot(builder.body(payload).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, json)
}

async fn create_device(app: Router, token: &str, name: &str) -> Value {
    let (status, body) = call(
        app,
        "POST",
        "/api/v1/app/devices",
        token,
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

fn assert_revision(revision: &Value) {
    let revision = revision.as_str().unwrap();
    assert_eq!(revision.len(), 16);
    assert!(revision.chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test]
async fn bootstrap_reports_tariff_quota_and_devices() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["id"], env.owner_id.to_string());
    assert_eq!(body["user"]["email"], OWNER_EMAIL);
    assert_eq!(body["tariff"]["id"], env.tariff_id.to_string());
    assert_eq!(body["tariff"]["name"], "mobile");
    assert_eq!(body["tariff"]["max_devices"], 2);
    assert_eq!(body["tariff"]["device_down_kbps"], 100_000);
    assert_eq!(body["tariff"]["device_up_kbps"], 50_000);
    assert_eq!(body["tariff"]["traffic_quota_bytes"], 1_000_000_000_u64);
    assert_eq!(body["quota"]["used_bytes"], 0);
    assert_eq!(body["quota"]["quota_bytes"], 1_000_000_000_u64);
    assert_eq!(body["quota"]["exceeded"], false);
    assert_eq!(body["subscription"], Value::Null);
    assert_eq!(
        body["access"],
        json!({ "blocked": false, "throttled": false, "reasons": [] })
    );
    assert_eq!(body["devices"], json!([]));
}

#[tokio::test]
async fn bootstrap_without_tariff_has_null_tariff_and_quota() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.other_token,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["email"], OTHER_EMAIL);
    assert_eq!(body["user"]["tariff_id"], Value::Null);
    assert_eq!(body["tariff"], Value::Null);
    assert_eq!(body["quota"]["quota_bytes"], Value::Null);
    assert_eq!(body["quota"]["percent"], Value::Null);
    assert_eq!(body["quota"]["used_bytes"], 0);
    assert_eq!(body["subscription"], Value::Null);
    assert_eq!(
        body["access"],
        json!({ "blocked": true, "throttled": false, "reasons": ["tariff_missing"] })
    );
}

#[tokio::test]
async fn create_device_without_tariff_requires_a_tariff() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.other_token,
        Some(json!({ "name": "Phone" })),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "tariff_required");
    assert_eq!(body["error"]["message"], "tariff is required");
    assert!(
        env.state
            .devices
            .list_for_user(env.other_id)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn disabled_account_cannot_log_in() {
    let env = app_env();
    env.state
        .identity
        .update(
            env.other_id,
            awg_identity::UserChanges {
                full_name: None,
                email: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(true),
            },
        )
        .unwrap();

    let response = router(&env)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_000))))
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": OTHER_EMAIL,
                        "password": PASSWORD,
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["error"]["code"], "account_disabled");
    assert_eq!(body["error"]["message"], "account is disabled");
}

fn save_subscription(
    store: &std::sync::Arc<awg_storage::Store>,
    user_id: uuid::Uuid,
    plan_id: uuid::Uuid,
    status: awg_billing::SubscriptionStatus,
    created_at: chrono::DateTime<chrono::Utc>,
) -> awg_billing::Subscription {
    use awg_billing::SubscriptionRepository;

    let subscription = awg_billing::Subscription {
        id: uuid::Uuid::new_v4(),
        user_id,
        plan_id,
        status,
        current_period_start: created_at,
        current_period_end: created_at + chrono::Duration::days(30),
        auto_renew: true,
        cancel_at_period_end: false,
        trial_ends_at: None,
        gateway: None,
        gateway_ref: None,
        created_at,
        updated_at: created_at,
    };
    awg_billing::RedbSubscriptionRepository::new(store.clone())
        .save(&subscription)
        .unwrap();
    subscription
}

fn pro_plan(env: &AppEnv) -> awg_billing::Plan {
    use awg_billing::{BillingPeriod, NewPlan};

    env.state
        .billing
        .create_plan(NewPlan {
            name: "Pro".into(),
            description: String::new(),
            price_cents: 99_000,
            currency: "RUB".into(),
            period: BillingPeriod::Month,
            tariff_id: env.tariff_id,
            active: true,
        })
        .unwrap()
}

#[tokio::test]
async fn bootstrap_reports_active_subscription_and_its_status_changes() {
    use awg_billing::SubscriptionStatus;

    let env = app_env_with_billing(true);
    let plan = pro_plan(&env);
    let base = chrono::Utc::now() - chrono::Duration::days(1);
    let active = save_subscription(
        &env.store,
        env.owner_id,
        plan.id,
        SubscriptionStatus::Active,
        base,
    );

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["subscription"]["id"], active.id.to_string());
    assert_eq!(body["subscription"]["plan_name"], "Pro");
    assert_eq!(body["subscription"]["status"], "active");
    assert_eq!(body["subscription"]["grants_access"], true);
    assert_eq!(body["subscription"]["auto_renew"], true);
    assert_eq!(body["subscription"]["cancel_at_period_end"], false);
    assert!(body["subscription"]["current_period_end"].is_string());
    assert_eq!(
        body["access"],
        json!({ "blocked": false, "throttled": false, "reasons": [] })
    );

    save_subscription(
        &env.store,
        env.owner_id,
        plan.id,
        SubscriptionStatus::Suspended,
        base + chrono::Duration::hours(1),
    );
    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["subscription"]["status"], "suspended");
    assert_eq!(body["subscription"]["grants_access"], false);
    assert_eq!(
        body["access"],
        json!({
            "blocked": false,
            "throttled": true,
            "reasons": ["subscription_inactive"]
        })
    );
}

#[tokio::test]
async fn canceled_only_subscription_is_not_current_but_still_throttles() {
    use awg_billing::SubscriptionStatus;

    let env = app_env_with_billing(true);
    let plan = pro_plan(&env);
    save_subscription(
        &env.store,
        env.owner_id,
        plan.id,
        SubscriptionStatus::Canceled,
        chrono::Utc::now(),
    );

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["subscription"], Value::Null);
    assert_eq!(
        body["access"],
        json!({
            "blocked": false,
            "throttled": true,
            "reasons": ["subscription_inactive"]
        })
    );
}

#[tokio::test]
async fn throttled_subscription_keeps_existing_device_config_available() {
    use awg_billing::SubscriptionStatus;

    let env = app_env_with_billing(true);
    let plan = pro_plan(&env);
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    save_subscription(
        &env.store,
        env.owner_id,
        plan.id,
        SubscriptionStatus::Suspended,
        chrono::Utc::now(),
    );

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/app/devices/{device_id}/config"),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["conf"].as_str().unwrap().contains("[Interface]"));

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["access"]["throttled"], true);
    assert_eq!(body["access"]["blocked"], false);
}

#[tokio::test]
async fn throttled_subscription_limits_desired_state_to_one_kbps() {
    use awg_billing::SubscriptionStatus;

    let env = app_env_with_billing(true);
    let plan = pro_plan(&env);
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let interface_id: uuid::Uuid = created["device"]["interface_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let base = chrono::Utc::now() - chrono::Duration::days(2);

    let _active = save_subscription(
        &env.store,
        env.owner_id,
        plan.id,
        SubscriptionStatus::Active,
        base,
    );
    let state = env.state.orchestration.snapshot(env.node_id).unwrap();
    let interface = state
        .interfaces
        .iter()
        .find(|interface| interface.id == interface_id)
        .unwrap();
    let peer = interface
        .peers
        .iter()
        .find(|peer| peer.device_id.to_string() == device_id)
        .unwrap();
    assert_eq!(peer.down_kbps, 100_000);
    assert_eq!(peer.up_kbps, 50_000);
    let limit = interface
        .user_limits
        .iter()
        .find(|limit| limit.user_id == env.owner_id)
        .unwrap();
    assert_eq!((limit.group_down_kbps, limit.group_up_kbps), (0, 0));

    for (offset, status) in [
        SubscriptionStatus::Suspended,
        SubscriptionStatus::Canceled,
        SubscriptionStatus::PastDue,
    ]
    .into_iter()
    .enumerate()
    {
        save_subscription(
            &env.store,
            env.owner_id,
            plan.id,
            status,
            base + chrono::Duration::hours(1 + offset as i64),
        );
        let state = env.state.orchestration.snapshot(env.node_id).unwrap();
        let interface = state
            .interfaces
            .iter()
            .find(|interface| interface.id == interface_id)
            .unwrap();
        let peer = interface
            .peers
            .iter()
            .find(|peer| peer.device_id.to_string() == device_id)
            .unwrap();
        assert_eq!(peer.down_kbps, 1, "{status:?}");
        assert_eq!(peer.up_kbps, 1, "{status:?}");
        let limit = interface
            .user_limits
            .iter()
            .find(|limit| limit.user_id == env.owner_id)
            .unwrap();
        assert_eq!(
            (limit.group_down_kbps, limit.group_up_kbps),
            (1, 1),
            "{status:?}"
        );
    }
}

#[tokio::test]
async fn create_device_picks_first_enabled_interface_of_node() {
    let env = app_env();
    let body = create_device(router(&env), &env.owner_token, "Phone").await;

    let disabled = env.interface_ids[2];
    let device = &body["device"];
    assert_eq!(device["name"], "Phone");
    assert_eq!(device["interface_name"], "awg-a");
    assert_ne!(device["interface_id"], disabled.to_string());
    assert_eq!(device["down_kbps"], 100_000);
    assert_eq!(device["up_kbps"], 50_000);

    let config = &body["config"];
    assert_eq!(config["interface_id"], device["interface_id"]);
    assert_eq!(config["interface_name"], "awg-a");
    assert_eq!(config["node_id"], env.node_id.to_string());
    assert_eq!(config["endpoint"], "vpn.example.com:51820");
    assert!(
        config["conf"]
            .as_str()
            .unwrap()
            .contains("Endpoint = vpn.example.com:51820")
    );
    assert!(!config["addresses"].as_array().unwrap().is_empty());
    assert_revision(&config["revision"]);
}

#[tokio::test]
async fn create_device_rejects_empty_name() {
    let env = app_env();
    let app = router(&env);

    let (status, body) = call(
        app.clone(),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(json!({ "name": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let (status, body) = call(
        app,
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn create_device_enforces_tariff_device_limit() {
    let env = app_env();
    create_device(router(&env), &env.owner_token, "first").await;
    create_device(router(&env), &env.owner_token, "second").await;

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(json!({ "name": "third" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("at most 2 devices")
    );
}

#[tokio::test]
async fn foreign_device_is_not_accessible() {
    let env = app_env();
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let config_uri = format!("/api/v1/app/devices/{device_id}/config");
    let device_uri = format!("/api/v1/app/devices/{device_id}");

    let (status, _) = call(router(&env), "GET", &config_uri, &env.other_token, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(
        router(&env),
        "PATCH",
        &device_uri,
        &env.other_token,
        Some(json!({ "name": "stolen" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(router(&env), "DELETE", &device_uri, &env.other_token, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(router(&env), "GET", &config_uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn config_revision_is_stable_and_follows_conf_changes() {
    let env = app_env();
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let interface_id = created["config"]["interface_id"]
        .as_str()
        .unwrap()
        .to_string();
    let uri = format!("/api/v1/app/devices/{device_id}/config");

    let (status, first) = call(router(&env), "GET", &uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (status, second) = call(router(&env), "GET", &uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(first["conf"], second["conf"]);
    assert_eq!(first["revision"], second["revision"]);
    assert_revision(&first["revision"]);

    env.state
        .network
        .update_interface(
            uuid::Uuid::parse_str(&interface_id).unwrap(),
            InterfaceChanges {
                endpoint_port: Some(51999),
                ..Default::default()
            },
        )
        .unwrap();

    let (status, changed) = call(router(&env), "GET", &uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_ne!(first["conf"], changed["conf"]);
    assert_ne!(first["revision"], changed["revision"]);
    assert_eq!(changed["endpoint"], "vpn.example.com:51999");
}

#[tokio::test]
async fn patch_updates_device_name() {
    let env = app_env();
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let uri = format!("/api/v1/app/devices/{device_id}");

    let (status, body) = call(
        router(&env),
        "PATCH",
        &uri,
        &env.owner_token,
        Some(json!({ "name": "  Renamed  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["name"], "Renamed");
    assert_eq!(body["id"], device_id);

    let (status, _) = call(
        router(&env),
        "PATCH",
        &uri,
        &env.owner_token,
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let long = "x".repeat(65);
    let (status, _) = call(
        router(&env),
        "PATCH",
        &uri,
        &env.owner_token,
        Some(json!({ "name": long })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn delete_removes_device_and_config_returns_not_found() {
    let env = app_env();
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let device_uri = format!("/api/v1/app/devices/{device_id}");
    let config_uri = format!("/api/v1/app/devices/{device_id}/config");

    let (status, body) = call(router(&env), "DELETE", &device_uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    let (status, body) = call(router(&env), "GET", &config_uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

async fn create_multi_device(app: Router, token: &str, name: &str, ids: &[uuid::Uuid]) -> Value {
    let (status, body) = call(
        app,
        "POST",
        "/api/v1/app/devices",
        token,
        Some(json!({ "name": name, "interface_ids": ids })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
async fn create_device_with_multiple_interfaces_returns_every_config() {
    let env = app_env();
    let first = env.interface_ids[0];
    let second = env.interface_ids[1];
    let body =
        create_multi_device(router(&env), &env.owner_token, "Laptop", &[first, second]).await;

    let device = &body["device"];
    assert_eq!(device["interface_id"], first.to_string());
    assert_eq!(device["peers"].as_array().unwrap().len(), 2);

    let configs = body["configs"].as_array().unwrap();
    assert_eq!(configs.len(), 2);
    assert_eq!(configs[0]["interface_id"], second.to_string());
    assert_eq!(configs[0]["interface_name"], "awg-a");
    assert_eq!(configs[1]["interface_id"], first.to_string());
    assert_eq!(configs[1]["interface_name"], "awg-b");
    assert_ne!(configs[0]["conf"], configs[1]["conf"]);
    assert_ne!(configs[0]["revision"], configs[1]["revision"]);
    for config in configs {
        assert_revision(&config["revision"]);
        assert!(config["conf"].as_str().unwrap().contains("[Interface]"));
    }

    assert_eq!(body["config"]["interface_id"], first.to_string());
    assert_eq!(body["config"]["interface_name"], "awg-b");
    assert_eq!(body["config"], configs[1]);
}

#[tokio::test]
async fn device_configs_route_returns_all_interfaces() {
    let env = app_env();
    let first = env.interface_ids[0];
    let third = env.interface_ids[3];
    let created =
        create_multi_device(router(&env), &env.owner_token, "Laptop", &[first, third]).await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let uri = format!("/api/v1/app/devices/{device_id}/configs");

    let (status, body) = call(router(&env), "GET", &uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let configs = body.as_array().unwrap();
    assert_eq!(configs.len(), 2);
    assert_eq!(configs[0]["interface_name"], "awg-b");
    assert_eq!(configs[0]["interface_id"], first.to_string());
    assert_eq!(configs[1]["interface_name"], "awg-c");
    assert_eq!(configs[1]["interface_id"], third.to_string());

    let primary_uri = format!("/api/v1/app/devices/{device_id}/config");
    let (status, primary) = call(router(&env), "GET", &primary_uri, &env.owner_token, None).await;
    assert_eq!(status, StatusCode::OK, "{primary}");
    assert_eq!(primary["interface_id"], first.to_string());

    let (status, _) = call(router(&env), "GET", &uri, &env.other_token, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn duplicate_interface_ids_do_not_create_duplicate_peers() {
    let env = app_env();
    let first = env.interface_ids[0];
    let second = env.interface_ids[1];
    let body = create_multi_device(
        router(&env),
        &env.owner_token,
        "Laptop",
        &[first, second, first],
    )
    .await;

    assert_eq!(body["device"]["peers"].as_array().unwrap().len(), 2);
    assert_eq!(body["configs"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn create_device_rejects_foreign_or_disabled_interfaces() {
    let env = app_env();
    let disabled = env.interface_ids[2];

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(json!({ "name": "Phone", "interface_ids": [disabled] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    let other_group = env
        .state
        .network
        .create_group("foreign", "", "10.40.0.0/16", false)
        .unwrap();
    let (other_node, _) = env.state.network.create_node("node-foreign").unwrap();
    let foreign = env
        .state
        .network
        .add_interface(
            other_group.id,
            other_node.id,
            awg_network::NewInterface {
                name: "awg-x".into(),
                label: "awg-x".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &awg_shared::obf::ObfuscationSettings::default(),
        )
        .unwrap();

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(json!({ "name": "Phone", "interface_ids": [foreign.id] })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(
        env.state
            .devices
            .list_for_user(env.owner_id)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn tariff_interface_ignores_requested_interfaces_in_the_app() {
    let env = app_env();
    let pinned = env.interface_ids[3];
    env.state
        .tariffs
        .update(
            env.tariff_id,
            awg_tariffs::TariffChanges {
                interface_id: Some(Some(pinned)),
                ..Default::default()
            },
        )
        .unwrap();

    let body = create_multi_device(
        router(&env),
        &env.owner_token,
        "Phone",
        &[env.interface_ids[0]],
    )
    .await;

    assert_eq!(body["device"]["interface_id"], pinned.to_string());
    let configs = body["configs"].as_array().unwrap();
    assert_eq!(configs.len(), 1);
    assert_eq!(configs[0]["interface_id"], pinned.to_string());
    assert_eq!(configs[0]["interface_name"], "awg-c");
}

#[tokio::test]
async fn bootstrap_lists_available_interfaces_for_the_node() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let interfaces = body["interfaces"].as_array().unwrap();
    let names: Vec<&str> = interfaces
        .iter()
        .map(|interface| interface["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["awg-a", "awg-b", "awg-c"]);
    for interface in interfaces {
        assert_eq!(interface["node_id"], env.node_id.to_string());
        assert_eq!(interface["node_name"], "node-mobile");
        assert!(interface["id"].is_string());
    }
}

#[tokio::test]
async fn bootstrap_interfaces_follow_tariff_pin_and_group_fallback() {
    let env = app_env();
    let pinned = env.interface_ids[0];
    env.state
        .tariffs
        .update(
            env.tariff_id,
            awg_tariffs::TariffChanges {
                interface_id: Some(Some(pinned)),
                ..Default::default()
            },
        )
        .unwrap();

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let interfaces = body["interfaces"].as_array().unwrap();
    assert_eq!(interfaces.len(), 1);
    assert_eq!(interfaces[0]["id"], pinned.to_string());
    assert_eq!(interfaces[0]["name"], "awg-b");

    env.state
        .tariffs
        .update(
            env.tariff_id,
            awg_tariffs::TariffChanges {
                interface_id: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
    env.state
        .identity
        .update(
            env.owner_id,
            awg_identity::UserChanges {
                full_name: None,
                email: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: Some(None),
                disabled: None,
            },
        )
        .unwrap();

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/bootstrap",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let names: Vec<&str> = body["interfaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|interface| interface["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["awg-a", "awg-b", "awg-c"]);
}

async fn admin_token(env: &AppEnv) -> String {
    env.state
        .identity
        .update(
            env.owner_id,
            awg_identity::UserChanges {
                full_name: None,
                email: None,
                role: Some(awg_identity::Role::Admin),
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: None,
            },
        )
        .unwrap();
    env.state
        .identity
        .login(
            OWNER_EMAIL,
            PASSWORD,
            &awg_identity::SessionMetadata {
                user_agent: None,
                ip: None,
            },
        )
        .unwrap()
        .access_token
}

#[tokio::test]
async fn admin_create_device_with_multiple_interfaces_exposes_peers_and_profiles() {
    let env = app_env();
    let token = admin_token(&env).await;
    let first = env.interface_ids[0];
    let second = env.interface_ids[1];

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        &token,
        Some(json!({
            "user_id": env.owner_id,
            "name": "Laptop",
            "interface_ids": [first, second, first],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["interface_id"], first.to_string());
    let peers = body["peers"].as_array().unwrap();
    assert_eq!(peers.len(), 2);
    let mut peer_interfaces: Vec<&str> = peers
        .iter()
        .map(|peer| peer["interface_id"].as_str().unwrap())
        .collect();
    peer_interfaces.sort();
    let mut expected = [first.to_string(), second.to_string()];
    expected.sort();
    assert_eq!(
        peer_interfaces,
        expected.iter().map(String::as_str).collect::<Vec<_>>()
    );

    let device_id = body["id"].as_str().unwrap();
    let (status, profiles) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/{device_id}/profiles"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{profiles}");
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0]["interface_name"], "awg-a");
    assert_eq!(profiles[1]["interface_name"], "awg-b");
    assert_ne!(profiles[0]["conf"], profiles[1]["conf"]);
}

#[tokio::test]
async fn admin_create_device_still_accepts_a_single_interface() {
    let env = app_env();
    let token = admin_token(&env).await;
    let first = env.interface_ids[0];

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        &token,
        Some(json!({
            "user_id": env.owner_id,
            "name": "Phone",
            "interface_id": first,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["interface_id"], first.to_string());
    assert_eq!(body["peers"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn repeated_idempotency_key_returns_the_first_device() {
    let env = app_env();
    let key = "create-phone-0001";

    let (status, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");

    let (status, second) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second, first);
    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        1
    );

    let (status, third) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "Another phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{third}");
    assert_eq!(third, first, "replay ignores a different body");
    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        1
    );
}

#[tokio::test]
async fn different_idempotency_keys_create_different_devices() {
    let env = app_env();

    let (status, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some("create-phone-0001"),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");

    let (status, second) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some("create-tablet-0002"),
        Some(json!({ "name": "Tablet" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_ne!(first["device"]["id"], second["device"]["id"]);
    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        2
    );
}

#[tokio::test]
async fn malformed_idempotency_keys_are_rejected() {
    let env = app_env();

    for key in [
        "short",
        "",
        "bad key with spaces",
        "semi;colon-key",
        "ключ-кириллица",
    ] {
        let (status, body) = call_with_key(
            router(&env),
            "POST",
            "/api/v1/app/devices",
            &env.owner_token,
            Some(key),
            Some(json!({ "name": "Phone" })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{key}: {body}");
        assert_eq!(body["error"]["code"], "invalid_idempotency_key", "{key}");
    }
    assert!(
        env.state
            .devices
            .list_for_user(env.owner_id)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn create_device_without_idempotency_key_is_not_deduplicated() {
    let env = app_env();
    create_device(router(&env), &env.owner_token, "Phone").await;
    create_device(router(&env), &env.owner_token, "Phone").await;

    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        2
    );
}

#[tokio::test]
async fn failed_request_does_not_cache_the_idempotency_key() {
    let env = app_env();
    let key = "validation-retry-0001";

    let (status, body) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        env.state
            .idempotency
            .get(&awg_admin::idempotency::user_key(env.owner_id, key))
            .unwrap()
            .is_none()
    );

    let (status, body) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        1
    );
}

#[tokio::test]
async fn idempotency_record_survives_a_router_restart() {
    let env = app_env();
    let key = "restart-phone-0001";

    let (status, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert!(
        env.state
            .idempotency
            .get(&awg_admin::idempotency::user_key(env.owner_id, key))
            .unwrap()
            .is_some(),
        "the response must be persisted in the store"
    );

    let (status, replay) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        &env.owner_token,
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay, first);
    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        1
    );
}

#[tokio::test]
async fn admin_tunnels_support_add_list_rename_and_delete() {
    let env = app_env();
    let token = admin_token(&env).await;
    let interface_id = env.interface_ids[0];

    let (status, created) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        &token,
        Some(json!({
            "user_id": env.owner_id,
            "name": "Phone",
            "interface_ids": [interface_id],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let device_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["peers"].as_array().unwrap().len(), 1);
    assert!(created["peers"][0]["peer_id"].is_string());
    assert!(created["peers"][0]["label"].is_string());

    let (status, added) = call(
        router(&env),
        "POST",
        &format!("/api/v1/devices/{device_id}/tunnels"),
        &token,
        Some(json!({ "interface_id": interface_id, "label": "extra" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{added}");
    let peers = added["peers"].as_array().unwrap();
    assert_eq!(peers.len(), 2);
    let extra = peers
        .iter()
        .find(|peer| peer["label"] == "extra")
        .expect("extra tunnel is exposed");
    let peer_id = extra["peer_id"].as_str().unwrap().to_string();
    assert_eq!(extra["interface_id"], interface_id.to_string());

    let (status, profiles) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/{device_id}/profiles"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{profiles}");
    let profiles = profiles.as_array().unwrap();
    assert_eq!(profiles.len(), 2);
    assert!(
        profiles
            .iter()
            .all(|profile| profile["peer_id"].is_string())
    );
    assert!(profiles.iter().any(|profile| profile["label"] == "extra"));

    let (status, profile) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/{device_id}/profiles/by-peer/{peer_id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{profile}");
    assert_eq!(profile["peer_id"], peer_id);
    assert_eq!(profile["label"], "extra");

    let (status, renamed) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{device_id}/tunnels/{peer_id}"),
        &token,
        Some(json!({ "label": "renamed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert!(
        renamed["peers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|peer| peer["peer_id"] == peer_id && peer["label"] == "renamed")
    );

    let (status, _) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/devices/{device_id}/tunnels/{peer_id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/{device_id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["peers"].as_array().unwrap().len(), 1);
    let last_peer = body["peers"][0]["peer_id"].as_str().unwrap().to_string();

    let (status, body) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/devices/{device_id}/tunnels/{last_peer}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn app_tunnels_are_scoped_to_the_owner() {
    let env = app_env();
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let primary_interface = created["device"]["interface_id"]
        .as_str()
        .unwrap()
        .to_string();
    let other_interface = env
        .interface_ids
        .iter()
        .map(uuid::Uuid::to_string)
        .find(|id| id != &primary_interface)
        .unwrap();

    let (status, added) = call(
        router(&env),
        "POST",
        &format!("/api/v1/app/devices/{device_id}/tunnels"),
        &env.owner_token,
        Some(json!({ "interface_id": other_interface, "label": "second" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{added}");
    let configs = added["configs"].as_array().unwrap();
    assert_eq!(configs.len(), 2);
    assert!(configs.iter().all(|config| config["peer_id"].is_string()));
    let second = configs
        .iter()
        .find(|config| config["label"] == "second")
        .expect("added tunnel has a config");
    let peer_id = second["peer_id"].as_str().unwrap().to_string();

    let (status, fetched) = call(
        router(&env),
        "GET",
        &format!("/api/v1/app/devices/{device_id}/configs"),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{fetched}");
    assert_eq!(fetched.as_array().unwrap().len(), 2);
    assert!(
        fetched
            .as_array()
            .unwrap()
            .iter()
            .all(|config| { config["peer_id"].is_string() && config["label"].is_string() })
    );

    let (status, primary) = call(
        router(&env),
        "GET",
        &format!("/api/v1/app/devices/{device_id}/config"),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{primary}");
    assert!(primary["peer_id"].is_string());

    let (status, body) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/app/devices/{device_id}/tunnels/{peer_id}"),
        &env.other_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, _) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/app/devices/{device_id}/tunnels/{peer_id}"),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, fetched) = call(
        router(&env),
        "GET",
        &format!("/api/v1/app/devices/{device_id}/configs"),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{fetched}");
    assert_eq!(fetched.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn app_tunnel_rename_is_scoped_validated_and_idempotent() {
    let env = app_env();
    let created = create_device(router(&env), &env.owner_token, "Phone").await;
    let device_id = created["device"]["id"].as_str().unwrap().to_string();
    let peer_id = created["configs"][0]["peer_id"]
        .as_str()
        .unwrap()
        .to_string();

    let uri = format!("/api/v1/app/devices/{device_id}/tunnels/{peer_id}");
    let (status, renamed) = call(
        router(&env),
        "PATCH",
        &uri,
        &env.owner_token,
        Some(json!({ "label": "  Renamed  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["config"]["label"], "Renamed");
    assert!(
        renamed["configs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|config| config["peer_id"] == peer_id && config["label"] == "Renamed")
    );
    assert!(
        renamed["device"]["peers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|peer| peer["peer_id"] == peer_id && peer["label"] == "Renamed")
    );

    let (status, repeated) = call(
        router(&env),
        "PATCH",
        &uri,
        &env.owner_token,
        Some(json!({ "label": "Renamed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{repeated}");
    assert_eq!(repeated["config"]["label"], "Renamed");

    for label in [String::new(), "   ".to_string(), "a".repeat(65)] {
        let (status, body) = call(
            router(&env),
            "PATCH",
            &uri,
            &env.owner_token,
            Some(json!({ "label": label })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }

    let admin = admin_token(&env).await;
    let (status, other) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        &admin,
        Some(json!({ "user_id": env.other_id, "name": "Other", "interface_ids": [env.interface_ids[0]] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{other}");
    let other_device_id = other["id"].as_str().unwrap().to_string();
    let other_peer_id = other["peers"][0]["peer_id"].as_str().unwrap().to_string();

    let (status, body) = call(
        router(&env),
        "PATCH",
        &uri,
        &env.other_token,
        Some(json!({ "label": "hijack" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/app/devices/{device_id}/tunnels/{other_peer_id}"),
        &env.owner_token,
        Some(json!({ "label": "foreign" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/app/devices/{other_device_id}/tunnels/{other_peer_id}"),
        &env.other_token,
        Some(json!({ "label": "kept" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["config"]["label"], "kept");
}
