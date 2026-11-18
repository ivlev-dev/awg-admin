use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{
    AppEnv, MOCK_PAYMENT_SECRET, OWNER_EMAIL, PASSWORD, app_env, app_env_production,
    app_env_with_dev_mail_token, app_env_with_mock_billing,
};
use awg_identity::{Role, UserChanges, UserStatus};
use awg_network::NewInterface;
use awg_shared::obf::ObfuscationSettings;
use awg_storage::Table;

fn router(env: &AppEnv) -> Router {
    routes::router(env.state.clone(), Readiness::new(env.store.clone()))
}

async fn call(
    app: Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_000))));
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
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
    login(env, OWNER_EMAIL, PASSWORD)
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

async fn create_device(env: &AppEnv, token: &str, name: &str) -> Uuid {
    let (status, _, body) = call(
        router(env),
        "POST",
        "/api/v1/devices",
        Some(token),
        Some(json!({ "name": name, "interface_id": env.interface_ids[0] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_share(env: &AppEnv, token: &str, device_id: Uuid, interface_id: Uuid) -> String {
    let (status, _, body) = call(
        router(env),
        "POST",
        &format!("/api/v1/devices/{device_id}/shares"),
        Some(token),
        Some(json!({ "interface_id": interface_id, "format": "conf" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn dev_mail_requires_an_administrator_token() {
    let env = app_env();
    let (status, _, _) = call(router(&env), "GET", "/api/v1/dev/mail", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _, _) = call(
        router(&env),
        "GET",
        "/api/v1/dev/mail",
        Some(&env.other_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let token = admin_token(&env).await;
    let (status, _, body) = call(router(&env), "GET", "/api/v1/dev/mail", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn dev_mail_accepts_the_dedicated_token() {
    let env = app_env_with_dev_mail_token("dev-mail-secret");
    let (status, _, _) = call(
        router(&env),
        "GET",
        "/api/v1/dev/mail",
        Some("dev-mail-secret"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _, _) = call(
        router(&env),
        "GET",
        "/api/v1/dev/mail",
        Some("wrong-secret"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn dev_mail_is_unavailable_in_production() {
    let env = app_env_production();
    let (status, _, _) = call(router(&env), "GET", "/api/v1/dev/mail", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn share_links_can_only_be_revoked_by_the_owner_or_admin() {
    let env = app_env();
    let device = create_device(&env, &env.owner_token, "share-owner").await;
    let token = create_share(&env, &env.owner_token, device, env.interface_ids[0]).await;

    let (status, _, _) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/shares/{token}"),
        Some(&env.other_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let admin = admin_token(&env).await;
    let (status, _, _) = call(
        router(&env),
        "DELETE",
        "/api/v1/shares/unknown-token",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, body) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/shares/{token}"),
        Some(&env.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let stored = env.state.share.find(&token).unwrap().unwrap();
    assert!(stored.revoked_at.is_some(), "the history is kept");

    let (status, _, _) = call(
        router(&env),
        "GET",
        &format!("/api/v1/share/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn deleting_a_user_cascades_devices_peers_and_shares() {
    let env = app_env();
    let admin = admin_token(&env).await;

    let (status, _, created) = call(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&admin),
        Some(json!({
            "email": "victim@example.com",
            "role": "user",
            "password": PASSWORD,
            "tariff_id": env.tariff_id,
            "group_id": env.group_id,
            "node_id": env.node_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let victim = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let (status, _, device) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        Some(&admin),
        Some(json!({
            "user_id": victim,
            "name": "victim-device",
            "interface_id": env.interface_ids[0],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{device}");
    let device_id = Uuid::parse_str(device["id"].as_str().unwrap()).unwrap();
    let share_token = create_share(&env, &admin, device_id, env.interface_ids[0]).await;

    let (tx, mut rx) = tokio::sync::mpsc::channel(8);
    env.state.registry.register(env.node_id, tx, None);

    let (status, _, body) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/users/{victim}"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    assert!(env.state.identity.find(victim).is_err());
    assert!(env.state.devices.get(device_id).is_err());
    assert!(
        env.state
            .devices
            .peers_for(device_id)
            .unwrap_or_default()
            .is_empty()
    );
    assert_eq!(env.store.count(Table::DevicePeers).unwrap(), 0);
    assert!(
        env.state
            .share
            .find(&share_token)
            .unwrap()
            .unwrap()
            .revoked_at
            .is_some()
    );
    assert!(
        rx.try_recv().is_ok(),
        "desired state must be published for the affected group"
    );
}

#[tokio::test]
async fn non_admin_cannot_pick_a_foreign_group() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let (status, _, created) = call(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&admin),
        Some(json!({
            "email": "nomad@example.com",
            "role": "user",
            "password": PASSWORD,
            "tariff_id": env.tariff_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let token = login(&env, "nomad@example.com", PASSWORD);

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        Some(&token),
        Some(json!({ "name": "nomad-device", "group_id": env.group_id })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn non_admin_cannot_pick_a_foreign_interface() {
    let env = app_env();
    let foreign_group = env
        .state
        .network
        .create_group("foreign", "", "10.99.0.1/24", false)
        .unwrap();
    let foreign_interface = env
        .state
        .network
        .add_interface(
            foreign_group.id,
            env.node_id,
            NewInterface {
                name: "awg-foreign".into(),
                label: "awg-foreign".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        Some(&env.owner_token),
        Some(json!({
            "name": "foreign-device",
            "interface_ids": [foreign_interface.id],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/devices",
        Some(&env.owner_token),
        Some(json!({
            "name": "own-device",
            "group_id": env.group_id,
            "interface_ids": [env.interface_ids[0]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn approving_a_user_publishes_the_assigned_group() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let user = env
        .state
        .identity
        .create(awg_identity::NewUser {
            email: "pending@example.com".into(),
            password: PASSWORD.into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap();
    let mut stored = env.state.identity.find(user.id).unwrap();
    stored.status = UserStatus::PendingApproval;
    env.store
        .put(Table::Users, &user.id.to_string(), &stored)
        .unwrap();

    let (tx, mut rx) = tokio::sync::mpsc::channel(8);
    env.state.registry.register(env.node_id, tx, None);

    let (status, _, body) = call(
        router(&env),
        "POST",
        &format!("/api/v1/users/{}/approve", user.id),
        Some(&admin),
        Some(json!({
            "tariff_id": env.tariff_id,
            "group_id": env.group_id,
            "node_id": env.node_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        rx.try_recv().is_ok(),
        "approval must publish the desired state"
    );
}

#[tokio::test]
async fn creating_a_pool_publishes_the_group() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let group = env
        .state
        .network
        .create_group("publish-pools", "", "10.91.0.1/24", false)
        .unwrap();
    env.state
        .network
        .add_interface(
            group.id,
            env.node_id,
            NewInterface {
                name: "awg-pub".into(),
                label: "awg-pub".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    let (tx, mut rx) = tokio::sync::mpsc::channel(8);
    env.state.registry.register(env.node_id, tx, None);

    let (status, _, body) = call(
        router(&env),
        "POST",
        &format!("/api/v1/groups/{}/pools", group.id),
        Some(&admin),
        Some(json!({
            "name": "clients",
            "cidr": "10.91.0.0/25",
            "mode": "auto",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        rx.try_recv().is_ok(),
        "pool changes must publish the desired state"
    );
}

#[tokio::test]
async fn successful_billing_webhook_publishes_the_group() {
    let env = app_env_with_mock_billing();
    let admin = admin_token(&env).await;

    let (status, _, plan) = call(
        router(&env),
        "POST",
        "/api/v1/billing/plans",
        Some(&admin),
        Some(json!({
            "name": "Pro",
            "price_cents": 10_000,
            "currency": "RUB",
            "period": "month",
            "tariff_id": env.tariff_id,
            "active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{plan}");
    let plan_id = plan["id"].as_str().unwrap();

    let (status, _, checkout) = call(
        router(&env),
        "POST",
        "/api/v1/billing/checkout",
        Some(&env.owner_token),
        Some(json!({ "plan_id": plan_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checkout}");
    let invoice_id = checkout["invoice"]["id"].as_str().unwrap();

    let (tx, mut rx) = tokio::sync::mpsc::channel(8);
    env.state.registry.register(env.node_id, tx, None);

    let now = chrono::Utc::now().timestamp();
    let body = format!(
        r#"{{"event_id":"evt-publish","kind":"payment.succeeded","invoice_id":"{invoice_id}","amount_cents":10000,"currency":"RUB","gateway_ref":"gw-evt-publish"}}"#
    );
    let signature = awg_billing::sign_webhook(MOCK_PAYMENT_SECRET, now, body.as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/billing/webhook/mock")
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 45_001))))
        .header("content-type", "application/json")
        .header("x-mock-timestamp", now.to_string())
        .header("x-mock-signature", signature)
        .body(Body::from(body))
        .unwrap();
    let response = router(&env).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        rx.try_recv().is_ok(),
        "a successful webhook must publish the desired state"
    );
}
