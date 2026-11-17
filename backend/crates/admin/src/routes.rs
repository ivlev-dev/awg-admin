use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use awg_storage::{CURRENT_SCHEMA_VERSION, Store};
use axum::Router;
use axum::extract::{DefaultBodyLimit, Extension, Request, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use tower_http::cors::{Any, CorsLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::Instrument;
use uuid::Uuid;

use crate::controllers;
use crate::state::AppState;
use crate::ws;

pub const REQUEST_ID_HEADER: &str = "x-request-id";
const MAX_REQUEST_ID_LEN: usize = 128;
const BODY_LIMIT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub struct Readiness {
    store: Arc<Store>,
    shutting_down: Arc<AtomicBool>,
}

impl Readiness {
    pub fn new(store: Arc<Store>) -> Self {
        Self {
            store,
            shutting_down: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn mark_shutting_down(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }
}

pub fn router(state: Arc<AppState>, readiness: Readiness) -> Router {
    let timeout = Duration::from_secs(state.config.http_timeout_secs);
    let api = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/dev/mail", get(dev_mail).delete(dev_mail_clear))
        .route("/auth/login", post(controllers::auth::login))
        .route("/auth/register", post(controllers::auth::register))
        .route("/auth/verify-email", post(controllers::auth::verify_email))
        .route(
            "/auth/resend-verification",
            post(controllers::auth::resend_verification),
        )
        .route(
            "/auth/forgot-password",
            post(controllers::auth::forgot_password),
        )
        .route(
            "/auth/reset-password",
            post(controllers::auth::reset_password),
        )
        .route("/auth/refresh", post(controllers::auth::refresh))
        .route("/auth/logout", post(controllers::auth::logout))
        .route("/auth/me", get(controllers::auth::me))
        .route("/auth/password", post(controllers::auth::change_password))
        .route("/auth/sessions", get(controllers::auth::sessions))
        .route(
            "/auth/sessions/{jti}",
            delete(controllers::auth::revoke_session),
        )
        .route("/auth/logout-all", post(controllers::auth::logout_all))
        .route("/auth/totp/setup", post(controllers::auth::totp_setup))
        .route("/auth/totp/enable", post(controllers::auth::totp_enable))
        .route("/auth/totp/disable", post(controllers::auth::totp_disable))
        .route("/users/pending", get(controllers::users::pending))
        .route(
            "/users",
            get(controllers::users::list).post(controllers::users::create),
        )
        .route(
            "/users/{id}",
            get(controllers::users::get)
                .patch(controllers::users::update)
                .delete(controllers::users::delete),
        )
        .route(
            "/users/{id}/password",
            post(controllers::users::reset_password),
        )
        .route("/users/{id}/approve", post(controllers::users::approve))
        .route("/users/{id}/reject", post(controllers::users::reject))
        .route(
            "/tariffs",
            get(controllers::tariffs::list).post(controllers::tariffs::create),
        )
        .route(
            "/tariffs/{id}",
            patch(controllers::tariffs::update).delete(controllers::tariffs::delete),
        )
        .route(
            "/groups",
            get(controllers::groups::list).post(controllers::groups::create),
        )
        .route(
            "/groups/{id}",
            patch(controllers::groups::update).delete(controllers::groups::delete),
        )
        .route(
            "/groups/{id}/pools",
            get(controllers::groups::list_pools).post(controllers::groups::create_pool),
        )
        .route(
            "/pools/{id}",
            patch(controllers::groups::update_pool).delete(controllers::groups::delete_pool),
        )
        .route(
            "/nodes",
            get(controllers::nodes::list).post(controllers::nodes::create),
        )
        .route("/nodes/{id}", delete(controllers::nodes::delete))
        .route(
            "/interfaces",
            get(controllers::interfaces::list).post(controllers::interfaces::create),
        )
        .route(
            "/interfaces/{id}",
            patch(controllers::interfaces::update).delete(controllers::interfaces::delete),
        )
        .route(
            "/interfaces/{id}/rotate",
            post(controllers::interfaces::rotate),
        )
        .route(
            "/devices",
            get(controllers::devices::list).post(controllers::devices::create),
        )
        .route(
            "/devices/{id}",
            get(controllers::devices::get)
                .patch(controllers::devices::update)
                .delete(controllers::devices::delete),
        )
        .route(
            "/devices/{id}/profiles",
            get(controllers::devices::profiles),
        )
        .route(
            "/devices/{id}/profiles/{interface_id}",
            get(controllers::devices::profile),
        )
        .route(
            "/devices/{id}/shares",
            get(controllers::devices::list_shares).post(controllers::devices::create_share),
        )
        .route("/devices/{id}/stats", get(controllers::stats::device_stats))
        .route(
            "/shares/{token}",
            delete(controllers::devices::revoke_share),
        )
        .route("/stats/overview", get(controllers::stats::overview))
        .route("/stats/series", get(controllers::stats::series))
        .route("/stats/aggregate", get(controllers::stats::aggregate))
        .route("/quota", get(controllers::quota::current))
        .route("/quota/users", get(controllers::quota::users))
        .route(
            "/settings",
            get(controllers::settings::get).put(controllers::settings::update),
        )
        .route("/audit", get(controllers::audit::list))
        .route("/import", post(controllers::import::run))
        .route("/import/preview", post(controllers::import::preview))
        .route("/import/apply", post(controllers::import::apply))
        .route(
            "/import/clients/preview",
            post(controllers::import::clients_preview),
        )
        .route(
            "/import/clients/apply",
            post(controllers::import::clients_apply),
        )
        .route("/ws/stats", get(ws::stats_ws))
        .route("/share/{token}", get(controllers::share::download));

    let billing = Router::new()
        .route(
            "/billing/plans",
            get(controllers::billing::list_plans).post(controllers::billing::create_plan),
        )
        .route(
            "/billing/plans/{id}",
            patch(controllers::billing::update_plan),
        )
        .route(
            "/billing/subscription",
            get(controllers::billing::subscription),
        )
        .route("/billing/invoices", get(controllers::billing::invoices))
        .route(
            "/billing/admin/subscriptions",
            get(controllers::billing::admin_subscriptions),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            controllers::billing::require_enabled,
        ));

    let api = api
        .merge(billing)
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            timeout,
        ))
        .layer(middleware::from_fn(json_timeout));

    let cors = build_cors(&state.config.cors_origins);

    Router::new()
        .route(crate::metrics::METRICS_PATH, get(crate::metrics::scrape))
        .route("/ready", get(ready))
        .nest("/api/v1", api)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::audit::middleware,
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn(crate::metrics::middleware))
        .layer(middleware::from_fn(request_id))
        .layer(Extension(readiness))
        .with_state(state)
}

async fn health(State(_): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "service": "awg-admin",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn ready(Extension(readiness): Extension<Readiness>) -> Response {
    readiness_response(&readiness)
}

async fn dev_mail(State(state): State<Arc<AppState>>) -> Response {
    if dev_mail_disabled(&state) {
        return dev_mail_not_found();
    }
    axum::Json(crate::mailer::dev_mailbox().list()).into_response()
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
        axum::Json(serde_json::json!({
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
            axum::Json(serde_json::json!({
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
    (StatusCode::SERVICE_UNAVAILABLE, axum::Json(body)).into_response()
}

async fn json_timeout(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    if response.status() == StatusCode::GATEWAY_TIMEOUT {
        return timeout_response();
    }
    response
}

fn timeout_response() -> Response {
    (
        StatusCode::GATEWAY_TIMEOUT,
        axum::Json(serde_json::json!({
            "error": "gateway_timeout",
            "message": "request exceeded the configured timeout",
        })),
    )
        .into_response()
}

async fn request_id(mut request: Request, next: Next) -> Response {
    let id = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| valid_request_id(value))
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    if let Ok(value) = HeaderValue::from_str(&id) {
        request.headers_mut().insert(REQUEST_ID_HEADER, value);
    }

    let span = tracing::info_span!(
        "http_request",
        request_id = %id,
        method = %request.method(),
        path = %request.uri().path(),
    );
    let mut response = next.run(request).instrument(span).await;
    if let Ok(value) = HeaderValue::from_str(&id) {
        response.headers_mut().insert(REQUEST_ID_HEADER, value);
    }
    response
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_LEN
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn build_cors(origins: &[String]) -> CorsLayer {
    let request_id = HeaderName::from_static(REQUEST_ID_HEADER);
    let layer = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            request_id.clone(),
        ])
        .expose_headers([request_id]);
    if origins.is_empty() {
        return layer.allow_origin(Any);
    }
    let list: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    layer.allow_origin(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use awg_storage::{SCHEMA_VERSION_KEY, Table};
    use axum::body::{Body, to_bytes};
    use serde_json::Value;
    use tower::ServiceExt;

    fn test_readiness() -> Readiness {
        Readiness::new(Arc::new(Store::open_in_memory().unwrap()))
    }

    fn request(uri: &str) -> axum::http::Request<Body> {
        axum::http::Request::builder()
            .uri(uri)
            .body(Body::empty())
            .unwrap()
    }

    async fn json_body(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn request_id_is_generated_when_missing() {
        let app = Router::new()
            .route("/ping", get(|| async { "pong" }))
            .layer(middleware::from_fn(request_id));

        let response = app.oneshot(request("/ping")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let id = response
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .unwrap();
        assert!(Uuid::parse_str(id).is_ok(), "unexpected request id: {id}");
    }

    #[tokio::test]
    async fn request_id_is_propagated_when_valid() {
        let app = Router::new()
            .route("/ping", get(|| async { "pong" }))
            .layer(middleware::from_fn(request_id));

        let request = axum::http::Request::builder()
            .uri("/ping")
            .header(REQUEST_ID_HEADER, "client-request-42")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();

        assert_eq!(
            response
                .headers()
                .get(REQUEST_ID_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some("client-request-42")
        );
    }

    #[tokio::test]
    async fn request_id_rejects_malformed_values() {
        let app = Router::new()
            .route("/ping", get(|| async { "pong" }))
            .layer(middleware::from_fn(request_id));

        let request = axum::http::Request::builder()
            .uri("/ping")
            .header(REQUEST_ID_HEADER, "bad id with spaces")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();

        let id = response
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .unwrap();
        assert_ne!(id, "bad id with spaces");
        assert!(Uuid::parse_str(id).is_ok());
    }

    #[tokio::test]
    async fn timeout_returns_json_gateway_timeout() {
        let app = Router::new()
            .route(
                "/slow",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    "late"
                }),
            )
            .layer(TimeoutLayer::with_status_code(
                StatusCode::GATEWAY_TIMEOUT,
                Duration::from_millis(20),
            ))
            .layer(middleware::from_fn(json_timeout));

        let response = app.oneshot(request("/slow")).await.unwrap();

        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        let body = json_body(response).await;
        assert_eq!(body["error"], "gateway_timeout");
    }

    #[tokio::test]
    async fn readiness_reports_ready_with_working_store() {
        let app = Router::new()
            .route("/ready", get(ready))
            .layer(Extension(test_readiness()));

        let response = app.oneshot(request("/ready")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["status"], "ready");
        assert_eq!(body["schema_version"], CURRENT_SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn readiness_reports_shutdown_in_progress() {
        let readiness = test_readiness();
        readiness.mark_shutting_down();
        assert!(readiness.is_shutting_down());

        let app = Router::new()
            .route("/ready", get(ready))
            .layer(Extension(readiness));

        let response = app.oneshot(request("/ready")).await.unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = json_body(response).await;
        assert_eq!(body["reason"], "shutting_down");
    }

    #[tokio::test]
    async fn readiness_reports_missing_schema_version() {
        let store = Arc::new(Store::open_in_memory().unwrap());
        store.delete(Table::Meta, SCHEMA_VERSION_KEY).unwrap();
        let app = Router::new()
            .route("/ready", get(ready))
            .layer(Extension(Readiness::new(store)));

        let response = app.oneshot(request("/ready")).await.unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = json_body(response).await;
        assert_eq!(body["reason"], "schema_unavailable");
    }

    #[test]
    fn request_id_validation_rules() {
        assert!(valid_request_id("abc-123_def.456"));
        assert!(valid_request_id(&"a".repeat(MAX_REQUEST_ID_LEN)));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("with space"));
        assert!(!valid_request_id("with/slash"));
        assert!(!valid_request_id(&"a".repeat(MAX_REQUEST_ID_LEN + 1)));
    }
}
