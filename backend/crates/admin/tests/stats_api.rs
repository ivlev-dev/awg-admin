use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, app_env};
use awg_identity::{NewUser, Role};

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
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_100))));
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
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

fn login(env: &AppEnv, email: &str, password: &str) -> String {
    env.state
        .identity
        .login(
            email,
            password,
            &awg_identity::SessionMetadata {
                user_agent: None,
                ip: None,
            },
        )
        .unwrap()
        .access_token
}

fn admin_token(env: &AppEnv) -> String {
    let email = "stats-admin@example.com";
    env.state
        .identity
        .create(NewUser {
            email: email.into(),
            full_name: None,
            password: "password123".into(),
            role: Role::Admin,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap();
    login(env, email, "password123")
}

async fn create_device(env: &AppEnv, token: &str, user_id: Option<Uuid>, name: &str) -> Uuid {
    let mut payload = json!({ "name": name, "interface_id": env.interface_ids[0] });
    if let Some(user_id) = user_id {
        payload["user_id"] = json!(user_id);
    }
    let (status, body) = call(router(env), "POST", "/api/v1/devices", token, Some(payload)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn overview_hides_global_device_count_from_users() {
    let env = app_env();
    let owner_device = create_device(&env, &env.owner_token, None, "owner-phone").await;
    let admin = admin_token(&env);
    create_device(&env, &admin, Some(env.other_id), "other-laptop").await;

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/stats/overview",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["devices"], 1);
    assert_eq!(body["top_devices"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["top_devices"][0]["device_id"],
        owner_device.to_string()
    );

    let (status, body) = call(router(&env), "GET", "/api/v1/stats/overview", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["devices"], 2);
    assert_eq!(body["top_devices"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn devices_batch_returns_only_owned_devices_for_users() {
    let env = app_env();
    let owner_device = create_device(&env, &env.owner_token, None, "owner-phone").await;
    let admin = admin_token(&env);
    let other_device = create_device(&env, &admin, Some(env.other_id), "other-laptop").await;

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/stats/devices",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["device_id"], owner_device.to_string());
    assert_eq!(items[0]["today"], json!({ "rx": 0, "tx": 0 }));
    assert_eq!(items[0]["month"], json!({ "rx": 0, "tx": 0 }));
    assert!(items[0].get("rx_bps").is_some());
    assert!(items[0].get("tx_bps").is_some());

    let (status, body) = call(router(&env), "GET", "/api/v1/stats/devices", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 2);
    let ids: Vec<&str> = items
        .iter()
        .map(|item| item["device_id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&owner_device.to_string().as_str()));
    assert!(ids.contains(&other_device.to_string().as_str()));
}
