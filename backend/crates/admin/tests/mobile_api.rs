use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OTHER_EMAIL, OWNER_EMAIL, app_env};
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
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_000))));
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
