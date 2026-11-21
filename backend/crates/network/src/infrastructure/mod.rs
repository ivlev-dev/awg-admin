use std::sync::Arc;

use chrono::{DateTime, Utc};
use redb::ReadableTable;
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table, lookup_index};

use crate::domain::{
    CidrPool, CidrPoolRepository, Group, GroupRepository, Interface, InterfaceRepository, Node,
    NodeMetricsUpdate, NodeRepository, NodeStatus, token_hash_matches,
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

pub struct RedbNodeRepository {
    store: Arc<Store>,
}

impl RedbNodeRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl NodeRepository for RedbNodeRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Node>> {
        self.store
            .get(Table::Nodes, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Node>> {
        self.store.list(Table::Nodes).map_err(map_err)
    }

    fn save(&self, node: &Node) -> CoreResult<()> {
        let key = node.id.to_string();
        let bytes = serde_json::to_vec(node)
            .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
        self.store
            .with_write_txn(|txn| {
                let previous: Option<Node> = {
                    let table = txn.open_table(Table::Nodes.definition())?;
                    match table.get(key.as_str())? {
                        Some(value) => Some(serde_json::from_slice(value.value())?),
                        None => None,
                    }
                };
                {
                    let mut table = txn.open_table(Table::Nodes.definition())?;
                    table.insert(key.as_str(), bytes.as_slice())?;
                }
                if let Some(previous) = &previous
                    && previous.token_hash != node.token_hash
                {
                    lookup_index::remove_node_token(txn, &previous.token_hash)?;
                }
                lookup_index::insert_node_token(txn, &node.token_hash, &key)?;
                Ok(())
            })
            .map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        let key = id.to_string();
        self.store
            .with_write_txn(|txn| {
                let previous: Option<Node> = {
                    let mut table = txn.open_table(Table::Nodes.definition())?;
                    let previous = match table.get(key.as_str())? {
                        Some(value) => Some(serde_json::from_slice(value.value())?),
                        None => None,
                    };
                    table.remove(key.as_str())?;
                    previous
                };
                if let Some(previous) = previous {
                    lookup_index::remove_node_token(txn, &previous.token_hash)?;
                }
                Ok(())
            })
            .map_err(map_err)
    }

    fn find_by_token_hash(&self, token_hash: &str) -> CoreResult<Option<Node>> {
        let Some(id) =
            lookup_index::find_node_id_by_token_hash(&self.store, token_hash).map_err(map_err)?
        else {
            return Ok(None);
        };
        let Ok(id) = Uuid::parse_str(&id) else {
            return Ok(None);
        };
        let node = self.find(id)?;
        Ok(node.filter(|node| token_hash_matches(&node.token_hash, token_hash)))
    }

    fn record_metrics(&self, id: Uuid, metrics: &NodeMetricsUpdate) -> CoreResult<Node> {
        let key = id.to_string();
        let now = Utc::now();
        self.store
            .update::<Node, Option<Node>>(Table::Nodes, &key, |current| match current {
                Some(mut node) => {
                    node.cpu_load = Some(metrics.cpu_load);
                    node.mem_used_bytes = Some(metrics.mem_used_bytes);
                    node.mem_total_bytes = Some(metrics.mem_total_bytes);
                    node.kernel_version = Some(metrics.kernel_version.clone());
                    node.worker_version = Some(metrics.worker_version.clone());
                    node.uptime_secs = Some(metrics.uptime_secs);
                    node.metrics_at = Some(now);
                    (Some(node.clone()), Some(node))
                }
                None => (None, None),
            })
            .map_err(map_err)?
            .ok_or_else(|| CoreError::NotFound("node".into()))
    }

    fn set_status(
        &self,
        id: Uuid,
        status: NodeStatus,
        last_seen: DateTime<Utc>,
        version: Option<String>,
    ) -> CoreResult<Node> {
        let key = id.to_string();
        self.store
            .update::<Node, Option<Node>>(Table::Nodes, &key, |current| match current {
                Some(mut node) => {
                    node.status = status;
                    node.last_seen = Some(last_seen);
                    if version.is_some() {
                        node.version = version;
                    }
                    (Some(node.clone()), Some(node))
                }
                None => (None, None),
            })
            .map_err(map_err)?
            .ok_or_else(|| CoreError::NotFound("node".into()))
    }
}

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
