use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env};
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
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    (status, json)
}

fn login(env: &AppEnv, email: &str, password: &str) -> String {
    env.state
        .identity
        .login(
            email,
            password,
            &SessionMetadata {
                user_agent: None,
                ip: None,
            },
        )
        .unwrap()
        .access_token
}

fn admin_token(env: &AppEnv) -> String {
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

#[tokio::test]
async fn login_accepts_only_email() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        "unused",
        Some(json!({ "email": OWNER_EMAIL, "password": PASSWORD })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["email"], OWNER_EMAIL);
    assert!(body["user"].get("login").is_none());
    assert!(body["user"]["full_name"].is_null());

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        "unused",
        Some(json!({ "email": OWNER_EMAIL, "login": "owner", "password": PASSWORD })),
    )
    .await;
    assert!(status.is_client_error(), "{status}: {body}");

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        "unused",
        Some(json!({ "login": "owner", "password": PASSWORD })),
    )
    .await;
    assert!(status.is_client_error(), "{status}: {body}");

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/login",
        "unused",
        Some(json!({ "email": "owner", "password": PASSWORD })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn registration_accepts_optional_full_name() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/register",
        "unused",
        Some(json!({
            "email": "new-person@example.com",
            "password": "password123",
            "full_name": "  Иван Петров  "
        })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let created = env
        .state
        .identity
        .find_by_email("new-person@example.com")
        .unwrap()
        .unwrap();
    assert_eq!(created.full_name.as_deref(), Some("Иван Петров"));

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/register",
        "unused",
        Some(json!({
            "email": "plain-person@example.com",
            "password": "password123"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let plain = env
        .state
        .identity
        .find_by_email("plain-person@example.com")
        .unwrap()
        .unwrap();
    assert!(plain.full_name.is_none());

    let too_long = "a".repeat(201);
    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/auth/register",
        "unused",
        Some(json!({
            "email": "long-name@example.com",
            "password": "password123",
            "full_name": too_long
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        env.state
            .identity
            .find_by_email("long-name@example.com")
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn admin_creates_and_updates_full_name_and_email() {
    let env = app_env();
    let token = admin_token(&env);
    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/users",
        &token,
        Some(json!({
            "email": "managed@example.com",
            "full_name": "  Управляемый Пользователь ",
            "password": "password123",
            "role": "user"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["email"], "managed@example.com");
    assert_eq!(body["full_name"], "Управляемый Пользователь");
    assert!(body.get("login").is_none());
    let id = body["id"].as_str().unwrap();

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/users/{id}"),
        &token,
        Some(json!({
            "email": "Renamed@Example.COM",
            "full_name": "Новое Имя"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["email"], "renamed@example.com");
    assert_eq!(body["full_name"], "Новое Имя");

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/users/{id}"),
        &token,
        Some(json!({ "full_name": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["full_name"].is_null());

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/users/{id}"),
        &token,
        Some(json!({ "full_name": "x".repeat(201) })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn users_edit_their_own_full_name() {
    let env = app_env();
    let (status, body) = call(
        router(&env),
        "PATCH",
        "/api/v1/auth/me",
        &env.owner_token,
        Some(json!({ "full_name": " Владелец Аккаунта " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["full_name"], "Владелец Аккаунта");
    assert_eq!(body["email"], OWNER_EMAIL);
    assert!(body.get("login").is_none());

    let (status, body) = call(
        router(&env),
        "PATCH",
        "/api/v1/auth/me",
        &env.owner_token,
        Some(json!({ "email": "hijack@example.com" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["email"], OWNER_EMAIL, "email is not user-editable");

    let (status, body) = call(
        router(&env),
        "PATCH",
        "/api/v1/auth/me",
        &env.owner_token,
        Some(json!({ "full_name": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let (status, body) = call(
        router(&env),
        "PATCH",
        "/api/v1/auth/me",
        &env.owner_token,
        Some(json!({ "full_name": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["full_name"].is_null());
}

#[tokio::test]
async fn users_page_searches_email_and_full_name_and_sorts_by_email() {
    let env = app_env();
    let token = admin_token(&env);
    for (email, full_name) in [
        ("zeta-search@example.org", "SortingOne"),
        ("alpha-search@example.org", "SortingTwo"),
    ] {
        let (status, body) = call(
            router(&env),
            "POST",
            "/api/v1/users",
            &token,
            Some(json!({
                "email": email,
                "full_name": full_name,
                "password": "password123",
                "role": "user"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?q=sorted-name-marker",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 0);

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?q=search@example",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 2, "{body}");
    let emails: Vec<&str> = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["email"].as_str().unwrap())
        .collect();
    assert_eq!(
        emails,
        vec!["alpha-search@example.org", "zeta-search@example.org"]
    );

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/users/page?q=sortingtwo",
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1, "{body}");
    assert_eq!(body["items"][0]["email"], "alpha-search@example.org");
    assert_eq!(body["items"][0]["full_name"], "SortingTwo");
}

#[tokio::test]
async fn audit_entries_expose_actor_email() {
    let env = app_env();
    let token = admin_token(&env);
    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/users",
        &token,
        Some(json!({
            "email": "audited@example.com",
            "password": "password123",
            "role": "user"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, body) = call(router(&env), "GET", "/api/v1/audit?limit=10", &token, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let entry = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["entity"] == "users")
        .expect("the user creation is audited");
    assert_eq!(entry["actor_email"], OWNER_EMAIL);
    assert_eq!(entry["actor_login"], OWNER_EMAIL);
}
