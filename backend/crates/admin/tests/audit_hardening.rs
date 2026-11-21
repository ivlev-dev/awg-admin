use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env};
use awg_audit::AuditEntry;

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

async fn create_device(env: &AppEnv, name: &str) -> Uuid {
    let (status, _, body) = call(
        router(env),
        "POST",
        "/api/v1/devices",
        Some(&env.owner_token),
        Some(json!({ "name": name, "interface_id": env.interface_ids[0] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_share(env: &AppEnv, device: Uuid) -> String {
    let (status, _, body) = call(
        router(env),
        "POST",
        &format!("/api/v1/devices/{device}/shares"),
        Some(&env.owner_token),
        Some(json!({ "interface_id": env.interface_ids[0], "format": "conf" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["token"].as_str().unwrap().to_string()
}

async fn wait_for_audit(
    env: &AppEnv,
    mut predicate: impl FnMut(&AuditEntry) -> bool,
) -> AuditEntry {
    for _ in 0..200 {
        if let Some(entry) = env
            .state
            .audit
            .list(500)
            .unwrap()
            .into_iter()
            .find(|entry| predicate(entry))
        {
            return entry;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected audit entry was not written");
}

#[tokio::test]
async fn share_tokens_are_hashed_in_the_audit_journal() {
    let env = app_env();
    let device = create_device(&env, "audited-share").await;
    let token = create_share(&env, device).await;

    let (status, _, body) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/shares/{token}"),
        Some(&env.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let entry = wait_for_audit(&env, |entry| {
        entry.entity == "shares" && entry.action == "DELETE" && entry.status == 200
    })
    .await;
    let entity_id = entry.entity_id.expect("share audit has an entity id");
    assert_eq!(entity_id.len(), 12, "{entity_id}");
    assert!(
        !entity_id.contains(&token),
        "the raw token leaked: {entity_id}"
    );

    let details = entry.details.expect("share audit has details");
    assert!(details.contains("sha256:"), "{details}");
    assert!(!details.contains(&token), "the raw token leaked: {details}");
}

#[tokio::test]
async fn forbidden_mutations_are_audited() {
    let env = app_env();
    let device = create_device(&env, "forbidden-share").await;
    let token = create_share(&env, device).await;

    let (status, _, _) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/shares/{token}"),
        Some(&env.other_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let entry = wait_for_audit(&env, |entry| {
        entry.entity == "shares" && entry.status == 403
    })
    .await;
    assert_eq!(entry.action, "DELETE");
    assert!(
        !entry
            .details
            .as_deref()
            .unwrap_or_default()
            .contains(&token)
    );
}

#[tokio::test]
async fn conflicting_mutations_are_audited() {
    let env = app_env();
    let token = admin_token(&env).await;

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/users",
        Some(&token),
        Some(json!({
            "email": OWNER_EMAIL,
            "role": "user",
            "password": PASSWORD,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    let entry = wait_for_audit(&env, |entry| entry.entity == "users" && entry.status == 409).await;
    assert_eq!(entry.action, "POST");
    assert_eq!(entry.details.as_deref(), Some("POST /api/v1/users"));
}
