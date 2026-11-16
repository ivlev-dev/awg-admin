use std::sync::Arc;

use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use crate::application::StatsUpdate;
use crate::domain::{Bucket, CounterState, StatsBroadcaster, StatsRepository, StatsScope};

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

fn counter_key(node_id: Uuid, interface_id: Uuid, device_id: Uuid) -> String {
    format!("{node_id}:{interface_id}:{device_id}")
}

fn bucket_key(scope: StatsScope, hour: i64) -> String {
    let id = scope
        .id()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "-".into());
    format!("{}|{id}|{hour}", scope.kind())
}

pub struct RedbStatsRepository {
    store: Arc<Store>,
}

impl RedbStatsRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl StatsRepository for RedbStatsRepository {
    fn counter(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        device_id: Uuid,
    ) -> CoreResult<Option<CounterState>> {
        self.store
            .get(
                Table::PeerCounters,
                &counter_key(node_id, interface_id, device_id),
            )
            .map_err(map_err)
    }

    fn save_counter(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        device_id: Uuid,
        state: &CounterState,
    ) -> CoreResult<()> {
        self.store
            .put(
                Table::PeerCounters,
                &counter_key(node_id, interface_id, device_id),
                state,
            )
            .map_err(map_err)
    }

    fn add_bucket(&self, scope: StatsScope, hour: i64, rx: u64, tx: u64) -> CoreResult<()> {
        let key = bucket_key(scope, hour);
        let existing: Option<Bucket> = self
            .store
            .get(Table::TrafficBuckets, &key)
            .map_err(map_err)?;
        let bucket = match existing {
            Some(mut bucket) => {
                bucket.rx = bucket.rx.saturating_add(rx);
                bucket.tx = bucket.tx.saturating_add(tx);
                bucket
            }
            None => Bucket {
                scope,
                hour,
                rx,
                tx,
            },
        };
        self.store
            .put(Table::TrafficBuckets, &key, &bucket)
            .map_err(map_err)
    }

    fn series(&self, scope: StatsScope, from_hour: i64, to_hour: i64) -> CoreResult<Vec<Bucket>> {
        let mut buckets: Vec<Bucket> = self
            .store
            .list_prefix(Table::TrafficBuckets, &scope.key_prefix())
            .map_err(map_err)?
            .into_iter()
            .map(|(_, bucket): (String, Bucket)| bucket)
            .filter(|bucket| bucket.hour >= from_hour && bucket.hour <= to_hour)
            .collect();
        buckets.sort_by_key(|b| b.hour);
        Ok(buckets)
    }

    fn cleanup_before(&self, hour: i64) -> CoreResult<usize> {
        let keys = self.store.keys(Table::TrafficBuckets).map_err(map_err)?;
        let mut removed = 0;
        for key in keys {
            let Some((_, hour_part)) = key.rsplit_once('|') else {
                continue;
            };
            let Ok(stored_hour) = hour_part.parse::<i64>() else {
                continue;
            };
            if stored_hour < hour {
                self.store
                    .delete(Table::TrafficBuckets, &key)
                    .map_err(map_err)?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

pub struct StatsHub {
    sender: tokio::sync::broadcast::Sender<StatsUpdate>,
}

impl StatsHub {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = tokio::sync::broadcast::channel(capacity);
        Self { sender }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<StatsUpdate> {
        self.sender.subscribe()
    }
}

impl Default for StatsHub {
    fn default() -> Self {
        Self::new(4096)
    }
}

impl StatsBroadcaster for StatsHub {
    fn broadcast(&self, update: StatsUpdate) {
        let _ = self.sender.send(update);
    }
}
