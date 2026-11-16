use std::net::SocketAddr;

use anyhow::{Context, Result};
use awg_shared::crypto::random_bytes;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub grpc_bind: SocketAddr,
    pub db_path: String,
    pub master_key: String,
    pub jwt_secret: Vec<u8>,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    pub admin_login: String,
    pub admin_password: String,
    pub dns: Vec<String>,
    pub cors_origins: Vec<String>,
    pub share_ttl_secs: u64,
    pub public_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let bind = env("AWG_BIND", "0.0.0.0:8080")
            .parse()
            .context("AWG_BIND must be host:port")?;
        let grpc_bind = env("AWG_GRPC_BIND", "0.0.0.0:9090")
            .parse()
            .context("AWG_GRPC_BIND must be host:port")?;

        let master_key = match std::env::var("AWG_MASTER_KEY") {
            Ok(value) if !value.is_empty() => value,
            _ => {
                let generated = STANDARD.encode(random_bytes::<32>());
                tracing::warn!(
                    "AWG_MASTER_KEY is not set; generated an ephemeral key. Stored device secrets will be unreadable after restart"
                );
                generated
            }
        };
        STANDARD
            .decode(master_key.trim())
            .context("AWG_MASTER_KEY must be 32 bytes of base64")?;

        let jwt_secret = match std::env::var("AWG_JWT_SECRET") {
            Ok(value) if !value.is_empty() => value.into_bytes(),
            _ => {
                tracing::warn!("AWG_JWT_SECRET is not set; generated an ephemeral secret");
                random_bytes::<48>().to_vec()
            }
        };

        let dns = env("AWG_DNS", "1.1.1.1,8.8.8.8")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let cors_origins = env("AWG_CORS_ORIGINS", "")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(Self {
            bind,
            grpc_bind,
            db_path: env("AWG_DB_PATH", "/data/awg-admin.redb"),
            master_key,
            jwt_secret,
            access_ttl_secs: env_u64("AWG_ACCESS_TTL_SECS", 900),
            refresh_ttl_secs: env_u64("AWG_REFRESH_TTL_SECS", 30 * 86_400),
            admin_login: env("AWG_ADMIN_LOGIN", "admin"),
            admin_password: env("AWG_ADMIN_PASSWORD", "admin12345"),
            dns,
            cors_origins,
            share_ttl_secs: env_u64("AWG_SHARE_TTL_SECS", 86_400),
            public_url: env("AWG_PUBLIC_URL", ""),
        })
    }
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
