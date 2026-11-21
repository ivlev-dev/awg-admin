use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::cors::CorsLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::Instrument;
use uuid::Uuid;

use crate::state::AppState;

mod app;
mod auth;
mod billing;
mod clients;
mod network;
mod stats;
mod system;

pub const REQUEST_ID_HEADER: &str = "x-request-id";
const MAX_REQUEST_ID_LEN: usize = 128;
const BODY_LIMIT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub struct Readiness {
    store: Arc<awg_storage::Store>,
    shutting_down: Arc<AtomicBool>,
}

impl Readiness {
    pub fn new(store: Arc<awg_storage::Store>) -> Self {
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
        .merge(system::router())
        .merge(auth::router())
        .merge(network::router())
        .merge(clients::router())
        .merge(app::router())
        .merge(stats::router())
        .merge(billing::router(state.clone()))
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            timeout,
        ))
        .layer(middleware::from_fn(json_timeout));

    let cors = build_cors(&state.config.cors_origins);

    Router::new()
        .route(crate::metrics::METRICS_PATH, get(crate::metrics::scrape))
        .route("/ready", get(system::ready))
        .nest("/api/v1", api)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::idempotency::middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::audit::middleware,
        ))
        .layer(cors)
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request| {
                let request_id = request
                    .headers()
                    .get(REQUEST_ID_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("-");
                tracing::info_span!(
                    "http",
                    request_id = %request_id,
                    method = %request.method(),
                    path = %request.uri().path(),
                )
            }),
        )
        .layer(middleware::from_fn(crate::metrics::middleware))
        .layer(middleware::from_fn(request_id))
        .layer(axum::Extension(readiness))
        .with_state(state)
}

async fn json_timeout(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    // Only replace the empty body produced by `TimeoutLayer`. A handler that
    // already returned a JSON 504 keeps its own payload.
    if response.status() == StatusCode::GATEWAY_TIMEOUT
        && response.headers().get(header::CONTENT_TYPE).is_none()
    {
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
    let idempotency_key = HeaderName::from_static(crate::idempotency::IDEMPOTENCY_HEADER);
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
            idempotency_key,
        ])
        .expose_headers([request_id]);
    if origins.is_empty() {
        // Same-origin requests do not need CORS headers. Adding
        // `Access-Control-Allow-Origin: *` here would let any website call the
        // API with a user's credentials, so an empty allow-list rejects
        // cross-origin browser traffic.
        return layer;
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
    use awg_storage::{SCHEMA_VERSION_KEY, Store, Table};
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
            .route("/ready", get(system::ready))
            .layer(axum::Extension(test_readiness()));

        let response = app.oneshot(request("/ready")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["status"], "ready");
        assert_eq!(body["service"], "awg-admin");
        assert!(
            body.get("version").is_none(),
            "readiness must not expose the crate version"
        );
        assert!(
            body.get("schema_version").is_none(),
            "readiness must not expose the storage schema version"
        );
    }

    #[tokio::test]
    async fn readiness_reports_shutdown_in_progress() {
        let readiness = test_readiness();
        readiness.mark_shutting_down();
        assert!(readiness.is_shutting_down());

        let app = Router::new()
            .route("/ready", get(system::ready))
            .layer(axum::Extension(readiness));

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
            .route("/ready", get(system::ready))
            .layer(axum::Extension(Readiness::new(store)));

        let response = app.oneshot(request("/ready")).await.unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = json_body(response).await;
        assert_eq!(body["reason"], "schema_unavailable");
    }

    #[test]
    fn bulk_routes_are_registered_without_conflicts() {
        let _app = Router::new()
            .merge(auth::router())
            .merge(network::router())
            .merge(clients::router())
            .merge(app::router())
            .merge(stats::router());
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
