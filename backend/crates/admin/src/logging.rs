use anyhow::{Result, bail};
use tracing_subscriber::EnvFilter;

pub const LOG_FORMAT_ENV: &str = "AWG_LOG_FORMAT";
pub const DEFAULT_LOG_FILTER: &str = "info";

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
    if !try_init(format) {
        eprintln!("tracing subscriber is already installed");
    }
}

pub fn try_init(format: LogFormat) -> bool {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    let result = match format {
        LogFormat::Json => builder.json().try_init(),
        LogFormat::Text => builder.try_init(),
    };
    result.is_ok()
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
    fn json_subscriber_is_installed() {
        assert!(try_init(LogFormat::Json));
        assert!(!try_init(LogFormat::Text));
    }
}
