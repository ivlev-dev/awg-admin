use std::sync::Arc;

use awg_storage::CURRENT_SCHEMA_VERSION;
use axum::Json;
use axum::Router;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;

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
        .route("/audit", get(controllers::audit::list))
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

async fn dev_mail(State(state): State<Arc<AppState>>) -> Response {
    if dev_mail_disabled(&state) {
        return dev_mail_not_found();
    }
    Json(crate::mailer::dev_mailbox().list()).into_response()
}

async fn dev_mail_clear(State(state): State<Arc<AppState>>) -> Response {
    if dev_mail_disabled(&state) {
        return dev_mail_not_found();
    }
    crate::mailer::dev_mailbox().clear();
    StatusCode::NO_CONTENT.into_response()
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
