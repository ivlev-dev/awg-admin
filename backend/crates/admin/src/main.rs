mod audit;
mod auth;
mod config;
mod controllers;
mod directory;
mod error;
mod grpc;
mod logging;
mod mailer;
mod metrics;
mod models;
mod rate_limit;
mod routes;
mod settings;
mod snapshot;
mod state;
mod views;
mod ws;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use awg_audit::{AuditService, RedbAuditRepository};
use awg_billing::{
    BillingService, RedbInvoiceRepository, RedbPlanRepository, RedbSubscriptionRepository,
};
use awg_clients::{
    DeviceService, ProfileService, RedbDevicePeerRepository, RedbDeviceRepository,
    RedbShareLinkRepository, ShareService,
};
use awg_identity::{
    Argon2Hasher, IdentityService, JwtIssuer, RedbEmailVerificationRepository, RedbUserRepository,
    TokenIssuer,
};
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

use crate::config::Config;
use crate::directory::{DevicesAdapter, NodesAdapter};
use crate::grpc::WorkerGrpc;
use crate::rate_limit::SlidingWindowLimiter;
use crate::settings::SettingsStore;
use crate::snapshot::SnapshotBuilder;
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    let log_format = logging::LogFormat::from_env()?;
    logging::init(log_format);

    let config = Arc::new(Config::from_env()?);
    if let Some(parent) = std::path::Path::new(&config.db_path).parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let store = Arc::new(Store::open(&config.db_path)?);
    let sealer = Arc::new(Sealer::from_master_key(&config.master_key)?);
    let mailer = mailer::build_mailer(&config)?;

    let identity = {
        let users = Arc::new(RedbUserRepository::new(store.clone()));
        let hasher = Arc::new(Argon2Hasher::default());
        let tokens = Arc::new(JwtIssuer::new(
            &config.jwt_secret,
            config.access_ttl_secs,
            config.refresh_ttl_secs,
            &config.jwt_issuer,
            &config.jwt_audience,
            store.clone(),
        ));
        let verifications = Arc::new(RedbEmailVerificationRepository::new(store.clone()));
        {
            let tokens = tokens.clone();
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(3600));
                ticker.tick().await;
                loop {
                    ticker.tick().await;
                    match tokens.prune_expired() {
                        Ok(removed) => {
                            tracing::info!(removed, "pruned expired refresh tokens")
                        }
                        Err(error) => {
                            tracing::warn!(%error, "failed to prune refresh tokens")
                        }
                    }
                }
            });
        }
        Arc::new(IdentityService::new(
            users,
            hasher,
            tokens,
            verifications,
            mailer,
            sealer.clone(),
            config.public_url.clone(),
        ))
    };

    let tariffs = {
        let repo = Arc::new(RedbTariffRepository::new(store.clone()));
        Arc::new(TariffService::new(repo))
    };

    let billing = {
        let plans = Arc::new(RedbPlanRepository::new(store.clone()));
        let subscriptions = Arc::new(RedbSubscriptionRepository::new(store.clone()));
        let invoices = Arc::new(RedbInvoiceRepository::new(store.clone()));
        let tariffs = Arc::new(crate::controllers::billing::TariffCatalogAdapter::new(
            tariffs.clone(),
        ));
        Arc::new(BillingService::new(
            plans,
            subscriptions,
            invoices,
            tariffs,
            config.billing.settings(),
        ))
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

    let audit = {
        let repo = Arc::new(RedbAuditRepository::new(store.clone()));
        Arc::new(AuditService::new(repo))
    };

    let audit_retention_days: i64 = std::env::var("AWG_AUDIT_RETENTION_DAYS")
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(90);
    if audit_retention_days > 0 {
        let audit_task = audit.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(86_400));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let cutoff = chrono::Utc::now() - chrono::Duration::days(audit_retention_days);
                match audit_task.prune(cutoff) {
                    Ok(removed) => tracing::info!(removed, "pruned old audit entries"),
                    Err(error) => tracing::warn!(%error, "failed to prune audit entries"),
                }
            }
        });
    }

    let login_limiter = Arc::new(SlidingWindowLimiter::new(
        config.login_rate_limit,
        Duration::from_secs(config.login_rate_window_secs),
    ));
    let refresh_limiter = Arc::new(SlidingWindowLimiter::new(
        config.refresh_rate_limit,
        Duration::from_secs(config.refresh_rate_window_secs),
    ));
    let register_limiter = Arc::new(SlidingWindowLimiter::new(
        config.register_rate_limit,
        Duration::from_secs(config.register_rate_window_secs),
    ));
    let resend_limiter = Arc::new(SlidingWindowLimiter::new(
        config.resend_rate_limit,
        Duration::from_secs(config.resend_rate_window_secs),
    ));

    {
        let login_limiter = login_limiter.clone();
        let refresh_limiter = refresh_limiter.clone();
        let register_limiter = register_limiter.clone();
        let resend_limiter = resend_limiter.clone();
        let period = config
            .login_rate_window_secs
            .max(config.refresh_rate_window_secs)
            .max(config.register_rate_window_secs)
            .max(config.resend_rate_window_secs)
            .max(60);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(period));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                login_limiter.cleanup();
                refresh_limiter.cleanup();
                register_limiter.cleanup();
                resend_limiter.cleanup();
            }
        });
    }

    if let Some(admin) = identity
        .seed_admin(&config.admin_login, &config.admin_password)
        .context("failed to seed the initial administrator")?
    {
        tracing::info!(login = %admin.login, "seeded the initial administrator");
    }

    let state = Arc::new(AppState {
        config: config.clone(),
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
        audit,
        billing,
        login_limiter,
        refresh_limiter,
        register_limiter,
        resend_limiter,
    });

    {
        let stats = stats.clone();
        let settings = state.settings.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let keep_days = match settings.get() {
                    Ok(settings) => settings.effective_stats_retention_days(),
                    Err(error) => {
                        tracing::warn!(%error, "failed to read stats retention settings");
                        continue;
                    }
                };
                match stats.cleanup(keep_days as i64) {
                    Ok(removed) => {
                        tracing::info!(removed, keep_days, "pruned old traffic buckets");
                    }
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
    tracing::info!(
        bind = %config.bind,
        env = config.environment.as_str(),
        production = config.is_production(),
        log_format = log_format.as_str(),
        mail_mode = config.mail_mode.as_str(),
        billing_enabled = config.billing.enabled,
        billing_provider = config.billing.provider.as_str(),
        "admin API listening (h2c + http/1.1)"
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .context("HTTP server failed")?;
    Ok(())
}
