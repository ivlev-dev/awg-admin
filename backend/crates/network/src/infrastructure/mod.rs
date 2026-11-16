use std::sync::Arc;

use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use crate::domain::{
    CidrPool, CidrPoolRepository, Group, GroupRepository, Interface, InterfaceRepository, Node,
    NodeRepository,
};

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

macro_rules! plain_repo {
    ($name:ident, $trait:ident, $entity:ty, $table:expr) => {
        pub struct $name {
            store: Arc<Store>,
        }

        impl $name {
            pub fn new(store: Arc<Store>) -> Self {
                Self { store }
            }
        }

        impl $trait for $name {
            fn find(&self, id: Uuid) -> CoreResult<Option<$entity>> {
                self.store.get($table, &id.to_string()).map_err(map_err)
            }

            fn list(&self) -> CoreResult<Vec<$entity>> {
                self.store.list($table).map_err(map_err)
            }

            fn save(&self, value: &$entity) -> CoreResult<()> {
                self.store
                    .put($table, &value.id.to_string(), value)
                    .map_err(map_err)
            }

            fn delete(&self, id: Uuid) -> CoreResult<()> {
                self.store.delete($table, &id.to_string()).map_err(map_err)
            }
        }
    };
}

plain_repo!(RedbGroupRepository, GroupRepository, Group, Table::Groups);
plain_repo!(RedbNodeRepository, NodeRepository, Node, Table::Nodes);

pub struct RedbInterfaceRepository {
    store: Arc<Store>,
}

impl RedbInterfaceRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl InterfaceRepository for RedbInterfaceRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Interface>> {
        self.store
            .get(Table::Interfaces, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Interface>> {
        self.store.list(Table::Interfaces).map_err(map_err)
    }

    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Interface>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|i| i.group_id == group_id)
            .collect())
    }

    fn by_node(&self, node_id: Uuid) -> CoreResult<Vec<Interface>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|i| i.node_id == node_id)
            .collect())
    }

    fn save(&self, interface: &Interface) -> CoreResult<()> {
        self.store
            .put(Table::Interfaces, &interface.id.to_string(), interface)
            .map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.store
            .delete(Table::Interfaces, &id.to_string())
            .map_err(map_err)
    }
}

pub struct RedbCidrPoolRepository {
    store: Arc<Store>,
}

impl RedbCidrPoolRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl CidrPoolRepository for RedbCidrPoolRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<CidrPool>> {
        self.store
            .get(Table::CidrPools, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<CidrPool>> {
        self.store.list(Table::CidrPools).map_err(map_err)
    }

    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<CidrPool>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|p| p.group_id == group_id)
            .collect())
    }

    fn save(&self, pool: &CidrPool) -> CoreResult<()> {
        self.store
            .put(Table::CidrPools, &pool.id.to_string(), pool)
            .map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.store
            .delete(Table::CidrPools, &id.to_string())
            .map_err(map_err)
    }
}
