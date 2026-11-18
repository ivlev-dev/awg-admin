pub mod config;
pub mod controllers;
pub mod error;
pub mod mailer;
pub mod models;
pub mod routes;
pub mod settings;
pub mod state;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;
pub mod views;

mod audit;
mod auth;
mod backup;
mod directory;
mod grpc;
pub mod idempotency;
mod logging;
mod metrics;
mod publish;
mod rate_limit;
mod snapshot;
mod ws;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use awg_audit::{AuditService, RedbAuditRepository};
use awg_billing::{
    BillingService, MockGateway, NoopGateway, PaymentGateway, RedbInvoiceRepository,
    RedbPaymentEventRepository, RedbPaymentMethodRepository, RedbPlanRepository,
    RedbSubscriptionRepository,
};
use awg_clients::{
    DeviceService, ProfileService, RedbDevicePeerRepository, RedbDeviceRepository,
    RedbShareLinkRepository, ShareService,
};
use awg_identity::{
    Argon2Hasher, IdentityService, JwtIssuer, RedbEmailVerificationRepository, RedbUserRepository,
    TokenIssuer, UserChanges,
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
use tokio::sync::watch;

use crate::config::{Config, RateLimitStore};
use crate::directory::{DevicesAdapter, NodesAdapter};
use crate::grpc::WorkerGrpc;
use crate::idempotency::IdempotencyStore;
use crate::rate_limit::{MemoryRateLimiter, RateLimitScope, RateLimiter, StoreRateLimiter};
use crate::routes::Readiness;
use crate::settings::SettingsStore;
use crate::snapshot::SnapshotBuilder;
use crate::state::AppState;

pub async fn run() -> Result<()> {
    let log_format = logging::LogFormat::from_env()?;
    logging::init(log_format);

    let config = Arc::new(Config::from_env()?);
    if let Some(parent) = std::path::Path::new(&config.db_path).parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let store = Arc::new(match config.rate_limit_store {
        RateLimitStore::Redb => Store::open_multi_writer(&config.db_path)?,
        RateLimitStore::Memory => Store::open(&config.db_path)?,
    });
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let readiness = Readiness::new(store.clone());
    let mut background = Vec::new();
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
            let mut shutdown = shutdown_rx.clone();
            background.push(tokio::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(3600));
                ticker.tick().await;
                loop {
                    tokio::select! {
                        _ = ticker.tick() => {}
                        _ = wait_for_shutdown(&mut shutdown) => break,
                    }
                    match tokens.prune_expired() {
                        Ok(removed) => {
                            tracing::info!(removed, "pruned expired refresh tokens")
                        }
                        Err(error) => {
                            tracing::warn!(%error, "failed to prune refresh tokens")
                        }
                    }
                }
            }));
        }
        Arc::new(
            IdentityService::new(
                users,
                hasher,
                tokens,
                verifications,
                mailer,
                sealer.clone(),
                config.public_url.clone(),
            )
            .with_app_verify_url(config.app_verify_url.clone()),
        )
    };

    let tariffs = {
        let repo = Arc::new(RedbTariffRepository::new(store.clone()));
        Arc::new(TariffService::new(repo))
    };

    let billing = {
        let plans = Arc::new(RedbPlanRepository::new(store.clone()));
        let subscriptions = Arc::new(RedbSubscriptionRepository::new(store.clone()));
        let invoices = Arc::new(RedbInvoiceRepository::new(store.clone()));
        let payment_methods = Arc::new(RedbPaymentMethodRepository::new(store.clone()));
        let payment_events = Arc::new(RedbPaymentEventRepository::new(store.clone()));
        let tariffs = Arc::new(crate::controllers::billing::TariffCatalogAdapter::new(
            tariffs.clone(),
        ));
        let gateway: Arc<dyn PaymentGateway> = match config.billing.provider {
            crate::config::PaymentProvider::Mock => Arc::new(MockGateway::from_config(
                &config.payment_secret,
                &config.public_url,
                awg_billing::DEFAULT_MOCK_TOLERANCE_SECS,
            )?),
            _ => Arc::new(NoopGateway),
        };
        Arc::new(BillingService::new(
            plans,
            subscriptions,
            invoices,
            payment_methods,
            payment_events,
            tariffs,
            gateway,
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
        billing: config.billing.enabled.then(|| billing.clone()),
    });

    let orchestration = Arc::new(OrchestrationService::new(
        registry.clone(),
        snapshot,
        stats.clone(),
        devices_adapter,
        nodes_adapter,
    ));

    let settings = Arc::new(SettingsStore::new(store.clone()));
    let idempotency = Arc::new(IdempotencyStore::new(store.clone(), sealer.clone()));

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
        let mut shutdown = shutdown_rx.clone();
        background.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(86_400));
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = wait_for_shutdown(&mut shutdown) => break,
                }
                let cutoff = chrono::Utc::now() - chrono::Duration::days(audit_retention_days);
                match audit_task.prune(cutoff) {
                    Ok(removed) => tracing::info!(removed, "pruned old audit entries"),
                    Err(error) => tracing::warn!(%error, "failed to prune audit entries"),
                }
            }
        }));
    }

    if !config.backup_dir.trim().is_empty() && config.backup_interval_secs > 0 {
        let dir = std::path::PathBuf::from(config.backup_dir.trim());
        background.push(backup::spawn(
            store.clone(),
            dir,
            config.backup_interval_secs,
            config.backup_keep as usize,
            shutdown_rx.clone(),
        ));
    }

    let limiter_backend: Arc<dyn RateLimiter> = match config.rate_limit_store {
        RateLimitStore::Memory => Arc::new(MemoryRateLimiter::new()),
        RateLimitStore::Redb => Arc::new(StoreRateLimiter::new(store.clone())),
    };
    let login_limiter = RateLimitScope::new(
        limiter_backend.clone(),
        "login",
        config.login_rate_limit,
        Duration::from_secs(config.login_rate_window_secs),
    );
    let refresh_limiter = RateLimitScope::new(
        limiter_backend.clone(),
        "refresh",
        config.refresh_rate_limit,
        Duration::from_secs(config.refresh_rate_window_secs),
    );
    let register_limiter = RateLimitScope::new(
        limiter_backend.clone(),
        "register",
        config.register_rate_limit,
        Duration::from_secs(config.register_rate_window_secs),
    );
    let resend_limiter = RateLimitScope::new(
        limiter_backend.clone(),
        "resend",
        config.resend_rate_limit,
        Duration::from_secs(config.resend_rate_window_secs),
    );
    let forgot_limiter = RateLimitScope::new(
        limiter_backend.clone(),
        "forgot",
        config.forgot_rate_limit,
        Duration::from_secs(config.forgot_rate_window_secs),
    );

    {
        let limiter = limiter_backend.clone();
        let mut shutdown = shutdown_rx.clone();
        background.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(3600));
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = wait_for_shutdown(&mut shutdown) => break,
                }
                limiter.cleanup();
            }
            limiter.cleanup();
        }));
    }

    if let Some(admin) = identity
        .seed_admin_with_email(
            &config.admin_login,
            &config.admin_email,
            &config.admin_password,
        )
        .context("failed to seed the initial administrator")?
    {
        tracing::info!(login = %admin.login, email = %admin.email_or_login(), "seeded the initial administrator");
    }

    if let Some(admin) = identity
        .find_by_login(&config.admin_login)
        .context("failed to read the initial administrator")?
    {
        let desired = config.admin_email.trim();
        let current_is_desired = admin
            .email
            .as_deref()
            .is_some_and(|email| email.eq_ignore_ascii_case(desired));
        if !current_is_desired {
            identity
                .update(
                    admin.id,
                    UserChanges {
                        email: Some(desired.to_string()),
                        role: None,
                        tariff_id: None,
                        group_id: None,
                        node_id: None,
                        disabled: None,
                    },
                )
                .context("failed to update the administrator email")?;
            tracing::info!(login = %admin.login, email = %desired, "updated the administrator email");
        }
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
        idempotency,
        login_limiter,
        refresh_limiter,
        register_limiter,
        resend_limiter,
        forgot_limiter,
    });

    {
        let stats = stats.clone();
        let settings = state.settings.clone();
        let mut shutdown = shutdown_rx.clone();
        background.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = wait_for_shutdown(&mut shutdown) => break,
                }
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
        }));
    }

    {
        let state = state.clone();
        let mut shutdown = shutdown_rx.clone();
        background.push(tokio::spawn(async move {
            prune_expired_records(&state).await;
            let mut ticker = tokio::time::interval(Duration::from_secs(3600));
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => prune_expired_records(&state).await,
                    _ = wait_for_shutdown(&mut shutdown) => break,
                }
            }
        }));
    }

    {
        let state = state.clone();
        let mut shutdown = shutdown_rx.clone();
        background.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(30));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = wait_for_shutdown(&mut shutdown) => break,
                }
                state.orchestration.publish_all();
            }
        }));
    }

    let grpc_state = state.clone();
    let grpc_bind = config.grpc_bind;
    let mut grpc_shutdown = shutdown_rx.clone();
    let grpc_handle = tokio::spawn(async move {
        let service = WorkerGrpc::new(grpc_state);
        tracing::info!(%grpc_bind, "worker gRPC listening");
        let result = tonic::transport::Server::builder()
            .add_service(WorkerGatewayServer::new(service))
            .serve_with_shutdown(grpc_bind, async move {
                wait_for_shutdown(&mut grpc_shutdown).await;
            })
            .await;
        if let Err(error) = result {
            tracing::error!(%error, "gRPC server stopped");
        }
    });

    let app = routes::router(state, readiness.clone());
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.bind))?;
    tracing::info!(
        bind = %config.bind,
        env = config.environment.as_str(),
        production = config.is_production(),
        log_format = log_format.as_str(),
        mail_mode = config.mail_mode.as_str(),
        rate_limit_store = config.rate_limit_store.as_str(),
        billing_enabled = config.billing.enabled,
        billing_provider = config.billing.provider.as_str(),
        http_timeout_secs = config.http_timeout_secs,
        shutdown_grace_secs = config.shutdown_grace_secs,
        "admin API listening (h2c + http/1.1)"
    );
    let mut http_shutdown = shutdown_rx.clone();
    let http_handle = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            wait_for_shutdown(&mut http_shutdown).await;
        })
        .await
        .context("HTTP server failed")
    });

    shutdown_signal().await;
    tracing::info!("shutdown signal received; draining in-flight requests");
    readiness.mark_shutting_down();
    let _ = shutdown_tx.send(true);

    let drain = async {
        if let Err(error) = http_handle.await {
            tracing::warn!(%error, "HTTP server task failed");
        }
        if let Err(error) = grpc_handle.await {
            tracing::warn!(%error, "gRPC server task failed");
        }
        for handle in background {
            let _ = handle.await;
        }
    };
    let grace = Duration::from_secs(config.shutdown_grace_secs);
    if tokio::time::timeout(grace, drain).await.is_err() {
        tracing::warn!(
            grace_secs = config.shutdown_grace_secs,
            "graceful shutdown timed out; exiting anyway"
        );
    } else {
        tracing::info!("graceful shutdown complete");
    }
    std::process::exit(0);
}

/// How long revoked share links are kept as history before pruning.
const SHARE_REVOKED_RETENTION_DAYS: i64 = 30;

async fn prune_expired_records(state: &Arc<AppState>) {
    let state = state.clone();
    let report = tokio::task::spawn_blocking(move || {
        let now = chrono::Utc::now();
        (
            state.idempotency.prune_expired(now.timestamp()),
            state.identity.prune_email_verifications(now),
            state.share.prune_expired(now, SHARE_REVOKED_RETENTION_DAYS),
        )
    })
    .await;
    let Ok((idempotency, verifications, shares)) = report else {
        tracing::warn!("expired record pruning task failed");
        return;
    };
    match idempotency {
        Ok(removed) => tracing::info!(removed, "pruned expired idempotency records"),
        Err(error) => tracing::warn!(%error, "failed to prune idempotency records"),
    }
    match verifications {
        Ok(removed) => tracing::info!(removed, "pruned expired email verifications"),
        Err(error) => tracing::warn!(%error, "failed to prune email verifications"),
    }
    match shares {
        Ok(removed) => tracing::info!(removed, "pruned expired share links"),
        Err(error) => tracing::warn!(%error, "failed to prune share links"),
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(terminate) => terminate,
            Err(error) => {
                tracing::warn!(
                    %error,
                    "failed to install the SIGTERM handler; only SIGINT is handled"
                );
                if let Err(error) = tokio::signal::ctrl_c().await {
                    tracing::warn!(%error, "failed to listen for SIGINT");
                }
                return;
            }
        };
        tokio::select! {
            result = tokio::signal::ctrl_c() => {
                if let Err(error) = result {
                    tracing::warn!(%error, "failed to listen for SIGINT");
                }
            }
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::warn!(%error, "failed to listen for SIGINT");
        }
    }
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    while !*shutdown.borrow_and_update() {
        if shutdown.changed().await.is_err() {
            return;
        }
    }
}
