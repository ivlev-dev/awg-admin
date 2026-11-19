use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use tonic::transport::{Certificate, ClientTlsConfig};

#[derive(Debug, Clone, Default)]
pub struct GrpcTlsOptions {
    pub ca_path: Option<PathBuf>,
    pub domain: Option<String>,
    pub use_system_roots: bool,
}

impl GrpcTlsOptions {
    pub fn from_env() -> Self {
        Self {
            ca_path: env_optional("AWG_GRPC_TLS_CA").map(PathBuf::from),
            domain: env_optional("AWG_GRPC_TLS_DOMAIN"),
            use_system_roots: env_flag("AWG_GRPC_TLS_SYSTEM_ROOTS"),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.ca_path.is_some() || self.domain.is_some() || self.use_system_roots
    }

    pub fn client_config(&self) -> Result<Option<ClientTlsConfig>> {
        if !self.is_enabled() {
            return Ok(None);
        }
        let mut config = ClientTlsConfig::new();
        match &self.ca_path {
            Some(path) => {
                let pem = std::fs::read(path).with_context(|| {
                    format!("failed to read AWG_GRPC_TLS_CA {}", path.display())
                })?;
                let pem = std::str::from_utf8(&pem)
                    .context("AWG_GRPC_TLS_CA must be a PEM-encoded certificate")?;
                if !pem.contains("-----BEGIN CERTIFICATE-----") {
                    bail!(
                        "AWG_GRPC_TLS_CA {} does not contain a PEM certificate",
                        path.display()
                    );
                }
                config = config.ca_certificate(Certificate::from_pem(pem));
            }
            None => {
                config = config.with_native_roots();
            }
        }
        if let Some(domain) = &self.domain {
            config = config.domain_name(domain.clone());
        }
        Ok(Some(config))
    }
}

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_flag(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_ca() -> PathBuf {
        let certified =
            rcgen::generate_simple_self_signed(vec!["admin.local".to_string()]).unwrap();
        let dir = std::env::temp_dir().join(format!("awg-worker-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ca.crt");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(certified.cert.pem().as_bytes()).unwrap();
        path
    }

    #[test]
    fn plaintext_when_not_configured() {
        let options = GrpcTlsOptions::default();
        assert!(!options.is_enabled());
        assert!(options.client_config().unwrap().is_none());
    }

    #[test]
    fn ca_file_enables_tls() {
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            domain: Some("admin.local".into()),
            use_system_roots: false,
        };
        assert!(options.is_enabled());
        assert!(options.client_config().unwrap().is_some());
    }

    #[test]
    fn domain_alone_uses_system_roots() {
        let options = GrpcTlsOptions {
            ca_path: None,
            domain: Some("admin.example.com".into()),
            use_system_roots: false,
        };
        assert!(options.is_enabled());
        assert!(options.client_config().unwrap().is_some());
    }

    #[test]
    fn system_roots_flag_enables_tls() {
        let options = GrpcTlsOptions {
            ca_path: None,
            domain: None,
            use_system_roots: true,
        };
        assert!(options.client_config().unwrap().is_some());
    }

    #[test]
    fn missing_ca_reports_the_env_name() {
        let options = GrpcTlsOptions {
            ca_path: Some(PathBuf::from("/nonexistent/awg-ca.crt")),
            domain: None,
            use_system_roots: false,
        };
        let error = options.client_config().unwrap_err().to_string();
        assert!(error.contains("AWG_GRPC_TLS_CA"), "{error}");
    }
}
