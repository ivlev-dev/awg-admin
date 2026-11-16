use std::sync::Arc;

use serde::{Deserialize, Serialize};

use awg_shared::obf::ObfuscationSettings;
use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

pub const STATS_RETENTION_MIN_DAYS: u64 = 7;
pub const STATS_RETENTION_MAX_DAYS: u64 = 3_650;
pub const STATS_RETENTION_DEFAULT_DAYS: u64 = 90;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub obfuscation: ObfuscationSettings,
    pub share_default_ttl_secs: u64,
    #[serde(default = "default_stats_retention_days")]
    pub stats_retention_days: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            obfuscation: ObfuscationSettings::default(),
            share_default_ttl_secs: 86_400,
            stats_retention_days: STATS_RETENTION_DEFAULT_DAYS,
        }
    }
}

impl Settings {
    pub fn effective_stats_retention_days(&self) -> u64 {
        self.stats_retention_days
            .clamp(STATS_RETENTION_MIN_DAYS, STATS_RETENTION_MAX_DAYS)
    }

    pub fn set_stats_retention_days(&mut self, days: u64) {
        self.stats_retention_days = days.clamp(STATS_RETENTION_MIN_DAYS, STATS_RETENTION_MAX_DAYS);
    }

    fn normalize(&mut self) {
        self.stats_retention_days = self.effective_stats_retention_days();
    }
}

fn default_stats_retention_days() -> u64 {
    STATS_RETENTION_DEFAULT_DAYS
}

pub struct SettingsStore {
    store: Arc<Store>,
}

impl SettingsStore {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    pub fn get(&self) -> CoreResult<Settings> {
        let mut settings = self
            .store
            .get::<Settings>(Table::Settings, "global")
            .map_err(map_err)?
            .unwrap_or_default();
        settings.normalize();
        Ok(settings)
    }

    pub fn save(&self, settings: &Settings) -> CoreResult<()> {
        self.store
            .put(Table::Settings, "global", settings)
            .map_err(map_err)
    }
}

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_ninety_days() {
        assert_eq!(
            Settings::default().stats_retention_days,
            STATS_RETENTION_DEFAULT_DAYS
        );
    }

    #[test]
    fn clamps_retention_to_supported_range() {
        let mut settings = Settings::default();
        settings.set_stats_retention_days(1);
        assert_eq!(settings.stats_retention_days, STATS_RETENTION_MIN_DAYS);
        settings.set_stats_retention_days(10_000);
        assert_eq!(settings.stats_retention_days, STATS_RETENTION_MAX_DAYS);
        settings.set_stats_retention_days(30);
        assert_eq!(settings.stats_retention_days, 30);
    }

    #[test]
    fn deserializes_legacy_settings_with_default_retention() {
        let value = serde_json::json!({
            "obfuscation": ObfuscationSettings::default(),
            "share_default_ttl_secs": 600,
        });
        let settings: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.stats_retention_days, STATS_RETENTION_DEFAULT_DAYS);
    }

    #[test]
    fn store_round_trip_keeps_retention() {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let settings_store = SettingsStore::new(store);
        let mut settings = Settings::default();
        settings.set_stats_retention_days(14);
        settings_store.save(&settings).unwrap();
        assert_eq!(settings_store.get().unwrap().stats_retention_days, 14);
    }

    #[test]
    fn stored_out_of_range_retention_is_normalized_on_read() {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let settings = Settings {
            stats_retention_days: 1,
            ..Settings::default()
        };
        store.put(Table::Settings, "global", &settings).unwrap();
        let loaded = SettingsStore::new(store).get().unwrap();
        assert_eq!(loaded.stats_retention_days, STATS_RETENTION_MIN_DAYS);
    }
}
