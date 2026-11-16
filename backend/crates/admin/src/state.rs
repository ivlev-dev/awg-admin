use std::sync::Arc;

use awg_clients::{DeviceService, ProfileService, ShareService};
use awg_identity::IdentityService;
use awg_network::NetworkService;
use awg_orchestration::{OrchestrationService, WorkerRegistry};
use awg_shared::crypto::Sealer;
use awg_statistics::{StatsHub, StatsService};
use awg_storage::Store;
use awg_tariffs::TariffService;

use crate::config::Config;
use crate::settings::SettingsStore;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub store: Arc<Store>,
    pub sealer: Arc<Sealer>,
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
}
