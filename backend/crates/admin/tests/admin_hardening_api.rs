use std::net::SocketAddr;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use awg_admin::routes::{self, Readiness};
use awg_admin::test_support::{AppEnv, OWNER_EMAIL, PASSWORD, app_env};
use awg_identity::{NewUser, Role, SessionMetadata, UserChanges, UserStatus};
use awg_network::{NewInterface, NewPool, PoolMode};
use awg_shared::obf::ObfuscationSettings;
use awg_storage::Table;

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
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, json)
}

fn login(env: &AppEnv, email: &str) -> String {
    env.state
        .identity
        .login(
            email,
            PASSWORD,
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
    login(env, OWNER_EMAIL)
}

fn create_user(env: &AppEnv, email: &str, group_id: Option<Uuid>, node_id: Option<Uuid>) -> Uuid {
    env.state
        .identity
        .create(NewUser {
            email: email.into(),
            full_name: None,
            password: PASSWORD.into(),
            role: Role::User,
            tariff_id: None,
            group_id,
            node_id,
        })
        .unwrap()
        .id
}

fn pending_user(env: &AppEnv, email: &str) -> Uuid {
    let user = env
        .state
        .identity
        .create(NewUser {
            email: email.into(),
            full_name: None,
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
    user.id
}

#[tokio::test]
async fn demoting_the_last_active_admin_is_rejected() {
    let env = app_env();
    let token = admin_token(&env);

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/users/{}", env.owner_id),
        &token,
        Some(json!({ "role": "user" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(
        body["error"]["message"],
        "cannot remove the last administrator"
    );

    let owner = env.state.identity.find(env.owner_id).unwrap();
    assert_eq!(owner.role, Role::Admin, "the admin must stay an admin");
}

#[tokio::test]
async fn a_second_active_admin_allows_demotion_and_disabling() {
    let env = app_env();
    let token = admin_token(&env);
    let other = env
        .state
        .identity
        .update(
            env.other_id,
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
    assert_eq!(other.role, Role::Admin);

    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/users/{}", env.other_id),
        &token,
        Some(json!({ "role": "user" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["role"], "user");
    assert_eq!(
        env.state.identity.find(env.owner_id).unwrap().role,
        Role::Admin
    );

    env.state
        .identity
        .update(
            env.other_id,
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
    let (status, body) = call(
        router(&env),
        "PATCH",
        &format!("/api/v1/users/{}", env.other_id),
        &token,
        Some(json!({ "disabled": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["disabled"].as_bool().unwrap());
    assert!(
        env.state
            .identity
            .find(env.owner_id)
            .unwrap()
            .role
            .is_admin()
    );
}

#[tokio::test]
async fn deleting_one_of_two_admins_is_allowed() {
    let env = app_env();
    let token = admin_token(&env);
    env.state
        .identity
        .update(
            env.other_id,
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

    let (status, body) = call(
        router(&env),
        "DELETE",
        &format!("/api/v1/users/{}", env.other_id),
        &token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(env.state.identity.find(env.other_id).is_err());
    assert!(
        env.state
            .identity
            .find(env.owner_id)
            .unwrap()
            .role
            .is_admin()
    );
}

#[tokio::test]
async fn bulk_user_actions_report_failures_without_stopping() {
    let env = app_env();
    let token = admin_token(&env);
    env.state
        .identity
        .update(
            env.other_id,
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

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/users/bulk",
        &token,
        Some(json!({
            "action": "delete",
            "ids": [env.owner_id, env.other_id],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["done"], 1, "{body}");
    let failed = body["failed"].as_array().unwrap();
    assert_eq!(failed.len(), 1, "{body}");
    assert_eq!(failed[0]["id"], env.owner_id.to_string());
    assert_eq!(failed[0]["error"], "cannot delete your own account");
    assert!(env.state.identity.find(env.other_id).is_err());
    assert!(env.state.identity.find(env.owner_id).is_ok());
}

#[tokio::test]
async fn bulk_disabling_the_only_admin_is_reported_as_failed() {
    let env = app_env();
    let token = admin_token(&env);

    let (status, body) = call(
        router(&env),
        "POST",
        "/api/v1/users/bulk",
        &token,
        Some(json!({ "action": "disable", "ids": [env.owner_id] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["done"], 0, "{body}");
    let failed = body["failed"].as_array().unwrap();
    assert_eq!(failed.len(), 1, "{body}");
    assert_eq!(failed[0]["id"], env.owner_id.to_string());
    assert_eq!(
        failed[0]["error"], "cannot disable your own account",
        "self-disable must stay blocked"
    );
    let owner = env.state.identity.find(env.owner_id).unwrap();
    assert!(!owner.disabled);
    assert!(owner.role.is_admin());
}

#[tokio::test]
async fn approving_with_an_unknown_tariff_keeps_the_user_pending() {
    let env = app_env();
    let token = admin_token(&env);
    let user_id = pending_user(&env, "awaiting@example.com");

    let (status, body) = call(
        router(&env),
        "POST",
        &format!("/api/v1/users/{user_id}/approve"),
        &token,
        Some(json!({
            "tariff_id": Uuid::new_v4(),
            "group_id": env.group_id,
            "node_id": env.node_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let stored = env.state.identity.find(user_id).unwrap();
    assert_eq!(stored.status, UserStatus::PendingApproval);
    assert!(stored.tariff_id.is_none());
    assert!(stored.group_id.is_none());
}

#[tokio::test]
async fn approving_with_an_unknown_group_keeps_the_user_pending() {
    let env = app_env();
    let token = admin_token(&env);
    let user_id = pending_user(&env, "awaiting-group@example.com");

    let (status, body) = call(
        router(&env),
        "POST",
        &format!("/api/v1/users/{user_id}/approve"),
        &token,
        Some(json!({
            "tariff_id": env.tariff_id,
            "group_id": Uuid::new_v4(),
            "node_id": env.node_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let stored = env.state.identity.find(user_id).unwrap();
    assert_eq!(stored.status, UserStatus::PendingApproval);
    assert!(stored.tariff_id.is_none());
    assert!(stored.group_id.is_none());
}

#[tokio::test]
async fn approving_sets_the_tariff_and_group_together() {
    let env = app_env();
    let token = admin_token(&env);
    let user_id = pending_user(&env, "awaiting-ok@example.com");

    let (status, body) = call(
        router(&env),
        "POST",
        &format!("/api/v1/users/{user_id}/approve"),
        &token,
        Some(json!({
            "tariff_id": env.tariff_id,
            "group_id": env.group_id,
            "node_id": env.node_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "active");
    assert_eq!(body["tariff_id"], env.tariff_id.to_string());
    assert_eq!(body["group_id"], env.group_id.to_string());
    assert_eq!(body["node_id"], env.node_id.to_string());
}

#[tokio::test]
async fn creating_a_user_validates_group_and_tariff() {
    let env = app_env();
    let token = admin_token(&env);

    for (email, body) in [
        (
            "bad-group@example.com",
            json!({
                "email": "bad-group@example.com",
                "password": PASSWORD,
                "role": "user",
                "group_id": Uuid::new_v4(),
            }),
        ),
        (
            "bad-tariff@example.com",
            json!({
                "email": "bad-tariff@example.com",
                "password": PASSWORD,
                "role": "user",
                "tariff_id": Uuid::new_v4(),
            }),
        ),
    ] {
        let (status, response) =
            call(router(&env), "POST", "/api/v1/users", &token, Some(body)).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{response}");
        assert!(
            env.state.identity.find_by_email(email).unwrap().is_none(),
            "{email} must not be created"
        );
    }
}

#[tokio::test]
async fn non_admin_sees_only_its_group_and_its_pools() {
    let env = app_env();
    let admin = admin_token(&env);
    let beta = env
        .state
        .network
        .create_group("beta", "", "10.30.0.1/24", false)
        .unwrap();
    env.state
        .network
        .add_pool(
            beta.id,
            NewPool {
                name: "beta-clients".into(),
                cidr: "10.30.0.0/25".into(),
                mode: PoolMode::Auto,
                gateway: None,
            },
        )
        .unwrap();
    create_user(&env, "alpha-user@example.com", Some(env.group_id), None);
    create_user(&env, "beta-user@example.com", Some(beta.id), None);
    let alpha_token = login(&env, "alpha-user@example.com");
    let beta_token = login(&env, "beta-user@example.com");

    let (status, groups) = call(router(&env), "GET", "/api/v1/groups", &alpha_token, None).await;
    assert_eq!(status, StatusCode::OK, "{groups}");
    let groups = groups.as_array().unwrap();
    assert_eq!(groups.len(), 1, "{groups:?}");
    assert_eq!(groups[0]["id"], env.group_id.to_string());

    let (status, groups) = call(router(&env), "GET", "/api/v1/groups", &beta_token, None).await;
    assert_eq!(status, StatusCode::OK, "{groups}");
    let groups = groups.as_array().unwrap();
    assert_eq!(groups.len(), 1, "{groups:?}");
    assert_eq!(groups[0]["id"], beta.id.to_string());

    let (status, groups) = call(router(&env), "GET", "/api/v1/groups", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{groups}");
    assert_eq!(groups.as_array().unwrap().len(), 2);

    let (status, pools) = call(
        router(&env),
        "GET",
        &format!("/api/v1/groups/{}/pools", env.group_id),
        &alpha_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{pools}");
    assert!(!pools.as_array().unwrap().is_empty());

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/groups/{}/pools", beta.id),
        &alpha_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, body) = call(
        router(&env),
        "GET",
        &format!("/api/v1/groups/{}/pools", beta.id),
        &beta_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn interface_visibility_follows_node_then_group() {
    let env = app_env();
    let admin = admin_token(&env);

    // An extra interface in the same group but served by a different node.
    let (foreign_node, _) = env.state.network.create_node("node-extra").unwrap();
    let extra = env
        .state
        .network
        .add_interface(
            env.group_id,
            foreign_node.id,
            NewInterface {
                name: "awg-extra".into(),
                label: "awg-extra".into(),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                listen_port: 51820,
                mtu: 1420,
            },
            &ObfuscationSettings::default(),
        )
        .unwrap();

    create_user(&env, "node-only@example.com", None, Some(env.node_id));
    create_user(&env, "group-only@example.com", Some(env.group_id), None);
    create_user(&env, "unbound@example.com", None, None);
    let node_token = login(&env, "node-only@example.com");
    let group_token = login(&env, "group-only@example.com");
    let unbound_token = login(&env, "unbound@example.com");

    let (status, body) = call(router(&env), "GET", "/api/v1/interfaces", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body.as_array().unwrap().len(), 5, "{body}");

    let (status, body) = call(router(&env), "GET", "/api/v1/interfaces", &node_token, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let interfaces = body.as_array().unwrap();
    assert_eq!(interfaces.len(), 4, "{body}");
    assert!(
        interfaces
            .iter()
            .all(|item| item["node_id"] == env.node_id.to_string()),
        "{body}"
    );
    assert!(
        !interfaces
            .iter()
            .any(|item| item["id"] == extra.id.to_string()),
        "a node-bound user must not see interfaces of another node"
    );

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/interfaces",
        &group_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body.as_array().unwrap().len(), 5, "{body}");
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .all(|item| item["group_id"] == env.group_id.to_string()),
        "{body}"
    );

    let (status, body) = call(
        router(&env),
        "GET",
        "/api/v1/interfaces",
        &unbound_token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.as_array().unwrap().is_empty(), "{body}");
}
