use std::sync::Arc;

use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{Store, Table};

use crate::domain::{Tariff, TariffRepository};

pub struct RedbTariffRepository {
    store: Arc<Store>,
}

impl RedbTariffRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

fn map_err(e: awg_storage::StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

impl TariffRepository for RedbTariffRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Tariff>> {
        self.store
            .get(Table::Tariffs, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Tariff>> {
        self.store.list(Table::Tariffs).map_err(map_err)
    }

    fn save(&self, tariff: &Tariff) -> CoreResult<()> {
        self.store
            .put(Table::Tariffs, &tariff.id.to_string(), tariff)
            .map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.store
            .delete(Table::Tariffs, &id.to_string())
            .map_err(map_err)
    }
}
