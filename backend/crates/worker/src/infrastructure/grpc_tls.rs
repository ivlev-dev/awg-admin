use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use tonic::transport::{Certificate, ClientTlsConfig, Identity};

#[derive(Debug, Clone, Default)]
pub struct GrpcTlsOptions {
    pub ca_path: Option<PathBuf>,
    pub domain: Option<String>,
    pub use_system_roots: bool,
    pub client_cert_path: Option<PathBuf>,
    pub client_key_path: Option<PathBuf>,
}

impl GrpcTlsOptions {
    pub fn from_env() -> Result<Self> {
        let options = Self {
            ca_path: env_optional("AWG_GRPC_TLS_CA").map(PathBuf::from),
            domain: env_optional("AWG_GRPC_TLS_DOMAIN"),
            use_system_roots: env_flag("AWG_GRPC_TLS_SYSTEM_ROOTS"),
            client_cert_path: env_optional("AWG_GRPC_TLS_CLIENT_CERT").map(PathBuf::from),
            client_key_path: env_optional("AWG_GRPC_TLS_CLIENT_KEY").map(PathBuf::from),
        };
        options.validate()?;
        Ok(options)
    }

    pub fn is_enabled(&self) -> bool {
        self.ca_path.is_some() || self.domain.is_some() || self.use_system_roots
    }

    pub fn is_mtls_enabled(&self) -> bool {
        self.is_enabled() && self.client_cert_path.is_some() && self.client_key_path.is_some()
    }

    pub fn validate(&self) -> Result<()> {
        match (&self.client_cert_path, &self.client_key_path) {
            (Some(_), Some(_)) => {}
            (None, None) => return Ok(()),
            _ => bail!("AWG_GRPC_TLS_CLIENT_CERT and AWG_GRPC_TLS_CLIENT_KEY must be set together"),
        }
        if !self.is_enabled() {
            bail!(
                "AWG_GRPC_TLS_CLIENT_CERT requires TLS to be enabled: set AWG_GRPC_TLS_CA, AWG_GRPC_TLS_DOMAIN or AWG_GRPC_TLS_SYSTEM_ROOTS=true"
            );
        }
        Ok(())
    }

    pub fn client_config(&self) -> Result<Option<ClientTlsConfig>> {
        self.validate()?;
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
        if let (Some(cert_path), Some(key_path)) = (&self.client_cert_path, &self.client_key_path) {
            let cert = std::fs::read(cert_path).with_context(|| {
                format!(
                    "failed to read AWG_GRPC_TLS_CLIENT_CERT {}",
                    cert_path.display()
                )
            })?;
            let key = std::fs::read(key_path).with_context(|| {
                format!(
                    "failed to read AWG_GRPC_TLS_CLIENT_KEY {}",
                    key_path.display()
                )
            })?;
            let cert = std::str::from_utf8(&cert)
                .context("AWG_GRPC_TLS_CLIENT_CERT must be a PEM-encoded certificate")?;
            let key = std::str::from_utf8(&key)
                .context("AWG_GRPC_TLS_CLIENT_KEY must be a PEM-encoded key")?;
            if !cert.contains("-----BEGIN CERTIFICATE-----") {
                bail!(
                    "AWG_GRPC_TLS_CLIENT_CERT {} does not contain a PEM certificate",
                    cert_path.display()
                );
            }
            if !key.contains("PRIVATE KEY-----") {
                bail!(
                    "AWG_GRPC_TLS_CLIENT_KEY {} does not contain a PEM private key",
                    key_path.display()
                );
            }
            config = config.identity(Identity::from_pem(cert, key));
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

    fn write_temp(name: &str, contents: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!("awg-worker-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!("{unique}-{name}"));
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        path
    }

    fn write_ca() -> PathBuf {
        let certified =
            rcgen::generate_simple_self_signed(vec!["admin.local".to_string()]).unwrap();
        write_temp("ca.crt", &certified.cert.pem())
    }

    fn write_client_identity() -> (PathBuf, PathBuf) {
        let certified = rcgen::generate_simple_self_signed(vec!["worker-1".to_string()]).unwrap();
        (
            write_temp("worker.crt", &certified.cert.pem()),
            write_temp("worker.key", &certified.signing_key.serialize_pem()),
        )
    }

    #[test]
    fn plaintext_when_not_configured() {
        let options = GrpcTlsOptions::default();
        assert!(!options.is_enabled());
        assert!(!options.is_mtls_enabled());
        assert!(options.client_config().unwrap().is_none());
    }

    #[test]
    fn ca_file_enables_tls() {
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            domain: Some("admin.local".into()),
            use_system_roots: false,
            ..Default::default()
        };
        assert!(options.is_enabled());
        assert!(!options.is_mtls_enabled());
        assert!(options.client_config().unwrap().is_some());
    }

    #[test]
    fn domain_alone_uses_system_roots() {
        let options = GrpcTlsOptions {
            ca_path: None,
            domain: Some("admin.example.com".into()),
            use_system_roots: false,
            ..Default::default()
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
            ..Default::default()
        };
        assert!(options.client_config().unwrap().is_some());
    }

    #[test]
    fn missing_ca_reports_the_env_name() {
        let options = GrpcTlsOptions {
            ca_path: Some(PathBuf::from("/nonexistent/awg-ca.crt")),
            domain: None,
            use_system_roots: false,
            ..Default::default()
        };
        let error = options.client_config().unwrap_err().to_string();
        assert!(error.contains("AWG_GRPC_TLS_CA"), "{error}");
    }

    #[test]
    fn client_identity_requires_tls() {
        let (cert, key) = write_client_identity();
        let options = GrpcTlsOptions {
            client_cert_path: Some(cert),
            client_key_path: Some(key),
            ..Default::default()
        };
        let error = options.client_config().unwrap_err().to_string();
        assert!(error.contains("requires TLS to be enabled"), "{error}");
    }

    #[test]
    fn client_identity_requires_cert_and_key_together() {
        let (cert, _) = write_client_identity();
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            client_cert_path: Some(cert),
            ..Default::default()
        };
        let error = options.client_config().unwrap_err().to_string();
        assert!(
            error.contains("AWG_GRPC_TLS_CLIENT_CERT and AWG_GRPC_TLS_CLIENT_KEY"),
            "{error}"
        );

        let (_, key) = write_client_identity();
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            client_key_path: Some(key),
            ..Default::default()
        };
        assert!(options.client_config().is_err());
    }

    #[test]
    fn mtls_is_enabled_with_ca_and_client_identity() {
        let (cert, key) = write_client_identity();
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            client_cert_path: Some(cert),
            client_key_path: Some(key),
            ..Default::default()
        };
        assert!(options.is_enabled());
        assert!(options.is_mtls_enabled());
        assert!(options.client_config().unwrap().is_some());
    }

    #[test]
    fn missing_client_identity_files_report_the_env_names() {
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            client_cert_path: Some(PathBuf::from("/nonexistent/worker.crt")),
            client_key_path: Some(PathBuf::from("/nonexistent/worker.key")),
            ..Default::default()
        };
        let error = options.client_config().unwrap_err().to_string();
        assert!(error.contains("AWG_GRPC_TLS_CLIENT_CERT"), "{error}");
    }

    #[test]
    fn rejects_non_pem_client_identity() {
        let cert = write_temp("bad-worker.crt", "not a certificate");
        let key = write_temp("bad-worker.key", "not a key");
        let options = GrpcTlsOptions {
            ca_path: Some(write_ca()),
            client_cert_path: Some(cert),
            client_key_path: Some(key),
            ..Default::default()
        };
        let error = options.client_config().unwrap_err().to_string();
        assert!(error.contains("AWG_GRPC_TLS_CLIENT_CERT"), "{error}");
    }
}
