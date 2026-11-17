use anyhow::{Result, bail};
use opentelemetry::trace::TracerProvider as _;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub const LOG_FORMAT_ENV: &str = "AWG_LOG_FORMAT";
pub const OTEL_ENDPOINT_ENV: &str = "AWG_OTEL_ENDPOINT";
pub const DEFAULT_LOG_FILTER: &str = "info";
const SERVICE_NAME: &str = "awg-admin";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Text,
    Json,
}

impl LogFormat {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "text" | "plain" => Ok(Self::Text),
            "json" => Ok(Self::Json),
            other => bail!("{LOG_FORMAT_ENV} must be json or text, got {other:?}"),
        }
    }

    pub fn from_env() -> Result<Self> {
        match std::env::var(LOG_FORMAT_ENV) {
            Ok(value) => Self::parse(&value),
            Err(_) => Ok(Self::Text),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Json => "json",
        }
    }
}

pub fn init(format: LogFormat) {
    let endpoint = otel_endpoint_from_env();
    if !try_init_with_otel(format, endpoint.as_deref()) {
        eprintln!("tracing subscriber is already installed");
    }
}

#[cfg(test)]
pub fn try_init(format: LogFormat) -> bool {
    try_init_with_otel(format, None)
}

pub fn try_init_with_otel(format: LogFormat, endpoint: Option<&str>) -> bool {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));
    let tracer = match endpoint.and_then(valid_endpoint) {
        Some(endpoint) => match build_tracer(endpoint) {
            Ok(tracer) => Some(tracer),
            Err(error) => {
                eprintln!("failed to initialise OpenTelemetry exporter: {error}");
                None
            }
        },
        None => None,
    };
    let result = match (format, tracer) {
        (LogFormat::Json, Some(tracer)) => tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json())
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .try_init(),
        (LogFormat::Json, None) => tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json())
            .try_init(),
        (LogFormat::Text, Some(tracer)) => tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .try_init(),
        (LogFormat::Text, None) => tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .try_init(),
    };
    result.is_ok()
}

fn build_tracer(endpoint: &str) -> Result<opentelemetry_sdk::trace::Tracer> {
    use opentelemetry_otlp::WithExportConfig;

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()?;
    let resource = opentelemetry_sdk::Resource::builder()
        .with_service_name(SERVICE_NAME)
        .build();
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build();
    let tracer = provider.tracer(SERVICE_NAME);
    opentelemetry::global::set_tracer_provider(provider);
    Ok(tracer)
}

fn otel_endpoint_from_env() -> Option<String> {
    std::env::var(OTEL_ENDPOINT_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn valid_endpoint(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Some(trimmed)
    } else {
        eprintln!("{OTEL_ENDPOINT_ENV} must start with http:// or https://, got {trimmed:?}");
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_is_parsed_from_env_style_values() {
        assert_eq!(LogFormat::parse("json").unwrap(), LogFormat::Json);
        assert_eq!(LogFormat::parse(" JSON ").unwrap(), LogFormat::Json);
        assert_eq!(LogFormat::parse("text").unwrap(), LogFormat::Text);
        assert_eq!(LogFormat::parse("").unwrap(), LogFormat::Text);
        assert!(LogFormat::parse("logfmt").is_err());
        assert_eq!(LogFormat::Json.as_str(), "json");
        assert_eq!(LogFormat::Text.as_str(), "text");
    }

    #[test]
    fn endpoint_requires_http_scheme() {
        assert_eq!(
            valid_endpoint(" http://localhost:4317 "),
            Some("http://localhost:4317")
        );
        assert_eq!(
            valid_endpoint("https://otel.example.com"),
            Some("https://otel.example.com")
        );
        assert_eq!(valid_endpoint("localhost:4317"), None);
        assert_eq!(valid_endpoint(""), None);
    }

    #[test]
    fn json_subscriber_is_installed() {
        assert!(try_init(LogFormat::Json));
        assert!(!try_init(LogFormat::Text));
    }
}
