use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;

use anyhow::{Context, Result, bail};
use awg_shared::crypto::random_bytes;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ipnet::IpNet;

pub const DEFAULT_ADMIN_PASSWORD: &str = "admin12345";
pub const DEFAULT_ADMIN_EMAIL: &str = "admin@local";
pub const MASTER_KEY_LEN: usize = 32;
pub const MIN_JWT_SECRET_LEN: usize = 32;
pub const DEFAULT_JWT_ISSUER: &str = "awg-admin";
pub const DEFAULT_JWT_AUDIENCE: &str = "awg-admin";
pub const DEFAULT_APP_VERIFY_URL: &str = "umbravpn://verify";

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
pub enum PaymentProvider {
    Noop,
    Mock,
    Stripe,
    Yookassa,
    Cloudpayments,
    TelegramStars,
}

impl PaymentProvider {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "noop" => Ok(Self::Noop),
            "mock" => Ok(Self::Mock),
            "stripe" => Ok(Self::Stripe),
            "yookassa" => Ok(Self::Yookassa),
            "cloudpayments" => Ok(Self::Cloudpayments),
            "telegram_stars" => Ok(Self::TelegramStars),
            other => bail!(
                "AWG_PAYMENT_PROVIDER must be noop, mock, stripe, yookassa, cloudpayments or telegram_stars, got {other:?}"
            ),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Noop => "noop",
            Self::Mock => "mock",
            Self::Stripe => "stripe",
            Self::Yookassa => "yookassa",
            Self::Cloudpayments => "cloudpayments",
            Self::TelegramStars => "telegram_stars",
        }
    }

    pub fn is_noop(self) -> bool {
        matches!(self, Self::Noop)
    }

    pub fn is_mock(self) -> bool {
        matches!(self, Self::Mock)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingConfig {
    pub enabled: bool,
    pub currency: String,
    pub trial_days: u32,
    pub provider: PaymentProvider,
    pub public_url: String,
}

impl BillingConfig {
    pub fn settings(&self) -> awg_billing::BillingSettings {
        awg_billing::BillingSettings::new(self.currency.clone(), self.trial_days, &self.public_url)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitStore {
    Memory,
    Redb,
}

impl RateLimitStore {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "memory" => Ok(Self::Memory),
            "redb" => Ok(Self::Redb),
            other => bail!("AWG_RATE_LIMIT_STORE must be memory or redb, got {other:?}"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::Redb => "redb",
        }
    }

    pub fn is_shared(self) -> bool {
        matches!(self, Self::Redb)
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
    pub admin_email: String,
    pub admin_password: String,
    pub dns: String,
    pub cors_origins: String,
    pub share_ttl_secs: u64,
    pub public_url: String,
    pub app_verify_url: String,
    pub trusted_proxies: String,
    pub dev_mail_token: Option<String>,
    pub rate_limit_store: String,
    pub login_rate_limit: u32,
    pub login_rate_window_secs: u64,
    pub refresh_rate_limit: u32,
    pub refresh_rate_window_secs: u64,
    pub register_rate_limit: u32,
    pub register_rate_window_secs: u64,
    pub resend_rate_limit: u32,
    pub resend_rate_window_secs: u64,
    pub forgot_rate_limit: u32,
    pub forgot_rate_window_secs: u64,
    pub http_timeout_secs: u64,
    pub shutdown_grace_secs: u64,
    pub mail_mode: String,
    pub smtp_url: Option<String>,
    pub smtp_from: Option<String>,
    pub metrics_token: Option<String>,
    pub billing_enabled: String,
    pub billing_currency: String,
    pub billing_trial_days: String,
    pub payment_provider: String,
    pub payment_secret: String,
    pub backup_dir: String,
    pub backup_interval_secs: u64,
    pub backup_keep: u64,
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
    pub admin_email: String,
    pub admin_password: String,
    pub dns: Vec<String>,
    pub cors_origins: Vec<String>,
    pub share_ttl_secs: u64,
    pub public_url: String,
    pub app_verify_url: String,
    pub trusted_proxies: Vec<IpNet>,
    pub dev_mail_token: Option<String>,
    pub rate_limit_store: RateLimitStore,
    pub login_rate_limit: u32,
    pub login_rate_window_secs: u64,
    pub refresh_rate_limit: u32,
    pub refresh_rate_window_secs: u64,
    pub register_rate_limit: u32,
    pub register_rate_window_secs: u64,
    pub resend_rate_limit: u32,
    pub resend_rate_window_secs: u64,
    pub forgot_rate_limit: u32,
    pub forgot_rate_window_secs: u64,
    pub http_timeout_secs: u64,
    pub shutdown_grace_secs: u64,
    pub mail_mode: MailMode,
    pub smtp_url: Option<String>,
    pub smtp_from: Option<String>,
    pub metrics_token: Option<String>,
    pub payment_secret: String,
    pub backup_dir: String,
    pub backup_interval_secs: u64,
    pub backup_keep: u64,
    pub billing: BillingConfig,
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

        let trusted_proxies = parse_trusted_proxies(&input.trusted_proxies)?;
        if trusted_proxies.is_empty() {
            tracing::warn!(
                "AWG_TRUSTED_PROXIES is empty; X-Forwarded-For and X-Real-IP are ignored and the direct peer address is used"
            );
        }

        let dev_mail_token = non_empty(&input.dev_mail_token).map(|value| value.trim().to_string());
        if production && dev_mail_token.is_some() {
            tracing::warn!(
                "AWG_DEV_MAIL_TOKEN is ignored in production because /dev/mail is disabled"
            );
        }

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

        let rate_limit_store = RateLimitStore::parse(&input.rate_limit_store)?;
        if production && !rate_limit_store.is_shared() {
            tracing::warn!(
                "AWG_RATE_LIMIT_STORE=memory keeps login/refresh limits per process; set AWG_RATE_LIMIT_STORE=redb when running more than one admin replica"
            );
        }

        let billing_enabled = parse_bool("AWG_BILLING_ENABLED", &input.billing_enabled, false)?;
        let billing_currency = parse_currency(&input.billing_currency)?;
        let billing_trial_days = parse_trial_days(&input.billing_trial_days)?;
        let payment_provider = PaymentProvider::parse(&input.payment_provider)?;
        if production && billing_enabled && payment_provider.is_noop() {
            bail!(
                "AWG_PAYMENT_PROVIDER must not be noop in production when AWG_BILLING_ENABLED=true"
            );
        }
        let payment_secret = input.payment_secret.trim().to_string();
        if payment_provider.is_mock() {
            if production {
                bail!("AWG_PAYMENT_PROVIDER=mock is not allowed in production");
            }
            if payment_secret.len() < 32 {
                bail!(
                    "AWG_PAYMENT_SECRET must be at least 32 characters when AWG_PAYMENT_PROVIDER=mock"
                );
            }
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
            admin_email: trimmed_or(&input.admin_email, DEFAULT_ADMIN_EMAIL),
            admin_password: input.admin_password,
            dns,
            cors_origins,
            share_ttl_secs: input.share_ttl_secs,
            public_url: input.public_url.clone(),
            app_verify_url: trimmed_or(&input.app_verify_url, DEFAULT_APP_VERIFY_URL),
            trusted_proxies,
            dev_mail_token,
            rate_limit_store,
            login_rate_limit: input.login_rate_limit,
            login_rate_window_secs: input.login_rate_window_secs.max(1),
            refresh_rate_limit: input.refresh_rate_limit,
            refresh_rate_window_secs: input.refresh_rate_window_secs.max(1),
            register_rate_limit: input.register_rate_limit,
            register_rate_window_secs: input.register_rate_window_secs.max(1),
            resend_rate_limit: input.resend_rate_limit,
            resend_rate_window_secs: input.resend_rate_window_secs.max(1),
            forgot_rate_limit: input.forgot_rate_limit,
            forgot_rate_window_secs: input.forgot_rate_window_secs.max(1),
            http_timeout_secs: input.http_timeout_secs.max(1),
            shutdown_grace_secs: input.shutdown_grace_secs.max(1),
            mail_mode,
            smtp_url,
            smtp_from,
            metrics_token,
            payment_secret,
            backup_dir: input.backup_dir,
            backup_interval_secs: input.backup_interval_secs,
            backup_keep: input.backup_keep.max(1),
            billing: BillingConfig {
                enabled: billing_enabled,
                currency: billing_currency,
                trial_days: billing_trial_days,
                provider: payment_provider,
                public_url: input.public_url,
            },
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

pub fn parse_trusted_proxies(raw: &str) -> Result<Vec<IpNet>> {
    let mut networks = Vec::new();
    for entry in raw.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let net = match IpNet::from_str(entry) {
            Ok(net) => net,
            Err(_) => {
                let addr = IpAddr::from_str(entry).with_context(|| {
                    format!("AWG_TRUSTED_PROXIES entries must be IP/CIDR, got {entry:?}")
                })?;
                IpNet::from(addr)
            }
        };
        if !networks.contains(&net) {
            networks.push(net);
        }
    }
    Ok(networks)
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

fn parse_bool(key: &str, raw: &str, default: bool) -> Result<bool> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(default);
    }
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        other => bail!("{key} must be true or false, got {other:?}"),
    }
}

fn parse_currency(raw: &str) -> Result<String> {
    let value = raw.trim();
    let value = if value.is_empty() { "RUB" } else { value };
    awg_billing::normalize_currency(value)
        .map_err(|_| anyhow::anyhow!("AWG_BILLING_CURRENCY must be a three-letter ISO 4217 code"))
}

fn parse_trial_days(raw: &str) -> Result<u32> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(0);
    }
    value
        .parse()
        .with_context(|| "AWG_BILLING_TRIAL_DAYS must be a non-negative integer")
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
        admin_email: env("AWG_ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL),
        admin_password: env("AWG_ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD),
        dns: env("AWG_DNS", "1.1.1.1,8.8.8.8"),
        cors_origins: env("AWG_CORS_ORIGINS", ""),
        share_ttl_secs: env_u64("AWG_SHARE_TTL_SECS", 86_400),
        public_url: env("AWG_PUBLIC_URL", ""),
        app_verify_url: env("AWG_APP_VERIFY_URL", DEFAULT_APP_VERIFY_URL),
        trusted_proxies: env("AWG_TRUSTED_PROXIES", ""),
        dev_mail_token: env_optional("AWG_DEV_MAIL_TOKEN"),
        rate_limit_store: env("AWG_RATE_LIMIT_STORE", "memory"),
        login_rate_limit: env_u32("AWG_LOGIN_RATE_LIMIT", 10),
        login_rate_window_secs: env_u64("AWG_LOGIN_RATE_WINDOW_SECS", 300),
        refresh_rate_limit: env_u32("AWG_REFRESH_RATE_LIMIT", 60),
        refresh_rate_window_secs: env_u64("AWG_REFRESH_RATE_WINDOW_SECS", 300),
        register_rate_limit: env_u32("AWG_REGISTER_RATE_LIMIT", 5),
        register_rate_window_secs: env_u64("AWG_REGISTER_RATE_WINDOW_SECS", 300),
        resend_rate_limit: env_u32("AWG_RESEND_RATE_LIMIT", 5),
        resend_rate_window_secs: env_u64("AWG_RESEND_RATE_WINDOW_SECS", 300),
        forgot_rate_limit: env_u32("AWG_FORGOT_RATE_LIMIT", 5),
        forgot_rate_window_secs: env_u64("AWG_FORGOT_RATE_WINDOW_SECS", 300),
        http_timeout_secs: env_u64("AWG_HTTP_TIMEOUT_SECS", 30),
        shutdown_grace_secs: env_u64("AWG_SHUTDOWN_GRACE_SECS", 10),
        mail_mode: env("AWG_MAIL_MODE", "log"),
        smtp_url: env_optional("AWG_SMTP_URL"),
        smtp_from: env_optional("AWG_SMTP_FROM"),
        metrics_token: env_optional("AWG_METRICS_TOKEN"),
        billing_enabled: env("AWG_BILLING_ENABLED", "false"),
        billing_currency: env("AWG_BILLING_CURRENCY", "RUB"),
        billing_trial_days: env("AWG_BILLING_TRIAL_DAYS", "0"),
        payment_provider: env("AWG_PAYMENT_PROVIDER", "noop"),
        payment_secret: env("AWG_PAYMENT_SECRET", ""),
        backup_dir: env("AWG_BACKUP_DIR", ""),
        backup_interval_secs: env_u64("AWG_BACKUP_INTERVAL_SECS", 86_400),
        backup_keep: env_u64("AWG_BACKUP_KEEP", 7),
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
            admin_email: DEFAULT_ADMIN_EMAIL.into(),
            admin_password: "super-secret-password".into(),
            dns: "1.1.1.1,8.8.8.8".into(),
            cors_origins: String::new(),
            share_ttl_secs: 3600,
            public_url: String::new(),
            app_verify_url: DEFAULT_APP_VERIFY_URL.into(),
            trusted_proxies: String::new(),
            dev_mail_token: None,
            rate_limit_store: "memory".into(),
            login_rate_limit: 10,
            login_rate_window_secs: 300,
            refresh_rate_limit: 60,
            refresh_rate_window_secs: 300,
            register_rate_limit: 5,
            register_rate_window_secs: 300,
            resend_rate_limit: 5,
            resend_rate_window_secs: 300,
            forgot_rate_limit: 5,
            forgot_rate_window_secs: 300,
            http_timeout_secs: 30,
            shutdown_grace_secs: 10,
            mail_mode: "log".into(),
            smtp_url: None,
            smtp_from: None,
            metrics_token: None,
            billing_enabled: "false".into(),
            billing_currency: "RUB".into(),
            billing_trial_days: "0".into(),
            payment_provider: "noop".into(),
            payment_secret: String::new(),
            backup_dir: String::new(),
            backup_interval_secs: 0,
            backup_keep: 7,
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
    fn app_verify_url_defaults_and_is_trimmed() {
        let mut input = base_input(Environment::Development);
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.app_verify_url, DEFAULT_APP_VERIFY_URL);

        input.app_verify_url = "   ".into();
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.app_verify_url, DEFAULT_APP_VERIFY_URL);

        input.app_verify_url = "  umbravpn://confirm  ".into();
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.app_verify_url, "umbravpn://confirm");
    }

    #[test]
    fn admin_email_defaults_and_is_trimmed() {
        let mut input = base_input(Environment::Development);
        input.admin_email = "   ".into();
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.admin_email, DEFAULT_ADMIN_EMAIL);

        input.admin_email = "  Owner@Example.COM  ".into();
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.admin_email, "Owner@Example.COM");
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
    fn rate_limit_store_defaults_to_memory_and_accepts_redb() {
        let config = Config::from_input(base_input(Environment::Development)).unwrap();
        assert_eq!(config.rate_limit_store, RateLimitStore::Memory);
        assert!(!config.rate_limit_store.is_shared());

        let mut input = base_input(Environment::Development);
        input.rate_limit_store = " redb ".into();
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.rate_limit_store, RateLimitStore::Redb);
        assert!(config.rate_limit_store.is_shared());
        assert_eq!(config.rate_limit_store.as_str(), "redb");
    }

    #[test]
    fn rate_limit_store_rejects_unknown_values() {
        let mut input = base_input(Environment::Development);
        input.rate_limit_store = "redis".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_RATE_LIMIT_STORE must be memory or redb"));
    }

    #[test]
    fn rate_limit_windows_have_a_floor() {
        let mut input = base_input(Environment::Development);
        input.login_rate_window_secs = 0;
        input.refresh_rate_window_secs = 0;
        input.register_rate_window_secs = 0;
        input.resend_rate_window_secs = 0;
        input.forgot_rate_window_secs = 0;
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.login_rate_window_secs, 1);
        assert_eq!(config.refresh_rate_window_secs, 1);
        assert_eq!(config.register_rate_window_secs, 1);
        assert_eq!(config.resend_rate_window_secs, 1);
        assert_eq!(config.forgot_rate_window_secs, 1);
    }

    #[test]
    fn http_timeout_and_shutdown_grace_are_configurable() {
        let mut input = base_input(Environment::Development);
        input.http_timeout_secs = 45;
        input.shutdown_grace_secs = 20;
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.http_timeout_secs, 45);
        assert_eq!(config.shutdown_grace_secs, 20);
    }

    #[test]
    fn http_timeout_and_shutdown_grace_have_a_floor() {
        let mut input = base_input(Environment::Development);
        input.http_timeout_secs = 0;
        input.shutdown_grace_secs = 0;
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.http_timeout_secs, 1);
        assert_eq!(config.shutdown_grace_secs, 1);
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
    fn trusted_proxies_parse_cidrs_and_bare_addresses() {
        let mut input = base_input(Environment::Development);
        input.trusted_proxies = " 10.0.0.0/8, 192.0.2.5 ,, 2001:db8::/32 ".into();
        let config = Config::from_input(input).unwrap();
        assert_eq!(
            config.trusted_proxies,
            vec![
                "10.0.0.0/8".parse::<IpNet>().unwrap(),
                "192.0.2.5/32".parse::<IpNet>().unwrap(),
                "2001:db8::/32".parse::<IpNet>().unwrap(),
            ]
        );
    }

    #[test]
    fn trusted_proxies_reject_malformed_values() {
        let mut input = base_input(Environment::Development);
        input.trusted_proxies = "not-a-proxy".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_TRUSTED_PROXIES"), "{error}");
    }

    #[test]
    fn trusted_proxies_default_to_empty() {
        let config = Config::from_input(base_input(Environment::Development)).unwrap();
        assert!(config.trusted_proxies.is_empty());
    }

    #[test]
    fn dev_mail_token_is_optional_and_trimmed() {
        let mut input = base_input(Environment::Development);
        let config = Config::from_input(input.clone()).unwrap();
        assert_eq!(config.dev_mail_token, None);

        input.dev_mail_token = Some("  dev-mail-token  ".into());
        let config = Config::from_input(input).unwrap();
        assert_eq!(config.dev_mail_token.as_deref(), Some("dev-mail-token"));
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

    #[test]
    fn billing_defaults_are_disabled_with_noop_provider() {
        let config = Config::from_input(base_input(Environment::Development)).unwrap();
        assert!(!config.billing.enabled);
        assert_eq!(config.billing.currency, "RUB");
        assert_eq!(config.billing.trial_days, 0);
        assert_eq!(config.billing.provider, PaymentProvider::Noop);
    }

    #[test]
    fn billing_currency_and_provider_are_normalized() {
        let mut input = base_input(Environment::Development);
        input.billing_currency = " usd ".into();
        input.payment_provider = " STRIPE ".into();
        input.billing_trial_days = "14".into();
        input.billing_enabled = "true".into();

        let config = Config::from_input(input).unwrap();
        assert!(config.billing.enabled);
        assert_eq!(config.billing.currency, "USD");
        assert_eq!(config.billing.trial_days, 14);
        assert_eq!(config.billing.provider, PaymentProvider::Stripe);
        assert_eq!(config.billing.provider.as_str(), "stripe");
        assert_eq!(config.billing.settings().currency, "USD");
    }

    #[test]
    fn billing_rejects_invalid_values() {
        let mut input = base_input(Environment::Development);
        input.billing_enabled = "maybe".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_BILLING_ENABLED must be true or false"));

        let mut input = base_input(Environment::Development);
        input.billing_currency = "RUBL".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_BILLING_CURRENCY"));

        let mut input = base_input(Environment::Development);
        input.billing_trial_days = "-1".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_BILLING_TRIAL_DAYS"));

        let mut input = base_input(Environment::Development);
        input.payment_provider = "paypal".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_PAYMENT_PROVIDER"));
    }

    #[test]
    fn production_requires_a_real_provider_when_billing_is_enabled() {
        let mut input = base_input(Environment::Production);
        input.billing_enabled = "true".into();
        let error = Config::from_input(input).unwrap_err().to_string();
        assert!(error.contains("AWG_PAYMENT_PROVIDER must not be noop"));

        let mut input = base_input(Environment::Production);
        input.billing_enabled = "true".into();
        input.payment_provider = "yookassa".into();
        let config = Config::from_input(input).unwrap();
        assert!(config.billing.enabled);
        assert!(!config.billing.provider.is_noop());
    }

    #[test]
    fn provider_parsing_accepts_all_supported_values() {
        for raw in [
            "noop",
            "stripe",
            "yookassa",
            "cloudpayments",
            "telegram_stars",
        ] {
            assert!(PaymentProvider::parse(raw).is_ok(), "{raw}");
        }
    }
}
