use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use awg_admin::idempotency::user_key;
use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env};
use awg_storage::Table;

fn router(env: &AppEnv) -> Router {
    routes::router(env.state.clone(), Readiness::new(env.store.clone()))
}

async fn admin_token(env: &AppEnv) -> String {
    env.state
        .identity
        .update(
            env.owner_id,
            awg_identity::UserChanges {
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

async fn call_with_key(
    app: Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    idempotency_key: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_000))));
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
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
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, headers, json)
}

#[tokio::test]
async fn same_key_replays_the_user_creation() {
    let env = app_env();
    let token = admin_token(&env).await;
    let payload = json!({
        "email": "idempotent-user@example.com",
        "role": "user",
        "password": PASSWORD,
    });

    let (status, headers, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some("users-create-0001"),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/json")
    );

    let (status, headers, second) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some("users-create-0001"),
        Some(payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(
        headers.get("content-type").and_then(|v| v.to_str().ok()),
        Some("application/json")
    );
    assert_eq!(second, first, "the replay returns the cached payload");

    let created = env
        .state
        .identity
        .list()
        .unwrap()
        .into_iter()
        .filter(|user| user.email.as_deref() == Some("idempotent-user@example.com"))
        .count();
    assert_eq!(created, 1);
}

#[tokio::test]
async fn different_keys_create_separate_users() {
    let env = app_env();
    let token = admin_token(&env).await;

    let (status, _, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some("users-create-0101"),
        Some(json!({
            "email": "first@example.com",
            "role": "user",
            "password": PASSWORD,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");

    let (status, _, second) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some("users-create-0102"),
        Some(json!({
            "email": "second@example.com",
            "role": "user",
            "password": PASSWORD,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_ne!(second["id"], first["id"]);

    let created = env
        .state
        .identity
        .list()
        .unwrap()
        .into_iter()
        .filter(|user| {
            matches!(
                user.email.as_deref(),
                Some("first@example.com") | Some("second@example.com")
            )
        })
        .count();
    assert_eq!(created, 2);
}

#[tokio::test]
async fn failed_request_is_not_cached() {
    let env = app_env();
    let token = admin_token(&env).await;
    let key = "users-failed-0001";

    let (status, _, body) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some(key),
        Some(json!({
            "email": OWNER_EMAIL,
            "role": "user",
            "password": PASSWORD,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    let (status, _, body) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some(key),
        Some(json!({
            "email": "after-failure@example.com",
            "role": "user",
            "password": PASSWORD,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["email"], "after-failure@example.com");
}

#[tokio::test]
async fn groups_are_deduplicated_by_key() {
    let env = app_env();
    let token = admin_token(&env).await;
    let payload = json!({
        "name": "idempotent-group",
        "description": "created once",
        "base_cidr": "10.77.0.1/24",
    });

    let (status, _, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/groups",
        Some(&token),
        Some("groups-create-0001"),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");

    let (status, _, second) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/groups",
        Some(&token),
        Some("groups-create-0001"),
        Some(payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second, first);

    let groups = env
        .state
        .network
        .list_groups()
        .unwrap()
        .into_iter()
        .filter(|group| group.name == "idempotent-group")
        .count();
    assert_eq!(groups, 1);
}

#[tokio::test]
async fn invalid_key_is_rejected() {
    let env = app_env();
    let token = admin_token(&env).await;

    let (status, _, body) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some("short"),
        Some(json!({
            "email": "rejected@example.com",
            "role": "user",
            "password": PASSWORD,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"]["code"], "invalid_idempotency_key");

    let created = env
        .state
        .identity
        .list()
        .unwrap()
        .into_iter()
        .any(|user| user.email.as_deref() == Some("rejected@example.com"));
    assert!(!created);
}

#[tokio::test]
async fn login_is_not_cached() {
    let env = app_env();

    for _ in 0..2 {
        let (status, _, body) = call_with_key(
            router(&env),
            "POST",
            "/api/v1/auth/login",
            None,
            Some("login-attempt-0001"),
            Some(json!({
                "login": OWNER_EMAIL,
                "password": PASSWORD,
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert!(
            body["token"]
                .as_str()
                .is_some_and(|token| !token.is_empty())
        );
    }

    assert_eq!(env.store.count(Table::Idempotency).unwrap(), 0);
}

#[tokio::test]
async fn get_requests_ignore_the_key() {
    let env = app_env();
    let token = admin_token(&env).await;

    let (status, _, body) = call_with_key(
        router(&env),
        "GET",
        "/api/v1/users",
        Some(&token),
        Some("get-ignored-0001"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(env.store.count(Table::Idempotency).unwrap(), 0);
}

#[tokio::test]
async fn app_devices_keeps_its_own_idempotency_handling() {
    let env = app_env();
    let key = "device-create-0001";

    let (status, _, first) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        Some(&env.owner_token),
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");

    let (status, _, second) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        Some(&env.owner_token),
        Some(key),
        Some(json!({ "name": "Tablet" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second, first);
    assert_eq!(
        env.state.devices.list_for_user(env.owner_id).unwrap().len(),
        1
    );
    assert_eq!(env.store.count(Table::Idempotency).unwrap(), 1);
}

#[tokio::test]
async fn cached_response_bodies_are_encrypted_at_rest() {
    let env = app_env();
    let key = "device-sealed-0001";

    let (status, _, body) = call_with_key(
        router(&env),
        "POST",
        "/api/v1/app/devices",
        Some(&env.owner_token),
        Some(key),
        Some(json!({ "name": "Phone" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let conf = body["config"]["conf"].as_str().unwrap();
    let private_key = conf
        .lines()
        .find_map(|line| line.strip_prefix("PrivateKey = "))
        .expect("device config contains a private key");

    let storage_key = user_key(env.owner_id, key);
    let raw = env
        .store
        .get_raw(Table::Idempotency, &storage_key)
        .unwrap()
        .unwrap();
    let text = String::from_utf8(raw).unwrap();
    assert!(!text.contains(private_key), "private key leaked: {text}");
    assert!(!text.contains("PrivateKey"), "config leaked: {text}");
    assert!(!text.contains("Phone"), "body leaked: {text}");

    let cached = env
        .state
        .idempotency
        .get(&storage_key)
        .unwrap()
        .expect("the sealed record is readable");
    assert_eq!(cached.status, 200);
    assert_eq!(cached.body, body);
    assert_eq!(cached.content_type.as_deref(), Some("application/json"));
}
