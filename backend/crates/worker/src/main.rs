use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use awg_worker::{
    FileCounterRepository, NetlinkAwg, NftForwarding, ReconcileService, TcShaper, WorkerClient,
};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

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
    let dry_run = env("AWG_DRY_RUN", "false") == "true";
    let counters_path = env("AWG_COUNTERS_PATH", "/var/lib/awg-worker/counters.json");
    let interval = env("AWG_STATS_INTERVAL_SECS", "2")
        .parse::<u64>()
        .unwrap_or(2)
        .max(1);

    let service = Arc::new(ReconcileService::new(
        Box::new(NetlinkAwg::new(dry_run)),
        Box::new(TcShaper::new(dry_run)),
        Box::new(NftForwarding::new(dry_run)),
        Box::new(FileCounterRepository::new(counters_path)),
    )?);

    tracing::info!(%node_id, %grpc_url, dry_run, "worker starting");

    let client = WorkerClient {
        url: grpc_url,
        node_id,
        token,
        version: env!("CARGO_PKG_VERSION").to_string(),
        stats_interval: Duration::from_secs(interval),
    };

    client.run(service).await
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
