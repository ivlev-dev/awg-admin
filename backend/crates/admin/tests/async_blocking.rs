use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env};

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

/// Argon2 verification must run on the blocking pool: on a single-threaded
/// runtime a blocking hash would make the health check complete only after the
/// login response, which this test catches.
#[tokio::test(flavor = "current_thread")]
async fn the_health_check_is_served_while_a_login_hash_runs() {
    let env = app_env();
    let finished = Arc::new(AtomicU8::new(0));

    let login_state = env.state.clone();
    let login_store = env.store.clone();
    let login_finished = finished.clone();
    let login = tokio::spawn(async move {
        let app = routes::router(login_state, Readiness::new(login_store));
        let (status, _, body) = call(
            app,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": OWNER_EMAIL, "password": PASSWORD })),
        )
        .await;
        login_finished.store(1, Ordering::SeqCst);
        (status, body)
    });

    tokio::time::sleep(Duration::from_millis(2)).await;

    let (status, _, body) = tokio::time::timeout(
        Duration::from_secs(5),
        call(router(&env), "GET", "/api/v1/health", None, None),
    )
    .await
    .expect("the health check was blocked by password hashing");
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        finished.load(Ordering::SeqCst),
        0,
        "the health check was served only after the login completed"
    );

    let (login_status, login_body) = login.await.unwrap();
    assert_eq!(login_status, StatusCode::OK, "{login_body}");
    assert!(login_body["token"].as_str().is_some());
    assert_eq!(finished.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn registration_and_password_change_keep_their_contract() {
    let env = app_env();

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/register",
        None,
        Some(json!({
            "email": "new-user@example.com",
            "password": "password123",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(body["status"], "pending_email");

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/register",
        None,
        Some(json!({
            "email": "new-user@example.com",
            "password": "password123",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "conflict");

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({
            "email": "new-user@example.com",
            "password": "password123",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"]["code"], "email_not_verified");

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/password",
        Some(&env.owner_token),
        Some(json!({
            "current_password": PASSWORD,
            "new_password": "new-password-123",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": OWNER_EMAIL, "password": PASSWORD })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"]["code"], "forbidden");

    let (status, _, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({
            "email": OWNER_EMAIL,
            "password": "new-password-123",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}
