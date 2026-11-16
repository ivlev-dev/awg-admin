use std::sync::Arc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};
use subtle::ConstantTimeEq;

use crate::state::AppState;

pub const CONTENT_TYPE: &str = "text/plain; version=0.0.4";
pub const METRICS_PATH: &str = "/metrics";

const API_PREFIX: &str = "/api/v1";
const DURATION_BUCKETS: [f64; 9] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0];

pub struct Metrics {
    registry: Registry,
    http_requests_total: IntCounterVec,
    http_request_duration_seconds: HistogramVec,
    auth_logins_total: IntCounterVec,
    rate_limited_total: IntCounterVec,
    audit_events_total: IntCounterVec,
    worker_online: IntGauge,
}

impl Metrics {
    pub fn new() -> Self {
        let registry = Registry::new();

        let http_requests_total = IntCounterVec::new(
            Opts::new(
                "awg_http_requests_total",
                "Total number of admin HTTP requests",
            ),
            &["method", "status"],
        )
        .expect("valid http requests metric");
        let http_request_duration_seconds = HistogramVec::new(
            HistogramOpts::new(
                "awg_http_request_duration_seconds",
                "Admin HTTP request latency in seconds",
            )
            .buckets(DURATION_BUCKETS.to_vec()),
            &["method"],
        )
        .expect("valid http duration metric");
        let auth_logins_total = IntCounterVec::new(
            Opts::new("awg_auth_logins_total", "Login attempts by result"),
            &["result"],
        )
        .expect("valid auth logins metric");
        let rate_limited_total = IntCounterVec::new(
            Opts::new(
                "awg_rate_limited_total",
                "Rejected requests by rate limiter scope",
            ),
            &["scope"],
        )
        .expect("valid rate limit metric");
        let audit_events_total = IntCounterVec::new(
            Opts::new("awg_audit_events_total", "Recorded audit events"),
            &["action", "status"],
        )
        .expect("valid audit metric");
        let worker_online = IntGauge::new("awg_worker_online", "Number of connected workers")
            .expect("valid worker gauge");

        for collector in [
            Box::new(http_requests_total.clone()) as Box<dyn prometheus::core::Collector>,
            Box::new(http_request_duration_seconds.clone()),
            Box::new(auth_logins_total.clone()),
            Box::new(rate_limited_total.clone()),
            Box::new(audit_events_total.clone()),
            Box::new(worker_online.clone()),
        ] {
            registry
                .register(collector)
                .expect("metrics registered once");
        }

        Self {
            registry,
            http_requests_total,
            http_request_duration_seconds,
            auth_logins_total,
            rate_limited_total,
            audit_events_total,
            worker_online,
        }
    }

    pub fn record_http(&self, method: &str, status: u16, duration: Duration) {
        let status = status.to_string();
        self.http_requests_total
            .with_label_values(&[method, &status])
            .inc();
        self.http_request_duration_seconds
            .with_label_values(&[method])
            .observe(duration.as_secs_f64());
    }

    pub fn record_login(&self, result: &str) {
        self.auth_logins_total.with_label_values(&[result]).inc();
    }

    pub fn record_rate_limited(&self, scope: &str) {
        self.rate_limited_total.with_label_values(&[scope]).inc();
    }

    pub fn record_audit(&self, action: &str, status: u16) {
        let status = status.to_string();
        self.audit_events_total
            .with_label_values(&[action, &status])
            .inc();
    }

    pub fn set_workers_online(&self, online: usize) {
        self.worker_online.set(online as i64);
    }

    pub fn render(&self) -> String {
        let mut buffer = Vec::new();
        if let Err(error) = TextEncoder::new().encode(&self.registry.gather(), &mut buffer) {
            tracing::warn!(%error, "failed to encode metrics");
            return String::new();
        }
        String::from_utf8_lossy(&buffer).into_owned()
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

static GLOBAL: LazyLock<Metrics> = LazyLock::new(Metrics::new);

pub fn record_http(method: &str, status: u16, duration: Duration) {
    GLOBAL.record_http(method, status, duration);
}

pub fn record_login(result: &str) {
    GLOBAL.record_login(result);
}

pub fn record_rate_limited(scope: &str) {
    GLOBAL.record_rate_limited(scope);
}

pub fn record_audit(action: &str, status: u16) {
    GLOBAL.record_audit(action, status);
}

pub async fn middleware(request: Request, next: Next) -> Response {
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    let started = Instant::now();
    let response = next.run(request).await;
    if path.starts_with(API_PREFIX) && path != METRICS_PATH {
        record_http(&method, response.status().as_u16(), started.elapsed());
    }
    response
}

pub async fn scrape(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let online = state.registry.presence().len();
    scrape_with(state.config.metrics_token.as_deref(), online, &headers)
}

fn scrape_with(expected: Option<&str>, workers_online: usize, headers: &HeaderMap) -> Response {
    if let Some(expected) = expected
        && !token_matches(expected, headers)
    {
        let mut response = (StatusCode::UNAUTHORIZED, "unauthorized\n").into_response();
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        return response;
    }

    GLOBAL.set_workers_online(workers_online);
    let mut response = GLOBAL.render().into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(CONTENT_TYPE));
    response
}

fn token_matches(expected: &str, headers: &HeaderMap) -> bool {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(token) = value.trim().strip_prefix("Bearer ") else {
        return false;
    };
    token.trim().as_bytes().ct_eq(expected.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    impl Metrics {
        fn counter(&self, name: &str, labels: &[(&str, &str)]) -> f64 {
            self.registry
                .gather()
                .iter()
                .filter(|family| family.name() == name)
                .flat_map(|family| family.get_metric())
                .filter(|metric| {
                    labels.iter().all(|(key, value)| {
                        metric
                            .get_label()
                            .iter()
                            .any(|label| label.name() == *key && label.value() == *value)
                    })
                })
                .map(|metric| metric.get_counter().get_value())
                .next()
                .unwrap_or(0.0)
        }

        fn histogram_count(&self, name: &str, method: &str) -> u64 {
            self.registry
                .gather()
                .iter()
                .filter(|family| family.name() == name)
                .flat_map(|family| family.get_metric())
                .find(|metric| {
                    metric
                        .get_label()
                        .iter()
                        .any(|label| label.name() == "method" && label.value() == method)
                })
                .map(|metric| metric.get_histogram().get_sample_count())
                .unwrap_or(0)
        }

        fn gauge(&self, name: &str) -> f64 {
            self.registry
                .gather()
                .iter()
                .filter(|family| family.name() == name)
                .flat_map(|family| family.get_metric())
                .map(|metric| metric.get_gauge().get_value())
                .next()
                .unwrap_or(0.0)
        }
    }

    fn headers_with(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, value.parse().unwrap());
        headers
    }

    #[test]
    fn http_metrics_are_counted() {
        let metrics = Metrics::new();
        metrics.record_http("GET", 200, Duration::from_millis(3));
        metrics.record_http("GET", 200, Duration::from_millis(4));
        metrics.record_http("POST", 500, Duration::from_secs(1));

        assert_eq!(
            metrics.counter(
                "awg_http_requests_total",
                &[("method", "GET"), ("status", "200")]
            ),
            2.0
        );
        assert_eq!(
            metrics.counter(
                "awg_http_requests_total",
                &[("method", "POST"), ("status", "500")]
            ),
            1.0
        );
        assert_eq!(
            metrics.histogram_count("awg_http_request_duration_seconds", "GET"),
            2
        );
    }

    #[test]
    fn domain_metrics_are_counted() {
        let metrics = Metrics::new();
        metrics.record_login("success");
        metrics.record_login("success");
        metrics.record_login("failure");
        metrics.record_login("rate_limited");
        metrics.record_rate_limited("login");
        metrics.record_rate_limited("refresh");
        metrics.record_audit("POST", 201);

        assert_eq!(
            metrics.counter("awg_auth_logins_total", &[("result", "success")]),
            2.0
        );
        assert_eq!(
            metrics.counter("awg_auth_logins_total", &[("result", "failure")]),
            1.0
        );
        assert_eq!(
            metrics.counter("awg_auth_logins_total", &[("result", "rate_limited")]),
            1.0
        );
        assert_eq!(
            metrics.counter("awg_rate_limited_total", &[("scope", "login")]),
            1.0
        );
        assert_eq!(
            metrics.counter("awg_rate_limited_total", &[("scope", "refresh")]),
            1.0
        );
        assert_eq!(
            metrics.counter(
                "awg_audit_events_total",
                &[("action", "POST"), ("status", "201")]
            ),
            1.0
        );
    }

    #[test]
    fn worker_gauge_reflects_registry_size() {
        let metrics = Metrics::new();
        metrics.set_workers_online(3);
        assert_eq!(metrics.gauge("awg_worker_online"), 3.0);
        metrics.set_workers_online(0);
        assert_eq!(metrics.gauge("awg_worker_online"), 0.0);
    }

    #[test]
    fn render_exposes_text_format() {
        let metrics = Metrics::new();
        metrics.set_workers_online(1);
        metrics.record_http("GET", 204, Duration::from_millis(1));
        let body = metrics.render();
        assert!(body.contains("awg_http_requests_total{method=\"GET\",status=\"204\"} 1"));
        assert!(body.contains("awg_http_request_duration_seconds_bucket"));
        assert!(body.contains("awg_worker_online 1"));
    }

    #[test]
    fn token_is_required_when_configured() {
        let response = scrape_with(Some("secret"), 2, &HeaderMap::new());
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = scrape_with(Some("secret"), 2, &headers_with("Bearer wrong"));
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn token_grants_access_and_sets_content_type() {
        let response = scrape_with(Some("secret"), 2, &headers_with("Bearer secret"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some(CONTENT_TYPE)
        );
    }

    #[test]
    fn scrape_is_open_without_token() {
        let response = scrape_with(None, 0, &HeaderMap::new());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some(CONTENT_TYPE)
        );
    }
}
