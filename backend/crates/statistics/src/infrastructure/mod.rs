use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use redb::ReadableTable;
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table, prefix_upper_bound};

use crate::application::StatsUpdate;
use crate::domain::{
    Bucket, BucketDelta, CounterEntry, CounterKey, CounterState, StatsBroadcaster, StatsRepository,
    StatsScope,
};

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

fn counter_key(key: CounterKey) -> String {
    format!(
        "{}:{}:{}:{}",
        key.node_id, key.interface_id, key.device_id, key.peer_id
    )
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
    write_transactions: AtomicUsize,
    device_scans: AtomicUsize,
}

impl RedbStatsRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self {
            store,
            write_transactions: AtomicUsize::new(0),
            device_scans: AtomicUsize::new(0),
        }
    }

    pub fn write_transaction_count(&self) -> usize {
        self.write_transactions.load(Ordering::SeqCst)
    }

    /// Number of full device-bucket scans performed by [`Self::device_totals`].
    pub fn device_scan_count(&self) -> usize {
        self.device_scans.load(Ordering::SeqCst)
    }
}

impl StatsRepository for RedbStatsRepository {
    fn counter(&self, key: CounterKey) -> CoreResult<Option<CounterState>> {
        self.store
            .get(Table::PeerCounters, &counter_key(key))
            .map_err(map_err)
    }

    fn save_counter(&self, key: CounterKey, state: &CounterState) -> CoreResult<()> {
        self.store
            .put(Table::PeerCounters, &counter_key(key), state)
            .map_err(map_err)
    }

    fn add_bucket(&self, scope: StatsScope, hour: i64, rx: u64, tx: u64) -> CoreResult<()> {
        let key = bucket_key(scope, hour);
        self.store
            .update::<Bucket, _>(Table::TrafficBuckets, &key, |current| {
                (Some(merge_bucket(current, scope, hour, rx, tx)), ())
            })
            .map_err(map_err)
    }

    fn counters(&self, keys: &[CounterKey]) -> CoreResult<HashMap<CounterKey, CounterState>> {
        self.store
            .with_read_txn(|txn| {
                let table = txn.open_table(Table::PeerCounters.definition())?;
                let mut out = HashMap::with_capacity(keys.len());
                for key in keys {
                    let Some(bytes) = table.get(counter_key(*key).as_str())? else {
                        continue;
                    };
                    out.insert(*key, serde_json::from_slice(bytes.value())?);
                }
                Ok(out)
            })
            .map_err(map_err)
    }

    fn save_counters(&self, entries: &[CounterEntry]) -> CoreResult<()> {
        self.store
            .with_write_txn(|txn| {
                let mut table = txn.open_table(Table::PeerCounters.definition())?;
                for entry in entries {
                    let bytes = serde_json::to_vec(&entry.state)?;
                    table.insert(counter_key(entry.key).as_str(), bytes.as_slice())?;
                }
                Ok(())
            })
            .map_err(map_err)
    }

    fn add_buckets_batch(&self, deltas: &[BucketDelta]) -> CoreResult<()> {
        self.store
            .with_write_txn(|txn| {
                let mut table = txn.open_table(Table::TrafficBuckets.definition())?;
                for delta in deltas {
                    let key = bucket_key(delta.scope, delta.hour);
                    let current: Option<Bucket> = match table.get(key.as_str())? {
                        Some(bytes) => Some(serde_json::from_slice(bytes.value())?),
                        None => None,
                    };
                    let bucket = merge_bucket(current, delta.scope, delta.hour, delta.rx, delta.tx);
                    let bytes = serde_json::to_vec(&bucket)?;
                    table.insert(key.as_str(), bytes.as_slice())?;
                }
                Ok(())
            })
            .map_err(map_err)
    }

    fn commit_snapshot(
        &self,
        counters: &[CounterEntry],
        buckets: &[BucketDelta],
    ) -> CoreResult<()> {
        self.write_transactions.fetch_add(1, Ordering::SeqCst);
        self.store
            .with_write_txn(|txn| {
                {
                    let mut table = txn.open_table(Table::PeerCounters.definition())?;
                    for entry in counters {
                        let bytes = serde_json::to_vec(&entry.state)?;
                        table.insert(counter_key(entry.key).as_str(), bytes.as_slice())?;
                    }
                }
                {
                    let mut table = txn.open_table(Table::TrafficBuckets.definition())?;
                    for delta in buckets {
                        let key = bucket_key(delta.scope, delta.hour);
                        let current: Option<Bucket> = match table.get(key.as_str())? {
                            Some(bytes) => Some(serde_json::from_slice(bytes.value())?),
                            None => None,
                        };
                        let bucket =
                            merge_bucket(current, delta.scope, delta.hour, delta.rx, delta.tx);
                        let bytes = serde_json::to_vec(&bucket)?;
                        table.insert(key.as_str(), bytes.as_slice())?;
                    }
                }
                Ok(())
            })
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

    fn totals_many(
        &self,
        scopes: &[StatsScope],
        from_hour: i64,
        to_hour: i64,
    ) -> CoreResult<HashMap<StatsScope, (u64, u64)>> {
        self.store
            .with_read_txn(|txn| {
                let table = txn.open_table(Table::TrafficBuckets.definition())?;
                let mut out = HashMap::with_capacity(scopes.len());
                for scope in scopes {
                    let prefix = scope.key_prefix();
                    let mut totals = (0u64, 0u64);
                    let upper = prefix_upper_bound(&prefix);
                    match upper {
                        Some(upper) => {
                            for entry in table.range::<&str>(prefix.as_str()..upper.as_str())? {
                                let (_, value) = entry?;
                                let bucket: Bucket = serde_json::from_slice(value.value())?;
                                accumulate(&mut totals, &bucket, from_hour, to_hour);
                            }
                        }
                        None => {
                            for entry in table.range::<&str>(prefix.as_str()..)? {
                                let (_, value) = entry?;
                                let bucket: Bucket = serde_json::from_slice(value.value())?;
                                accumulate(&mut totals, &bucket, from_hour, to_hour);
                            }
                        }
                    }
                    out.insert(*scope, totals);
                }
                Ok(out)
            })
            .map_err(map_err)
    }

    fn device_totals(&self, from_hour: i64, to_hour: i64) -> CoreResult<HashMap<Uuid, (u64, u64)>> {
        self.device_scans.fetch_add(1, Ordering::SeqCst);
        let prefix = format!("{}|", StatsScope::Device(Uuid::nil()).kind());
        self.store
            .with_read_txn(|txn| {
                let table = txn.open_table(Table::TrafficBuckets.definition())?;
                let mut out: HashMap<Uuid, (u64, u64)> = HashMap::new();
                let Some(upper) = prefix_upper_bound(&prefix) else {
                    return Ok(out);
                };
                for entry in table.range::<&str>(prefix.as_str()..upper.as_str())? {
                    let (key, value) = entry?;
                    let bucket: Bucket = serde_json::from_slice(value.value())?;
                    if bucket.hour < from_hour || bucket.hour > to_hour {
                        continue;
                    }
                    let Some(id) = key
                        .value()
                        .strip_prefix(&prefix)
                        .and_then(|rest| rest.split('|').next())
                        .and_then(|id| Uuid::parse_str(id).ok())
                    else {
                        continue;
                    };
                    let totals = out.entry(id).or_default();
                    totals.0 = totals.0.saturating_add(bucket.rx);
                    totals.1 = totals.1.saturating_add(bucket.tx);
                }
                Ok(out)
            })
            .map_err(map_err)
    }

    fn cleanup_before(&self, hour: i64) -> CoreResult<usize> {
        let keys = self.store.keys(Table::TrafficBuckets).map_err(map_err)?;
        let mut stale = Vec::new();
        for key in keys {
            let Some((_, hour_part)) = key.rsplit_once('|') else {
                continue;
            };
            let Ok(stored_hour) = hour_part.parse::<i64>() else {
                continue;
            };
            if stored_hour < hour {
                stale.push(key);
            }
        }
        let mut removed = 0;
        for chunk in stale.chunks(256) {
            self.store
                .with_write_txn(|txn| {
                    let mut table = txn.open_table(Table::TrafficBuckets.definition())?;
                    for key in chunk {
                        table.remove(key.as_str())?;
                    }
                    Ok(())
                })
                .map_err(map_err)?;
            removed += chunk.len();
        }
        Ok(removed)
    }
}

fn merge_bucket(current: Option<Bucket>, scope: StatsScope, hour: i64, rx: u64, tx: u64) -> Bucket {
    match current {
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
    }
}

fn accumulate(totals: &mut (u64, u64), bucket: &Bucket, from_hour: i64, to_hour: i64) {
    if bucket.hour < from_hour || bucket.hour > to_hour {
        return;
    }
    totals.0 = totals.0.saturating_add(bucket.rx);
    totals.1 = totals.1.saturating_add(bucket.tx);
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
