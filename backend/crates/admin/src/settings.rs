use std::sync::Arc;

use serde::{Deserialize, Serialize};

use awg_shared::obf::ObfuscationSettings;
use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub obfuscation: ObfuscationSettings,
    pub share_default_ttl_secs: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            obfuscation: ObfuscationSettings::default(),
            share_default_ttl_secs: 86_400,
        }
    }
}

pub struct SettingsStore {
    store: Arc<Store>,
}

impl SettingsStore {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    pub fn get(&self) -> CoreResult<Settings> {
        self.store
            .get::<Settings>(Table::Settings, "global")
            .map_err(map_err)
            .map(|value| value.unwrap_or_default())
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
