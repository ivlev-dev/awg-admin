use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use awg_worker::{
    FileCounterRepository, GrpcTlsOptions, NetlinkAwg, NftForwarding, ReconcileService, TcShaper,
    WorkerClient, env_flag,
};
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const PSK_STATE_FILE: &str = "applied-psks.json";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let grpc_url = env("AWG_GRPC_URL", "http://127.0.0.1:9090");
    let node_id: Uuid = env("AWG_NODE_ID", "")
        .parse()
        .context("AWG_NODE_ID must be a UUID")?;
    let token = env("AWG_NODE_TOKEN", "");
    if token.is_empty() {
        anyhow::bail!("AWG_NODE_TOKEN is required");
    }
    let dry_run = env_flag("AWG_DRY_RUN")?;
    let counters_path = PathBuf::from(env(
        "AWG_COUNTERS_PATH",
        "/var/lib/awg-worker/counters.json",
    ));
    let psk_state_path = env_optional("AWG_PSK_STATE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_psk_state_path(&counters_path));
    let interval = env("AWG_STATS_INTERVAL_SECS", "2")
        .parse::<u64>()
        .unwrap_or(2)
        .max(1);

    if dry_run && awg_worker::url_is_remote(&grpc_url) {
        tracing::warn!(
            %grpc_url,
            "AWG_DRY_RUN is enabled but AWG_GRPC_URL is not loopback: the worker will not touch \
             the local dataplane, yet it still sends this node's token and stats to a remote admin"
        );
    }

    let service = Arc::new(ReconcileService::new(
        Box::new(NetlinkAwg::with_psk_state(
            dry_run,
            Some(psk_state_path.clone()),
        )),
        Box::new(TcShaper::new(dry_run)),
        Box::new(NftForwarding::new(dry_run)),
        Box::new(FileCounterRepository::new(counters_path.clone())),
    )?);

    tracing::info!(
        %node_id,
        %grpc_url,
        dry_run,
        counters = %counters_path.display(),
        psk_state = %psk_state_path.display(),
        "worker starting"
    );

    let tls = GrpcTlsOptions::from_env()?;
    tls.client_config()?;
    if tls.is_enabled() {
        tracing::info!(
            ca = ?tls.ca_path,
            domain = ?tls.domain,
            system_roots = tls.use_system_roots,
            mtls = tls.is_mtls_enabled(),
            "gRPC TLS enabled"
        );
    }

    let client = WorkerClient {
        url: grpc_url,
        node_id,
        token,
        version: env!("CARGO_PKG_VERSION").to_string(),
        stats_interval: Duration::from_secs(interval),
        tls,
    };

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let signals = tokio::spawn(async move {
        wait_for_shutdown_signal().await;
        let _ = shutdown_tx.send(true);
        // A second signal forces an immediate exit if the apply hangs.
        wait_for_shutdown_signal().await;
        tracing::error!("second shutdown signal received, exiting immediately");
        std::process::exit(130);
    });

    let result = client.run(service, shutdown_rx).await;

    signals.abort();
    let _ = signals.await;
    result
}

fn default_psk_state_path(counters_path: &Path) -> PathBuf {
    counters_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(PSK_STATE_FILE)
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(unix)]
async fn wait_for_shutdown_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    let mut terminate = match signal(SignalKind::terminate()) {
        Ok(signal) => signal,
        Err(error) => {
            tracing::error!(%error, "failed to install SIGTERM handler");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    let mut interrupt = match signal(SignalKind::interrupt()) {
        Ok(signal) => signal,
        Err(error) => {
            tracing::error!(%error, "failed to install SIGINT handler");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    tokio::select! {
        _ = terminate.recv() => tracing::info!("SIGTERM received"),
        _ = interrupt.recv() => tracing::info!("SIGINT received"),
    }
}

#[cfg(not(unix))]
async fn wait_for_shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
