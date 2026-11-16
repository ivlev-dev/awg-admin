mod auth;
mod config;
mod controllers;
mod directory;
mod error;
mod grpc;
mod models;
mod routes;
mod settings;
mod snapshot;
mod state;
mod views;
mod ws;

use std::sync::Arc;

use anyhow::{Context, Result};
use awg_clients::{
    DeviceService, ProfileService, RedbDevicePeerRepository, RedbDeviceRepository,
    RedbShareLinkRepository, ShareService,
};
use awg_identity::{Argon2Hasher, IdentityService, JwtIssuer, RedbUserRepository};
use awg_network::{
    NetworkService, RedbCidrPoolRepository, RedbGroupRepository, RedbInterfaceRepository,
    RedbNodeRepository,
};
use awg_orchestration::{OrchestrationService, WorkerRegistry};
use awg_proto::worker_gateway_server::WorkerGatewayServer;
use awg_shared::crypto::Sealer;
use awg_statistics::{RedbStatsRepository, StatsHub, StatsService};
use awg_storage::Store;
use awg_tariffs::{RedbTariffRepository, TariffService};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::directory::{DevicesAdapter, NodesAdapter};
use crate::grpc::WorkerGrpc;
use crate::settings::SettingsStore;
use crate::snapshot::SnapshotBuilder;
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Arc::new(Config::from_env()?);
    if let Some(parent) = std::path::Path::new(&config.db_path).parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let store = Arc::new(Store::open(&config.db_path)?);
    let sealer = Arc::new(Sealer::from_master_key(&config.master_key)?);

    let identity = {
        let users = Arc::new(RedbUserRepository::new(store.clone()));
        let hasher = Arc::new(Argon2Hasher::default());
        let tokens = Arc::new(JwtIssuer::new(
            &config.jwt_secret,
            config.access_ttl_secs,
            config.refresh_ttl_secs,
            store.clone(),
        ));
        Arc::new(IdentityService::new(users, hasher, tokens))
    };

    let tariffs = {
        let repo = Arc::new(RedbTariffRepository::new(store.clone()));
        Arc::new(TariffService::new(repo))
    };

    let network = {
        let groups = Arc::new(RedbGroupRepository::new(store.clone()));
        let nodes = Arc::new(RedbNodeRepository::new(store.clone()));
        let interfaces = Arc::new(RedbInterfaceRepository::new(store.clone()));
        let pools = Arc::new(RedbCidrPoolRepository::new(store.clone()));
        Arc::new(NetworkService::new(
            groups,
            nodes,
            interfaces,
            pools,
            sealer.clone(),
        ))
    };

    let device_repo = Arc::new(RedbDeviceRepository::new(store.clone()));
    let peer_repo = Arc::new(RedbDevicePeerRepository::new(store.clone()));

    let devices = Arc::new(DeviceService::new(
        device_repo.clone(),
        peer_repo.clone(),
        network.clone(),
        tariffs.clone(),
        sealer.clone(),
    ));

    let profiles = Arc::new(ProfileService::new(
        device_repo,
        peer_repo,
        network.clone(),
        sealer.clone(),
        config.dns.clone(),
    ));

    let share = {
        let links = Arc::new(RedbShareLinkRepository::new(store.clone()));
        Arc::new(ShareService::new(links, profiles.clone()))
    };

    let stats_hub = Arc::new(StatsHub::new(4096));
    let stats = {
        let repo = Arc::new(RedbStatsRepository::new(store.clone()));
        Arc::new(StatsService::new(repo, stats_hub.clone()))
    };

    let registry = Arc::new(WorkerRegistry::new());
    let nodes_adapter = Arc::new(NodesAdapter::new(network.clone()));
    let devices_adapter = Arc::new(DevicesAdapter::new(devices.clone()));
    let snapshot = Arc::new(SnapshotBuilder {
        network: network.clone(),
        devices: devices.clone(),
        identity: identity.clone(),
        tariffs: tariffs.clone(),
        stats: stats.clone(),
    });

    let orchestration = Arc::new(OrchestrationService::new(
        registry.clone(),
        snapshot,
        stats.clone(),
        devices_adapter,
        nodes_adapter,
    ));

    let settings = Arc::new(SettingsStore::new(store.clone()));

    if let Some(admin) = identity
        .seed_admin(&config.admin_login, &config.admin_password)
        .context("failed to seed the initial administrator")?
    {
        tracing::info!(login = %admin.login, "seeded the initial administrator");
    }

    let state = Arc::new(AppState {
        config: config.clone(),
        store,
        sealer,
        identity,
        tariffs,
        network,
        devices,
        profiles,
        share,
        stats: stats.clone(),
        stats_hub,
        registry: registry.clone(),
        orchestration,
        settings,
    });

    {
        let stats = stats.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                match stats.cleanup(90) {
                    Ok(removed) => tracing::info!(removed, "pruned old traffic buckets"),
                    Err(error) => tracing::warn!(%error, "failed to prune traffic buckets"),
                }
            }
        });
    }

    let grpc_state = state.clone();
    let grpc_bind = config.grpc_bind;
    tokio::spawn(async move {
        let service = WorkerGrpc::new(grpc_state);
        tracing::info!(%grpc_bind, "worker gRPC listening");
        if let Err(error) = tonic::transport::Server::builder()
            .add_service(WorkerGatewayServer::new(service))
            .serve(grpc_bind)
            .await
        {
            tracing::error!(%error, "gRPC server stopped");
        }
    });

    let app = routes::router(state);
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.bind))?;
    tracing::info!(bind = %config.bind, "admin API listening (h2c + http/1.1)");
    axum::serve(listener, app)
        .await
        .context("HTTP server failed")?;
    Ok(())
}
