use std::sync::Arc;

use awg_audit::AuditService;
use awg_billing::BillingService;
use awg_clients::{DeviceService, ProfileService, ShareService};
use awg_identity::IdentityService;
use awg_network::NetworkService;
use awg_orchestration::{OrchestrationService, WorkerRegistry};
use awg_statistics::{StatsHub, StatsService};
use awg_tariffs::TariffService;

use crate::config::Config;
use crate::rate_limit::RateLimitScope;
use crate::settings::SettingsStore;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub identity: Arc<IdentityService>,
    pub tariffs: Arc<TariffService>,
    pub network: Arc<NetworkService>,
    pub devices: Arc<DeviceService>,
    pub profiles: Arc<ProfileService>,
    pub share: Arc<ShareService>,
    pub stats: Arc<StatsService>,
    pub stats_hub: Arc<StatsHub>,
    pub registry: Arc<WorkerRegistry>,
    pub orchestration: Arc<OrchestrationService>,
    pub settings: Arc<SettingsStore>,
    pub audit: Arc<AuditService>,
    pub billing: Arc<BillingService>,
    pub login_limiter: RateLimitScope,
    pub refresh_limiter: RateLimitScope,
    pub register_limiter: RateLimitScope,
    pub resend_limiter: RateLimitScope,
    pub forgot_limiter: RateLimitScope,
}
