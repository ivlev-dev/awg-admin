use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use chrono::DateTime;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env};
use awg_identity::{Role, UserChanges};
use awg_shared::conf::{ClientConfParams, render_client_conf, render_server_conf};
use awg_shared::crypto::{generate_keypair, public_from_private};
use awg_shared::obf::{ObfuscationSettings, generate_client_obf, generate_interface_obf};
use awg_tariffs::TariffChanges;

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

async fn admin_token(env: &AppEnv) -> String {
    env.state
        .identity
        .update(
            env.owner_id,
            UserChanges {
                email: None,
                full_name: None,
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

async fn create_share(env: &AppEnv, token: &str, device_id: Uuid) -> Value {
    let (status, _, body) = call(
        router(env),
        "POST",
        &format!("/api/v1/devices/{device_id}/shares"),
        Some(token),
        Some(json!({ "interface_id": env.interface_ids[0], "format": "conf" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
async fn only_admins_may_change_revocation() {
    let env = app_env();
    let device = create_device(&env, &env.owner_token, "owner-device").await;

    let (status, _, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{device}"),
        Some(&env.owner_token),
        Some(json!({ "revoked": true })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(!env.state.devices.get(device).unwrap().revoked);
}

#[tokio::test]
async fn rejected_update_does_not_revoke_the_device() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let device = create_device(&env, &admin, "atomic-device").await;
    let share = create_share(&env, &admin, device).await;
    let token = share["token"].as_str().unwrap().to_string();

    let (status, _, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{device}"),
        Some(&admin),
        Some(json!({ "name": "", "revoked": true })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        !env.state.devices.get(device).unwrap().revoked,
        "a failed update must not leave the device revoked"
    );
    assert!(
        env.state
            .share
            .find(&token)
            .unwrap()
            .unwrap()
            .revoked_at
            .is_none(),
        "a failed update must not revoke share links"
    );
}

#[tokio::test]
async fn rejected_limit_update_does_not_revoke_or_rename_the_device() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let device = create_device(&env, &admin, "atomic-limits").await;
    create_device(&env, &admin, "atomic-sibling").await;
    let share = create_share(&env, &admin, device).await;
    let token = share["token"].as_str().unwrap().to_string();

    // Both devices carry the tariff's per-device limit (100 Mbit/s), so a
    // 150 Mbit/s group budget rejects any further update even though the
    // device already exists.
    env.state
        .tariffs
        .update(
            env.tariff_id,
            TariffChanges {
                group_down_kbps: Some(150_000),
                ..Default::default()
            },
        )
        .unwrap();

    let (status, _, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{device}"),
        Some(&admin),
        Some(json!({ "name": "renamed", "revoked": true })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let stored = env.state.devices.get(device).unwrap();
    assert_eq!(
        stored.name, "atomic-limits",
        "a rejected limit check must not persist the new name"
    );
    assert!(
        !stored.revoked,
        "a rejected limit check must not persist the revocation"
    );
    assert!(
        env.state
            .share
            .find(&token)
            .unwrap()
            .unwrap()
            .revoked_at
            .is_none(),
        "a rejected update must not revoke share links"
    );
}

#[tokio::test]
async fn name_and_revocation_are_applied_together() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let device = create_device(&env, &admin, "revokable-device").await;
    let share = create_share(&env, &admin, device).await;
    let token = share["token"].as_str().unwrap().to_string();

    let (status, _, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/devices/{device}"),
        Some(&admin),
        Some(json!({ "name": "renamed-device", "revoked": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let stored = env.state.devices.get(device).unwrap();
    assert_eq!(stored.name, "renamed-device", "the name must be applied");
    assert!(stored.revoked, "the revocation must be applied");
    assert!(
        env.state
            .share
            .find(&token)
            .unwrap()
            .unwrap()
            .revoked_at
            .is_some(),
        "revoking a device must revoke every share link of the device"
    );

    let (status, _, _) = call(
        router(&env),
        "GET",
        &format!("/api/v1/share/{token}"),
        None,
        None,
    )
    .await;
    assert_ne!(status, StatusCode::OK, "revoked link must stop working");
}

#[tokio::test]
async fn share_ttl_defaults_to_settings() {
    let env = app_env();
    let mut settings = env.state.settings.get().unwrap();
    settings.share_default_ttl_secs = 120;
    env.state.settings.save(&settings).unwrap();

    let device = create_device(&env, &env.owner_token, "ttl-device").await;
    let share = create_share(&env, &env.owner_token, device).await;

    let created = DateTime::parse_from_rfc3339(share["created_at"].as_str().unwrap()).unwrap();
    let expires = DateTime::parse_from_rfc3339(share["expires_at"].as_str().unwrap()).unwrap();
    assert_eq!((expires - created).num_seconds(), 120);
}

#[tokio::test]
async fn share_links_stop_working_for_disabled_owners() {
    let env = app_env();
    let device = create_device(&env, &env.owner_token, "disabled-owner").await;
    let share = create_share(&env, &env.owner_token, device).await;
    let token = share["token"].as_str().unwrap().to_string();

    let (status, _, _) = call(
        router(&env),
        "GET",
        &format!("/api/v1/share/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    env.state
        .identity
        .update(
            env.owner_id,
            UserChanges {
                email: None,
                full_name: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(true),
            },
        )
        .unwrap();

    let (status, _, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/share/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    env.state
        .identity
        .update(
            env.owner_id,
            UserChanges {
                email: None,
                full_name: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(false),
            },
        )
        .unwrap();

    let (status, _, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/share/{token}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

fn import_request(env: &AppEnv) -> Value {
    let server = generate_keypair();
    let server_public = public_from_private(&server.private_key).unwrap();
    let interface_obf = generate_interface_obf(&ObfuscationSettings::default());
    let server_conf = render_server_conf(&server.private_key, 51820, 1420, &interface_obf, &[]);

    let client = generate_keypair();
    let client_obf = generate_client_obf(&ObfuscationSettings::default());
    let addresses = vec!["10.77.0.5/24".to_string()];
    let allowed_ips = vec!["0.0.0.0/0".to_string()];
    let client_conf = render_client_conf(ClientConfParams {
        private_key: &client.private_key,
        addresses: &addresses,
        dns: &[],
        mtu: 1420,
        server_public_key: &server_public,
        preshared_key: None,
        endpoint: "vpn.example.com:51820",
        allowed_ips: &allowed_ips,
        obf: &interface_obf,
        client: &client_obf,
    });

    json!({
        "node_id": env.node_id,
        "group_name": "concurrent-import",
        "group_description": "",
        "base_cidr": "10.77.0.0/24",
        "interfaces": [{
            "server_config": server_conf,
            "name": "awg-import",
            "label": "concurrent",
            "endpoint_host": "vpn.example.com",
            "endpoint_port": 51820,
            "listen_port": 51820,
            "mtu": 1420,
            "pools": [{ "name": "clients", "cidr": "10.77.0.0/24", "gateway": null }],
            "clients": [{ "name": "concurrent-client", "config": client_conf }],
        }],
    })
}

#[tokio::test]
async fn concurrent_import_apply_does_not_duplicate_devices() {
    let env = app_env();
    let admin = admin_token(&env).await;
    let request = import_request(&env);

    let (first, second) = tokio::join!(
        call(
            router(&env),
            "POST",
            "/api/v1/import/apply",
            Some(&admin),
            Some(request.clone()),
        ),
        call(
            router(&env),
            "POST",
            "/api/v1/import/apply",
            Some(&admin),
            Some(request),
        ),
    );

    let statuses = [first.0, second.0];
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1,
        "exactly one concurrent import must succeed: {statuses:?}"
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::CONFLICT)
            .count(),
        1,
        "the second concurrent import must be rejected: {statuses:?}"
    );

    let devices = env.state.devices.list_all().unwrap();
    let imported: Vec<_> = devices
        .iter()
        .filter(|device| device.name == "concurrent-client")
        .collect();
    assert_eq!(imported.len(), 1, "no duplicate devices may be created");
}
