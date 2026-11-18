use std::sync::Arc;

use awg_storage::CURRENT_SCHEMA_VERSION;
use axum::Json;
use axum::Router;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use subtle::ConstantTimeEq;

use crate::controllers;
use crate::state::AppState;
use crate::ws;

use super::Readiness;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/dev/mail", get(dev_mail).delete(dev_mail_clear))
        .route(
            "/settings",
            get(controllers::settings::get).put(controllers::settings::update),
        )
        .route(
            "/audit",
            get(controllers::audit::list).delete(controllers::audit::clear),
        )
        .route("/ws/stats", get(ws::stats_ws))
}

pub async fn health(State(_): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "awg-admin",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

pub async fn ready(Extension(readiness): Extension<Readiness>) -> Response {
    readiness_response(&readiness)
}

async fn dev_mail(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(response) = authorize_dev_mail(&state, &headers) {
        return *response;
    }
    Json(crate::mailer::dev_mailbox().list()).into_response()
}

async fn dev_mail_clear(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(response) = authorize_dev_mail(&state, &headers) {
        return *response;
    }
    crate::mailer::dev_mailbox().clear();
    StatusCode::NO_CONTENT.into_response()
}

/// The development mail sink is disabled in production. Elsewhere it accepts
/// either `AWG_DEV_MAIL_TOKEN` or a regular administrator access token.
fn authorize_dev_mail(state: &AppState, headers: &HeaderMap) -> Result<(), Box<Response>> {
    if dev_mail_disabled(state) {
        return Err(Box::new(dev_mail_not_found()));
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Box::new(dev_mail_unauthorized()))?;
    if let Some(expected) = state.config.dev_mail_token.as_deref()
        && expected.as_bytes().ct_eq(token.as_bytes()).into()
    {
        return Ok(());
    }
    match state.identity.authenticate(token) {
        Ok(principal) if principal.is_admin() => Ok(()),
        Ok(_) => Err(Box::new(dev_mail_forbidden())),
        Err(_) => Err(Box::new(dev_mail_unauthorized())),
    }
}

fn dev_mail_disabled(state: &AppState) -> bool {
    state.config.environment.is_production()
}

fn dev_mail_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "error": {
                "code": "not_found",
                "message": "dev mail sink is disabled",
            },
        })),
    )
        .into_response()
}

fn dev_mail_unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": {
                "code": "unauthorized",
                "message": "dev mail requires an administrator token or AWG_DEV_MAIL_TOKEN",
            },
        })),
    )
        .into_response()
}

fn dev_mail_forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "error": {
                "code": "forbidden",
                "message": "admin role required",
            },
        })),
    )
        .into_response()
}

fn readiness_response(readiness: &Readiness) -> Response {
    if readiness.is_shutting_down() {
        return unavailable("shutting_down", None);
    }
    match readiness.store.schema_version() {
        Ok(version) if version == CURRENT_SCHEMA_VERSION => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ready",
                "service": "awg-admin",
                "version": env!("CARGO_PKG_VERSION"),
                "schema_version": version,
            })),
        )
            .into_response(),
        Ok(version) => unavailable("schema_not_migrated", Some(version)),
        Err(error) => {
            tracing::warn!(%error, "readiness check failed");
            unavailable("schema_unavailable", None)
        }
    }
}

fn unavailable(reason: &str, schema_version: Option<u32>) -> Response {
    let mut body = serde_json::json!({
        "status": "unavailable",
        "service": "awg-admin",
        "reason": reason,
    });
    if let Some(version) = schema_version {
        body["schema_version"] = serde_json::json!(version);
    }
    (StatusCode::SERVICE_UNAVAILABLE, Json(body)).into_response()
}
