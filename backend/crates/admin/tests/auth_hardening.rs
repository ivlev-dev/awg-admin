use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env, app_env_with_login_limits};
use awg_statistics::StatsScope;

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
    call_from(app, method, uri, token, body, "127.0.0.1:45000").await
}

async fn call_from(
    app: Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
    peer: &str,
) -> (StatusCode, HeaderMap, Value) {
    let peer: SocketAddr = peer.parse().unwrap();
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .extension(ConnectInfo(peer));
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

#[tokio::test]
async fn auth_responses_are_never_cached() {
    let env = app_env();
    let (status, headers, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": OWNER_EMAIL, "password": PASSWORD })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        headers
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("no-store")
    );
    assert_eq!(
        headers.get("pragma").and_then(|value| value.to_str().ok()),
        Some("no-cache")
    );
}

#[tokio::test]
async fn repeated_emails_from_many_addresses_hit_the_account_limit() {
    let env = app_env_with_login_limits(2, 100);
    let payload = json!({ "email": "target@example.com", "password": "wrong-password" });

    for peer in ["198.51.100.1:40000", "198.51.100.2:40000"] {
        let (status, _, body) = call_from(
            router(&env),
            "POST",
            "/api/v1/auth/login",
            None,
            Some(payload.clone()),
            peer,
        )
        .await;
        assert_ne!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
    }

    let (status, headers, body) = call_from(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(payload),
        "198.51.100.3:40000",
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
    assert!(
        headers.get("retry-after").is_some(),
        "a rate-limited login must expose Retry-After"
    );
}

#[tokio::test]
async fn many_emails_from_one_address_hit_the_ip_limit() {
    let env = app_env_with_login_limits(100, 2);
    let peer = "203.0.113.7:41000";

    for email in ["one@example.com", "two@example.com"] {
        let (status, _, body) = call_from(
            router(&env),
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": email, "password": "wrong-password" })),
            peer,
        )
        .await;
        assert_ne!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
    }

    let (status, _, body) = call_from(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": "three@example.com", "password": "wrong-password" })),
        peer,
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{body}");
}

#[tokio::test]
async fn ws_ticket_endpoint_issues_a_single_use_ticket() {
    let env = app_env();
    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/ws/ticket",
        Some(&env.owner_token),
        Some(json!({ "scope": "user", "id": env.owner_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["expires_in"], 30u64);
    let ticket = body["ticket"].as_str().unwrap();
    assert_eq!(ticket.len(), 64);
    assert!(ticket.chars().all(|c| c.is_ascii_hexdigit()));

    assert_eq!(
        env.state.ws_tickets.consume(ticket),
        Some((env.owner_id, StatsScope::User(env.owner_id)))
    );
    assert_eq!(env.state.ws_tickets.consume(ticket), None);
}

#[tokio::test]
async fn ws_ticket_requires_authentication() {
    let env = app_env();
    let (status, _, _) = call(
        router(&env),
        "POST",
        "/api/v1/ws/ticket",
        None,
        Some(json!({ "scope": "global" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _, _) = call(
        router(&env),
        "POST",
        "/api/v1/ws/ticket",
        Some(&env.owner_token),
        Some(json!({ "scope": "global" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
