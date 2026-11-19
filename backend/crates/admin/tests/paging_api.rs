use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use chrono::{Duration, TimeZone, Utc};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OTHER_EMAIL, OWNER_EMAIL, PASSWORD, app_env};
use awg_clients::domain::DeviceRepository;
use awg_clients::{Device, Forwarding, RedbDeviceRepository};
use awg_identity::{Role, SessionMetadata, UserChanges};

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
    let (status, bytes) = call_bytes(app, method, uri, token, body).await;
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, value)
}

async fn call_bytes(
    app: Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Vec<u8>) {
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
    let bytes = to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
}

async fn admin_token(env: &AppEnv) -> String {
    env.state
        .identity
        .update(
            env.owner_id,
            UserChanges {
                email: None,
                role: Some(Role::Admin),
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
            &SessionMetadata {
                user_agent: None,
                ip: None,
            },
        )
        .unwrap()
        .access_token
}

fn device(
    user_id: Uuid,
    group_id: Uuid,
    interface_id: Uuid,
    name: &str,
    offset: i64,
    revoked: bool,
) -> Device {
    let created = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap() + Duration::seconds(offset);
    Device {
        id: Uuid::new_v4(),
        user_id,
        group_id,
        interface_id,
        name: name.into(),
        down_kbps: 0,
        up_kbps: 0,
        forwarding: Forwarding::default(),
        revoked,
        external: false,
        created_at: created,
        updated_at: created,
    }
}

fn seed(env: &AppEnv, items: &[Device]) {
    let repo = RedbDeviceRepository::new(env.store.clone());
    for item in items {
        repo.save(item).unwrap();
    }
}

fn names(body: &Value) -> Vec<&str> {
    body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["name"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn devices_page_paginates_own_devices_only() {
    let env = app_env();
    let interface = env.interface_ids[0];
    let items = [
        device(env.owner_id, env.group_id, interface, "beta", 1, false),
        device(env.owner_id, env.group_id, interface, "Alpha", 2, false),
        device(env.owner_id, env.group_id, interface, "gamma", 3, true),
        device(env.owner_id, env.group_id, interface, "delta", 4, false),
        device(env.other_id, env.group_id, interface, "foreign", 5, false),
    ];
    seed(&env, &items);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?limit=2&offset=0",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 4);
    assert_eq!(body["limit"], 2);
    assert_eq!(body["offset"], 0);
    assert_eq!(names(&body), vec!["Alpha", "beta"]);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?limit=2&offset=2",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 4);
    assert_eq!(names(&body), vec!["delta", "gamma"]);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?offset=100",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 4);
    assert_eq!(body["items"], json!([]));
}

#[tokio::test]
async fn devices_page_filters_and_searches() {
    let env = app_env();
    let first = env.interface_ids[0];
    let second = env.interface_ids[1];
    let items = [
        device(env.owner_id, env.group_id, first, "Phone", 1, false),
        device(env.owner_id, env.group_id, second, "Laptop", 2, true),
        device(env.other_id, env.group_id, first, "Tablet", 3, false),
    ];
    seed(&env, &items);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?status=revoked",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(names(&body), vec!["Laptop"]);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?status=active",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(names(&body), vec!["Phone"]);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?q=pho",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(names(&body), vec!["Phone"]);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?q=owner%40example.com",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 2, "owner email matches all own devices");

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/page?interface_id={}", second),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(names(&body), vec!["Laptop"]);
}

#[tokio::test]
async fn devices_page_rejects_invalid_parameters_and_foreign_user() {
    let env = app_env();
    for uri in [
        "/api/v1/devices/page?limit=0",
        "/api/v1/devices/page?limit=201",
        "/api/v1/devices/page?status=unknown",
        "/api/v1/devices/page?sort=unknown",
        "/api/v1/devices/page?order=unknown",
    ] {
        let (status, _) = call(router(&env), "GET", uri, &env.owner_token, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
    }

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/page?user_id={}", env.other_id),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, _) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/page?user_id={}", env.owner_id),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn admin_devices_page_sees_every_user_and_can_scope_by_user() {
    let env = app_env();
    let token = admin_token(&env).await;
    let interface = env.interface_ids[0];
    seed(
        &env,
        &[
            device(env.owner_id, env.group_id, interface, "own", 1, false),
            device(env.other_id, env.group_id, interface, "other", 2, false),
        ],
    );

    let (status, body) = call(router(&env), "GET", "/api/v1/devices/page", &token, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 2);

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/devices/page?user_id={}", env.other_id),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(names(&body), vec!["other"]);
}

#[tokio::test]
async fn device_mutations_keep_the_page_index_consistent() {
    let env = app_env();
    let token = admin_token(&env).await;
    let (status, created) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        &token,
        Some(json!({
            "user_id": env.owner_id,
            "name": "Unique-Name",
            "interface_id": env.interface_ids[0],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let id = created["id"].as_str().unwrap().to_string();

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?q=unique",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);

    let (status, updated) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{id}"),
        &token,
        Some(json!({ "name": "Renamed-Device" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?q=unique",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 0, "old name must leave the index");

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?q=renamed",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);

    let (status, revoked) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{id}"),
        &token,
        Some(json!({ "revoked": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?status=active",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 0);
    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?status=revoked",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);

    let (status, _) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/devices/{id}"),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/devices/page?q=renamed",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 0);
}

#[tokio::test]
async fn devices_page_over_250_devices_is_small_and_complete() {
    let env = app_env();
    let interface = env.interface_ids[0];
    let items: Vec<Device> = (0..250)
        .map(|index| {
            device(
                env.owner_id,
                env.group_id,
                interface,
                &format!("client-{index:03}"),
                index,
                index % 10 == 0,
            )
        })
        .collect();
    seed(&env, &items);
    let token = admin_token(&env).await;

    let mut seen = std::collections::HashSet::new();
    for page_index in 0..5 {
        let uri = format!("/api/v1/devices/page?limit=50&offset={}", page_index * 50);
        let (status, bytes) = call_bytes(router(&env), "GET", &uri, &token, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            bytes.len() < 128 * 1024,
            "page body is {} bytes",
            bytes.len()
        );
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["total"], 250);
        assert_eq!(body["items"].as_array().unwrap().len(), 50);
        for item in body["items"].as_array().unwrap() {
            assert!(seen.insert(item["id"].as_str().unwrap().to_string()));
        }
    }
    assert_eq!(seen.len(), 250);
}

#[tokio::test]
async fn mobile_devices_page_is_self_scoped_and_ignores_user_id() {
    let env = app_env();
    let interface = env.interface_ids[0];
    seed(
        &env,
        &[
            device(env.owner_id, env.group_id, interface, "one", 1, false),
            device(env.owner_id, env.group_id, interface, "two", 2, true),
            device(env.owner_id, env.group_id, interface, "three", 3, false),
            device(env.other_id, env.group_id, interface, "foreign", 4, false),
        ],
    );

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/app/devices/page?user_id={}", env.other_id),
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 3);
    assert_eq!(body["limit"], 20);
    assert_eq!(names(&body), vec!["one", "three", "two"]);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/app/devices/page?status=active&q=t",
        &env.owner_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(names(&body), vec!["three"]);
}

#[tokio::test]
async fn bootstrap_reports_devices_total() {
    let env = app_env();
    let interface = env.interface_ids[0];
    seed(
        &env,
        &[
            device(env.owner_id, env.group_id, interface, "one", 1, false),
            device(env.owner_id, env.group_id, interface, "two", 2, false),
            device(env.other_id, env.group_id, interface, "foreign", 3, false),
        ],
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
    assert_eq!(body["devices_total"], 2);
    assert_eq!(body["devices"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn users_page_filters_and_paginates() {
    let env = app_env();
    let token = admin_token(&env).await;
    for index in 0..3 {
        let created = env
            .state
            .identity
            .create(awg_identity::NewUser {
                email: format!("paged-{index}@example.com"),
                password: PASSWORD.into(),
                role: Role::User,
                tariff_id: None,
                group_id: None,
                node_id: None,
            })
            .unwrap();
        if index == 0 {
            env.state
                .identity
                .update(
                    created.id,
                    UserChanges {
                        email: None,
                        role: None,
                        tariff_id: None,
                        group_id: None,
                        node_id: None,
                        disabled: Some(true),
                    },
                )
                .unwrap();
        }
    }

    let (status, body) = call(router(&env), "GET", "/api/v1/users/page", &token, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 5);
    assert_eq!(body["limit"], 50);
    assert_eq!(body["items"].as_array().unwrap().len(), 5);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?limit=2&offset=1",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 5);
    assert_eq!(body["items"].as_array().unwrap().len(), 2);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?status=disabled",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(body["items"][0]["email"], "paged-0@example.com");

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?role=admin",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(body["items"][0]["email"], OWNER_EMAIL);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?q=other%40example.com",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    assert_eq!(body["items"][0]["email"], OTHER_EMAIL);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?tab=pending",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 0);

    let (status, _) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?role=owner",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(
        router(&env),
        "GET",
        "/api/v1/users/page",
        &env.other_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
