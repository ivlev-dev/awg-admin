use std::collections::HashMap;
use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, app_env, app_env_with_mock_billing};
use awg_identity::{NewUser, Role};
use awg_shared::CoreResult;
use awg_statistics::{CounterSample, DeviceDirectory};

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
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
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
    let email = "audit-fixes-admin@example.com";
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

async fn create_admin_device(env: &AppEnv, token: &str, user_id: Uuid, name: &str) -> Uuid {
    let (status, body) = call(
        router(env),
        "POST",
        "/api/v1/devices",
        token,
        Some(json!({ "user_id": user_id, "name": name, "interface_id": env.interface_ids[0] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_owner_device(env: &AppEnv, name: &str) -> Uuid {
    let (status, body) = call(
        router(env),
        "POST",
        "/api/v1/devices",
        &env.owner_token,
        Some(json!({ "name": name, "interface_id": env.interface_ids[0] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

struct TestDirectory {
    owners: HashMap<Uuid, (Uuid, Uuid)>,
}

impl DeviceDirectory for TestDirectory {
    fn group_and_user(&self, device_id: Uuid) -> CoreResult<Option<(Uuid, Uuid)>> {
        Ok(self.owners.get(&device_id).copied())
    }
}

fn timestamp(offset_secs: i64) -> i64 {
    chrono::Utc::now().timestamp() + offset_secs
}

#[tokio::test]
async fn series_rejects_inverted_and_oversized_windows() {
    let env = app_env();
    let base = "/api/v1/stats/series";

    let (status, body) = call(
        router(&env),
        "GET",
        &format!(
            "{base}?scope=user&id={}&from={}&to={}",
            env.owner_id,
            timestamp(0),
            timestamp(-3600)
        ),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let (status, body) = call(
        router(&env),
        "GET",
        &format!(
            "{base}?scope=user&id={}&from={}&to={}",
            env.owner_id,
            timestamp(-400 * 86_400),
            timestamp(0)
        ),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let (status, body) = call(
        router(&env),
        "GET",
        &format!(
            "{base}?scope=user&id={}&from={}&to={}",
            env.owner_id,
            timestamp(-86_400),
            timestamp(0)
        ),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.as_array().is_some());
}

#[tokio::test]
async fn overview_never_counts_another_users_traffic() {
    let env = app_env();
    let owner_device = create_owner_device(&env, "owner-phone").await;
    let admin = admin_token(&env);
    let other_device = create_admin_device(&env, &admin, env.other_id, "other-laptop").await;

    let directory = TestDirectory {
        owners: HashMap::from([
            (owner_device, (env.group_id, env.owner_id)),
            (other_device, (env.group_id, env.other_id)),
        ]),
    };
    let now = chrono::Utc::now();
    let owner_peer = Uuid::new_v4();
    env.state
        .stats
        .record_snapshot_at(
            env.node_id,
            env.interface_ids[0],
            &[(
                other_device,
                CounterSample {
                    peer_id: Uuid::new_v4(),
                    rx_total: 900,
                    tx_total: 900,
                },
            )],
            &directory,
            now - chrono::Duration::seconds(20),
        )
        .unwrap();
    env.state
        .stats
        .record_snapshot_at(
            env.node_id,
            env.interface_ids[0],
            &[(
                owner_device,
                CounterSample {
                    peer_id: owner_peer,
                    rx_total: 100,
                    tx_total: 40,
                },
            )],
            &directory,
            now - chrono::Duration::seconds(10),
        )
        .unwrap();
    env.state
        .stats
        .record_snapshot_at(
            env.node_id,
            env.interface_ids[0],
            &[(
                owner_device,
                CounterSample {
                    peer_id: owner_peer,
                    rx_total: 150,
                    tx_total: 60,
                },
            )],
            &directory,
            now,
        )
        .unwrap();

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/stats/overview",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // 150 rx / 60 tx from the two owner snapshots, none of the other 900/900.
    assert_eq!(body["today"], json!({ "rx": 150, "tx": 60 }));
    assert_eq!(body["month"], json!({ "rx": 150, "tx": 60 }));
    let top = body["top_devices"].as_array().unwrap();
    assert_eq!(top.len(), 1);
    assert_eq!(top[0]["device_id"], owner_device.to_string());
    assert_eq!(top[0]["rx"], 150);
    assert_eq!(top[0]["online"], true);

    let (status, body) = call(router(&env), "GET", "/api/v1/stats/overview", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["today"]["rx"], 1_050);
    assert_eq!(body["top_devices"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn regular_user_sees_only_their_own_quota() {
    let env = app_env();

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/quota/users",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1, "{body}");
    assert_eq!(items[0]["user_id"], env.owner_id.to_string());

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/quota/users",
        &env.other_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1, "{body}");
    assert_eq!(items[0]["user_id"], env.other_id.to_string());
}

#[tokio::test]
async fn webhook_body_is_capped_at_64_kib() {
    let env = app_env_with_mock_billing();
    let payload = vec![b'a'; 70 * 1024];
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/billing/webhook/mock")
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_200))))
        .header("content-type", "application/json")
        .body(Body::from(payload))
        .unwrap();
    let response = router(&env).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn webhook_flood_is_rate_limited() {
    let env = app_env_with_mock_billing();
    let app = router(&env);

    let mut limited = false;
    for _ in 0..200 {
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/billing/webhook/mock")
            .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_300))))
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap();
        let status = app.clone().oneshot(request).await.unwrap().status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            limited = true;
            break;
        }
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    assert!(limited, "the webhook endpoint never rate limited the flood");
}
