use std::net::SocketAddr;

use anyhow::{Context, Result, bail};
use awg_shared::crypto::random_bytes;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

pub const DEFAULT_ADMIN_PASSWORD: &str = "admin12345";
pub const MASTER_KEY_LEN: usize = 32;
pub const MIN_JWT_SECRET_LEN: usize = 32;
pub const DEFAULT_JWT_ISSUER: &str = "awg-admin";
pub const DEFAULT_JWT_AUDIENCE: &str = "awg-admin";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Production,
}

impl Environment {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "development" | "dev" => Ok(Self::Development),
            "production" | "prod" => Ok(Self::Production),
            other => bail!("AWG_ENV must be development or production, got {other:?}"),
        }
    }

    pub fn is_production(self) -> bool {
        matches!(self, Self::Production)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Production => "production",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailMode {
    Log,
    Smtp,
}

impl MailMode {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "log" => Ok(Self::Log),
            "smtp" => Ok(Self::Smtp),
            other => bail!("AWG_MAIL_MODE must be log or smtp, got {other:?}"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Log => "log",
            Self::Smtp => "smtp",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigInput {
    pub environment: Environment,
    pub bind: String,
    pub grpc_bind: String,
    pub db_path: String,
    pub master_key: Option<String>,
    pub jwt_secret: Option<String>,
    pub jwt_issuer: String,
    pub jwt_audience: String,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    pub admin_login: String,
    pub admin_password: String,
    pub dns: String,
    pub cors_origins: String,
    pub share_ttl_secs: u64,
    pub public_url: String,
    pub login_rate_limit: u32,
    pub login_rate_window_secs: u64,
    pub refresh_rate_limit: u32,
    pub refresh_rate_window_secs: u64,
    pub register_rate_limit: u32,
    pub register_rate_window_secs: u64,
    pub resend_rate_limit: u32,
    pub resend_rate_window_secs: u64,
    pub mail_mode: String,
    pub smtp_url: Option<String>,
    pub smtp_from: Option<String>,
    pub metrics_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub environment: Environment,
    pub bind: SocketAddr,
    pub grpc_bind: SocketAddr,
    pub db_path: String,
    pub master_key: String,
    pub jwt_secret: Vec<u8>,
    pub jwt_issuer: String,
    pub jwt_audience: String,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    pub admin_login: String,
    pub admin_password: String,
    pub dns: Vec<String>,
    pub cors_origins: Vec<String>,
    pub share_ttl_secs: u64,
    pub public_url: String,
    pub login_rate_limit: u32,
    pub login_rate_window_secs: u64,
    pub refresh_rate_limit: u32,
    pub refresh_rate_window_secs: u64,
    pub register_rate_limit: u32,
    pub register_rate_window_secs: u64,
    pub resend_rate_limit: u32,
    pub resend_rate_window_secs: u64,
    pub mail_mode: MailMode,
    pub smtp_url: Option<String>,
    pub smtp_from: Option<String>,
    pub metrics_token: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Self::from_input(input_from_env()?)
    }

    pub fn is_production(&self) -> bool {
        self.environment.is_production()
    }

    pub fn from_input(input: ConfigInput) -> Result<Self> {
        let production = input.environment.is_production();

        let bind = input.bind.parse().context("AWG_BIND must be host:port")?;
        let grpc_bind = input
            .grpc_bind
            .parse()
            .context("AWG_GRPC_BIND must be host:port")?;

        let master_key = match non_empty(&input.master_key) {
            Some(value) => {
                decode_master_key(value)?;
                value.trim().to_string()
            }
            None if production => bail!(
                "AWG_MASTER_KEY is required in production (generate with `openssl rand -base64 32`)"
            ),
            None => {
                tracing::warn!(
                    "AWG_MASTER_KEY is not set; generated an ephemeral key. Stored device secrets will be unreadable after restart"
                );
                STANDARD.encode(random_bytes::<32>())
            }
        };

        let jwt_secret = match non_empty(&input.jwt_secret) {
            Some(value) => {
                let secret = value.as_bytes().to_vec();
                if production && secret.len() < MIN_JWT_SECRET_LEN {
                    bail!(
                        "AWG_JWT_SECRET must be at least {MIN_JWT_SECRET_LEN} bytes in production (generate with `openssl rand -base64 48`)"
                    );
                }
                secret
            }
            None if production => bail!(
                "AWG_JWT_SECRET is required in production (generate with `openssl rand -base64 48`)"
            ),
            None => {
                tracing::warn!("AWG_JWT_SECRET is not set; generated an ephemeral secret");
                random_bytes::<48>().to_vec()
            }
        };

        let jwt_issuer = trimmed_or(&input.jwt_issuer, DEFAULT_JWT_ISSUER);
        let jwt_audience = trimmed_or(&input.jwt_audience, DEFAULT_JWT_AUDIENCE);

        if production {
            validate_production_admin_password(&input.admin_password)?;
        }

        let dns = input
            .dns
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let cors_origins = input
            .cors_origins
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let metrics_token = non_empty(&input.metrics_token).map(|value| value.trim().to_string());
        if metrics_token.is_none() {
            if production {
                tracing::warn!(
                    "AWG_METRICS_TOKEN is not set; /metrics is served without authentication and must not be reachable from untrusted networks"
                );
            } else {
                tracing::warn!(
                    "AWG_METRICS_TOKEN is not set; /metrics is served without authentication"
                );
            }
        }

        let mail_mode = MailMode::parse(&input.mail_mode)?;
        let smtp_url = non_empty(&input.smtp_url).map(|value| value.trim().to_string());
        let smtp_from = non_empty(&input.smtp_from).map(|value| value.trim().to_string());
        if mail_mode == MailMode::Smtp && (smtp_url.is_none() || smtp_from.is_none()) {
            bail!("AWG_SMTP_URL and AWG_SMTP_FROM are required when AWG_MAIL_MODE=smtp");
        }

        Ok(Self {
            environment: input.environment,
            bind,
            grpc_bind,
            db_path: input.db_path,
            master_key,
            jwt_secret,
            jwt_issuer,
            jwt_audience,
            access_ttl_secs: input.access_ttl_secs,
            refresh_ttl_secs: input.refresh_ttl_secs,
            admin_login: input.admin_login,
            admin_password: input.admin_password,
            dns,
            cors_origins,
            share_ttl_secs: input.share_ttl_secs,
            public_url: input.public_url,
            login_rate_limit: input.login_rate_limit,
            login_rate_window_secs: input.login_rate_window_secs.max(1),
            refresh_rate_limit: input.refresh_rate_limit,
            refresh_rate_window_secs: input.refresh_rate_window_secs.max(1),
            register_rate_limit: input.register_rate_limit,
            register_rate_window_secs: input.register_rate_window_secs.max(1),
            resend_rate_limit: input.resend_rate_limit,
            resend_rate_window_secs: input.resend_rate_window_secs.max(1),
            mail_mode,
            smtp_url,
            smtp_from,
            metrics_token,
        })
    }
}

fn validate_production_admin_password(password: &str) -> Result<()> {
    if password.trim().is_empty() {
        bail!("AWG_ADMIN_PASSWORD must not be empty in production");
    }
    if password == DEFAULT_ADMIN_PASSWORD {
        bail!(
            "AWG_ADMIN_PASSWORD must be changed from the default value in production (set a unique password)"
        );
    }
    Ok(())
}

fn decode_master_key(raw: &str) -> Result<()> {
    let bytes = STANDARD
        .decode(raw.trim())
        .context("AWG_MASTER_KEY must be 32 bytes of base64")?;
    if bytes.len() != MASTER_KEY_LEN {
        bail!("AWG_MASTER_KEY must be 32 bytes of base64");
    }
    Ok(())
}

fn non_empty(value: &Option<String>) -> Option<&String> {
    value.as_ref().filter(|value| !value.trim().is_empty())
}

fn trimmed_or(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn input_from_env() -> Result<ConfigInput> {
    Ok(ConfigInput {
        environment: Environment::parse(
            &env_optional("AWG_ENV").unwrap_or_else(|| "development".into()),
        )?,
        bind: env("AWG_BIND", "0.0.0.0:8080"),
        grpc_bind: env("AWG_GRPC_BIND", "0.0.0.0:9090"),
        db_path: env("AWG_DB_PATH", "/data/awg-admin.redb"),
        master_key: env_optional("AWG_MASTER_KEY"),
        jwt_secret: env_optional("AWG_JWT_SECRET"),
        jwt_issuer: env("AWG_JWT_ISSUER", DEFAULT_JWT_ISSUER),
        jwt_audience: env("AWG_JWT_AUDIENCE", DEFAULT_JWT_AUDIENCE),
        access_ttl_secs: env_u64("AWG_ACCESS_TTL_SECS", 900),
        refresh_ttl_secs: env_u64("AWG_REFRESH_TTL_SECS", 30 * 86_400),
        admin_login: env("AWG_ADMIN_LOGIN", "admin"),
        admin_password: env("AWG_ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD),
        dns: env("AWG_DNS", "1.1.1.1,8.8.8.8"),
        cors_origins: env("AWG_CORS_ORIGINS", ""),
        share_ttl_secs: env_u64("AWG_SHARE_TTL_SECS", 86_400),
        public_url: env("AWG_PUBLIC_URL", ""),
        login_rate_limit: env_u32("AWG_LOGIN_RATE_LIMIT", 10),
        login_rate_window_secs: env_u64("AWG_LOGIN_RATE_WINDOW_SECS", 300),
        refresh_rate_limit: env_u32("AWG_REFRESH_RATE_LIMIT", 60),
        refresh_rate_window_secs: env_u64("AWG_REFRESH_RATE_WINDOW_SECS", 300),
        register_rate_limit: env_u32("AWG_REGISTER_RATE_LIMIT", 5),
        register_rate_window_secs: env_u64("AWG_REGISTER_RATE_WINDOW_SECS", 300),
        resend_rate_limit: env_u32("AWG_RESEND_RATE_LIMIT", 5),
        resend_rate_window_secs: env_u64("AWG_RESEND_RATE_WINDOW_SECS", 300),
        mail_mode: env("AWG_MAIL_MODE", "log"),
        smtp_url: env_optional("AWG_SMTP_URL"),
        smtp_from: env_optional("AWG_SMTP_FROM"),
        metrics_token: env_optional("AWG_METRICS_TOKEN"),
    })
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_master_key() -> String {
        STANDARD.encode([7u8; MASTER_KEY_LEN])
    }

    fn base_input(environment: Environment) -> ConfigInput {
        ConfigInput {
            environment,
            bind: "127.0.0.1:8080".into(),
            grpc_bind: "127.0.0.1:9090".into(),
            db_path: "/tmp/awg-admin-test.redb".into(),
            master_key: Some(valid_master_key()),
            jwt_secret: Some("test-secret-that-is-long-enough-32+".into()),
            jwt_issuer: DEFAULT_JWT_ISSUER.into(),
            jwt_audience: DEFAULT_JWT_AUDIENCE.into(),
            access_ttl_secs: 900,
            refresh_ttl_secs: 86_400,
            admin_login: "admin".into(),
            admin_password: "super-secret-password".into(),
            dns: "1.1.1.1,8.8.8.8".into(),
            cors_origins: String::new(),
            share_ttl_secs: 3600,
            public_url: String::new(),
            login_rate_limit: 10,
            login_rate_window_secs: 300,
            refresh_rate_limit: 60,
            refresh_rate_window_secs: 300,
            register_rate_limit: 5,
            register_rate_window_secs: 300,
            resend_rate_limit: 5,
            resend_rate_window_secs: 300,
            mail_mode: "log".into(),
            smtp_url: None,
            smtp_from: None,
            metrics_token: None,
        }
    }

    #[test]
    fn environment_parsing() {
        assert_eq!(
            Environment::parse("development").unwrap(),
            Environment::Development
        );
        assert_eq!(
            Environment::parse(" PROD ").unwrap(),
            Environment::Production
        );
        assert!(Environment::parse("staging").is_err());
    }

    #[test]
    fn production_accepts_valid_config() {
        let config = Config::from_input(base_input(Environment::Production)).unwrap();
        assert!(config.is_production());
        assert_eq!(config.master_key, valid_master_key());
    }

    #[test]
    fn production_requires_master_key() {
        let mut input = base_input(Environment::Production);
        input.master_key = None;
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_MASTER_KEY is required in production"));
    }

    #[test]
    fn production_rejects_invalid_master_key() {
        let mut input = base_input(Environment::Production);
        input.master_key = Some("not-base64".into());
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_MASTER_KEY must be 32 bytes"));

        let mut input = base_input(Environment::Production);
        input.master_key = Some(STANDARD.encode([1u8; 16]));
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_MASTER_KEY must be 32 bytes"));
    }

    #[test]
    fn production_requires_jwt_secret() {
        let mut input = base_input(Environment::Production);
        input.jwt_secret = Some("   ".into());
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_JWT_SECRET is required in production"));
    }

    #[test]
    fn production_rejects_short_jwt_secret() {
        let mut input = base_input(Environment::Production);
        input.jwt_secret = Some("too-short".into());
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_JWT_SECRET must be at least 32 bytes"));
    }

    #[test]
    fn jwt_issuer_and_audience_have_defaults() {
        let mut input = base_input(Environment::Development);
        input.jwt_issuer = "  ".into();
        input.jwt_audience = String::new();
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.jwt_issuer, DEFAULT_JWT_ISSUER);
        assert_eq!(config.jwt_audience, DEFAULT_JWT_AUDIENCE);
    }

    #[test]
    fn production_rejects_default_admin_password() {
        let mut input = base_input(Environment::Production);
        input.admin_password = DEFAULT_ADMIN_PASSWORD.into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_ADMIN_PASSWORD must be changed"));

        let mut input = base_input(Environment::Production);
        input.admin_password = String::new();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_ADMIN_PASSWORD must not be empty"));
    }

    #[test]
    fn development_generates_ephemeral_secrets() {
        let mut input = base_input(Environment::Development);
        input.master_key = None;
        input.jwt_secret = None;
        input.admin_password = DEFAULT_ADMIN_PASSWORD.into();

        let config = Config::from_input(input).unwrap();
        assert!(!config.master_key.is_empty());
        assert_eq!(config.jwt_secret.len(), 48);
        assert_eq!(config.admin_password, DEFAULT_ADMIN_PASSWORD);
    }

    #[test]
    fn development_still_rejects_malformed_master_key() {
        let mut input = base_input(Environment::Development);
        input.master_key = Some("garbage".into());
        assert!(Config::from_input(input).is_err());
    }

    #[test]
    fn rate_limit_windows_have_a_floor() {
        let mut input = base_input(Environment::Development);
        input.login_rate_window_secs = 0;
        input.refresh_rate_window_secs = 0;
        input.register_rate_window_secs = 0;
        input.resend_rate_window_secs = 0;
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.login_rate_window_secs, 1);
        assert_eq!(config.refresh_rate_window_secs, 1);
        assert_eq!(config.register_rate_window_secs, 1);
        assert_eq!(config.resend_rate_window_secs, 1);
    }

    #[test]
    fn mail_mode_defaults_to_log_and_validates_smtp() {
        let mut input = base_input(Environment::Development);
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.mail_mode, MailMode::Log);

        input.mail_mode = " SMTP ".into();
        assert!(Config::from_input(input.clone()).is_err());

        input.smtp_url = Some("smtp://user:pass@localhost:2525".into());
        input.smtp_from = Some("panel@localhost".into());
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.mail_mode, MailMode::Smtp);
        assert_eq!(config.smtp_from.as_deref(), Some("panel@localhost"));

        input.mail_mode = "telegram".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_MAIL_MODE must be log or smtp"));
    }

    #[test]
    fn metrics_token_is_optional_and_trimmed() {
        let mut input = base_input(Environment::Development);
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.metrics_token, None);

        input.metrics_token = Some("  scrape-token  ".into());
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.metrics_token.as_deref(), Some("scrape-token"));

        input.metrics_token = Some("   ".into());
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.metrics_token, None);
    }

    #[test]
    fn production_is_production() {
        assert!(!Environment::Development.is_production());
        assert!(Environment::Production.is_production());
        assert_eq!(Environment::Production.as_str(), "production");
    }
}
