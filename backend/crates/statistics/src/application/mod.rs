use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Datelike, Duration, Utc};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    AggregateBucket, Aggregator, Bucket, BucketDelta, CounterEntry, CounterKey, CounterSample,
    CounterState, DailyBucket, DeviceDirectory, MonthlyBucket, Rate, StatsBroadcaster,
    StatsRepository, StatsScope,
};

const RATE_SNAPSHOTS: usize = 2;

/// Rate trackers that were not refreshed for this long belong to entities
/// that no longer report traffic and are dropped by [`StatsService::cleanup`].
const RATE_TRACKER_TTL_HOURS: i64 = 24;

#[derive(Debug, Clone, serde::Serialize)]
pub struct StatsUpdate {
    pub node_id: Uuid,
    pub interface_id: Uuid,
    pub device_id: Uuid,
    pub group_id: Uuid,
    pub user_id: Uuid,
    pub rx: u64,
    pub tx: u64,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct SeriesPoint {
    pub bucket: Bucket,
    pub rate: Rate,
}

#[derive(Debug)]
struct RateTracker {
    samples: VecDeque<CounterState>,
    updated_at: DateTime<Utc>,
}

impl Default for RateTracker {
    fn default() -> Self {
        Self {
            samples: VecDeque::new(),
            updated_at: DateTime::<Utc>::UNIX_EPOCH,
        }
    }
}

impl RateTracker {
    fn push(&mut self, state: CounterState) {
        if self.samples.len() >= RATE_SNAPSHOTS {
            self.samples.pop_front();
        }
        self.samples.push_back(state);
    }

    fn current(&self) -> Option<Rate> {
        if self.samples.len() < RATE_SNAPSHOTS {
            return None;
        }
        let previous = *self.samples.front()?;
        let current = *self.samples.back()?;
        Rate::between(previous, current)
    }
}

pub struct StatsService {
    repo: Arc<dyn StatsRepository>,
    broadcaster: Arc<dyn StatsBroadcaster>,
    rates: Mutex<HashMap<StatsScope, RateTracker>>,
    /// Serializes snapshot application per node so that two concurrent
    /// snapshots cannot both observe the same "previous" counters.
    node_locks: Mutex<HashMap<Uuid, Arc<Mutex<()>>>>,
}

impl StatsService {
    pub fn new(repo: Arc<dyn StatsRepository>, broadcaster: Arc<dyn StatsBroadcaster>) -> Self {
        Self {
            repo,
            broadcaster,
            rates: Mutex::new(HashMap::new()),
            node_locks: Mutex::new(HashMap::new()),
        }
    }

    fn node_lock(&self, node_id: Uuid) -> Arc<Mutex<()>> {
        let mut locks = self
            .node_locks
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        locks.entry(node_id).or_default().clone()
    }

    pub fn current_rate(&self, scope: &StatsScope) -> Option<Rate> {
        let guard = self
            .rates
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        guard.get(scope).and_then(RateTracker::current)
    }

    pub fn record_snapshot(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        samples: &[(Uuid, CounterSample)],
        directory: &dyn DeviceDirectory,
    ) -> CoreResult<Vec<StatsUpdate>> {
        self.record_snapshot_at(node_id, interface_id, samples, directory, Utc::now())
    }

    pub fn record_snapshot_at(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        samples: &[(Uuid, CounterSample)],
        directory: &dyn DeviceDirectory,
        at: DateTime<Utc>,
    ) -> CoreResult<Vec<StatsUpdate>> {
        let samples: Vec<(Uuid, Uuid, CounterSample)> = samples
            .iter()
            .map(|(device_id, sample)| (interface_id, *device_id, *sample))
            .collect();
        self.record_node_snapshot_at(node_id, &samples, directory, at)
    }

    pub fn record_node_snapshot(
        &self,
        node_id: Uuid,
        samples: &[(Uuid, Uuid, CounterSample)],
        directory: &dyn DeviceDirectory,
    ) -> CoreResult<Vec<StatsUpdate>> {
        self.record_node_snapshot_at(node_id, samples, directory, Utc::now())
    }

    pub fn record_node_snapshot_at(
        &self,
        node_id: Uuid,
        samples: &[(Uuid, Uuid, CounterSample)],
        directory: &dyn DeviceDirectory,
        at: DateTime<Utc>,
    ) -> CoreResult<Vec<StatsUpdate>> {
        if samples.is_empty() {
            return Ok(Vec::new());
        }
        let lock = self.node_lock(node_id);
        let _guard = lock.lock().unwrap_or_else(|poison| poison.into_inner());

        let keys: Vec<CounterKey> = samples
            .iter()
            .map(|(interface_id, device_id, sample)| CounterKey {
                node_id,
                interface_id: *interface_id,
                device_id: *device_id,
                peer_id: sample.peer_id,
            })
            .collect();
        let previous = self.repo.counters(&keys)?;

        let mut device_ids: Vec<Uuid> =
            samples.iter().map(|(_, device_id, _)| *device_id).collect();
        device_ids.sort_unstable();
        device_ids.dedup();
        let directory_map = directory.group_and_user_many(&device_ids)?;

        let mut counters = Vec::with_capacity(samples.len());
        let mut bucket_deltas: HashMap<(StatsScope, i64), (u64, u64)> = HashMap::new();
        let mut device_updates: BTreeMap<(Uuid, Uuid), (Uuid, Uuid, u64, u64)> = BTreeMap::new();
        let mut scoped: HashMap<StatsScope, (u64, u64)> = HashMap::new();
        let mut device_totals: HashMap<Uuid, (u64, u64)> = HashMap::new();

        for (interface_id, device_id, sample) in samples {
            let key = CounterKey {
                node_id,
                interface_id: *interface_id,
                device_id: *device_id,
                peer_id: sample.peer_id,
            };
            let Some((group_id, user_id)) = directory_map.get(device_id).copied() else {
                continue;
            };
            let totals = device_totals.entry(*device_id).or_default();
            totals.0 = totals.0.saturating_add(sample.rx_total);
            totals.1 = totals.1.saturating_add(sample.tx_total);

            let (mut delta, state) = Aggregator::delta(previous.get(&key).copied(), *sample);
            delta.at = at;
            for scope in [
                StatsScope::Interface(*interface_id),
                StatsScope::Group(group_id),
                StatsScope::User(user_id),
                StatsScope::Global,
            ] {
                let entry = scoped.entry(scope).or_default();
                entry.0 = entry.0.saturating_add(delta.rx);
                entry.1 = entry.1.saturating_add(delta.tx);
            }
            if delta.rx == 0 && delta.tx == 0 {
                continue;
            }
            counters.push(CounterEntry { key, state });
            let hour = Aggregator::hour_of(delta.at);
            for scope in [
                StatsScope::Device(*device_id),
                StatsScope::Interface(*interface_id),
                StatsScope::Group(group_id),
                StatsScope::User(user_id),
                StatsScope::Global,
            ] {
                let entry = bucket_deltas.entry((scope, hour)).or_default();
                entry.0 = entry.0.saturating_add(delta.rx);
                entry.1 = entry.1.saturating_add(delta.tx);
            }
            let update = device_updates
                .entry((*interface_id, *device_id))
                .or_insert((group_id, user_id, 0, 0));
            update.2 = update.2.saturating_add(delta.rx);
            update.3 = update.3.saturating_add(delta.tx);
        }

        let buckets: Vec<BucketDelta> = {
            let mut buckets: Vec<BucketDelta> = bucket_deltas
                .into_iter()
                .filter(|(_, (rx, tx))| *rx > 0 || *tx > 0)
                .map(|((scope, hour), (rx, tx))| BucketDelta {
                    scope,
                    hour,
                    rx,
                    tx,
                })
                .collect();
            buckets.sort_by_key(|delta| (delta.hour, delta.scope.kind(), delta.scope.id()));
            buckets
        };

        if !counters.is_empty() || !buckets.is_empty() {
            self.repo.commit_snapshot(&counters, &buckets)?;
        }

        let mut updates = Vec::with_capacity(device_updates.len());
        for ((interface_id, device_id), (group_id, user_id, rx, tx)) in device_updates {
            let update = StatsUpdate {
                node_id,
                interface_id,
                device_id,
                group_id,
                user_id,
                rx,
                tx,
                at,
            };
            self.broadcaster.broadcast(update.clone());
            updates.push(update);
        }
        self.record_rates(&scoped, &device_totals, at);
        Ok(updates)
    }

    fn record_rates(
        &self,
        scoped: &HashMap<StatsScope, (u64, u64)>,
        devices: &HashMap<Uuid, (u64, u64)>,
        at: DateTime<Utc>,
    ) {
        let mut guard = self
            .rates
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for (scope, (rx, tx)) in scoped {
            let tracker = guard.entry(*scope).or_default();
            tracker.updated_at = at;
            let state = match tracker.samples.back() {
                Some(last) => CounterState {
                    rx_total: last.rx_total.saturating_add(*rx),
                    tx_total: last.tx_total.saturating_add(*tx),
                    updated_at: at,
                },
                None => CounterState {
                    rx_total: *rx,
                    tx_total: *tx,
                    updated_at: at,
                },
            };
            tracker.push(state);
        }
        for (device_id, (rx_total, tx_total)) in devices {
            let tracker = guard.entry(StatsScope::Device(*device_id)).or_default();
            tracker.updated_at = at;
            tracker.push(CounterState {
                rx_total: *rx_total,
                tx_total: *tx_total,
                updated_at: at,
            });
        }
    }

    pub fn series(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<Vec<Bucket>> {
        Ok(self
            .series_with_rates(scope, from, to)?
            .into_iter()
            .map(|point| point.bucket)
            .collect())
    }

    pub fn series_with_rates(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<Vec<SeriesPoint>> {
        if to <= from {
            return Err(CoreError::Invalid("range end must be after start".into()));
        }
        Ok(with_rates(self.repo.series(
            scope,
            Aggregator::hour_of(from),
            Aggregator::hour_of(to),
        )?))
    }

    pub fn totals(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<(u64, u64)> {
        let series = self.series(scope, from, to)?;
        Ok(series
            .iter()
            .fold((0u64, 0u64), |acc, b| (acc.0 + b.rx, acc.1 + b.tx)))
    }

    pub fn totals_many(
        &self,
        scopes: &[StatsScope],
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<HashMap<StatsScope, (u64, u64)>> {
        if to <= from {
            return Err(CoreError::Invalid("range end must be after start".into()));
        }
        if scopes.is_empty() {
            return Ok(HashMap::new());
        }
        self.repo
            .totals_many(scopes, Aggregator::hour_of(from), Aggregator::hour_of(to))
    }

    pub fn daily(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<Vec<DailyBucket>> {
        validate_window(AggregateBucket::Day, from, to)?;
        let series = self.hourly(scope, from, to)?;
        let mut grouped: BTreeMap<i64, (u64, u64)> = BTreeMap::new();
        for bucket in series {
            let entry = grouped
                .entry(Aggregator::day_of_hour(bucket.hour))
                .or_default();
            entry.0 = entry.0.saturating_add(bucket.rx);
            entry.1 = entry.1.saturating_add(bucket.tx);
        }
        Ok(grouped
            .into_iter()
            .map(|(day, (rx, tx))| DailyBucket { day, rx, tx })
            .collect())
    }

    pub fn monthly(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<Vec<MonthlyBucket>> {
        validate_window(AggregateBucket::Month, from, to)?;
        let series = self.hourly(scope, from, to)?;
        let mut grouped: BTreeMap<String, (u64, u64)> = BTreeMap::new();
        for bucket in series {
            let Some(at) = DateTime::from_timestamp(bucket.hour, 0) else {
                continue;
            };
            let entry = grouped.entry(Aggregator::month_of(at)).or_default();
            entry.0 = entry.0.saturating_add(bucket.rx);
            entry.1 = entry.1.saturating_add(bucket.tx);
        }
        Ok(grouped
            .into_iter()
            .map(|(month, (rx, tx))| MonthlyBucket { month, rx, tx })
            .collect())
    }

    fn hourly(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<Vec<Bucket>> {
        self.repo
            .series(scope, Aggregator::hour_of(from), Aggregator::hour_of(to))
    }

    pub fn today(&self, scope: StatsScope) -> CoreResult<(u64, u64)> {
        let (start, end) = day_range(Utc::now());
        self.totals(scope, start, end)
    }

    pub fn today_many(&self, scopes: &[StatsScope]) -> CoreResult<HashMap<StatsScope, (u64, u64)>> {
        let (start, end) = day_range(Utc::now());
        self.totals_many(scopes, start, end)
    }

    /// Today's totals for every device in one backend pass.
    pub fn today_device_totals(&self) -> CoreResult<HashMap<Uuid, (u64, u64)>> {
        let (start, end) = day_range(Utc::now());
        self.repo
            .device_totals(Aggregator::hour_of(start), Aggregator::hour_of(end))
    }

    pub fn month(&self, scope: StatsScope) -> CoreResult<(u64, u64)> {
        let (start, end) = month_range(Utc::now());
        self.totals(scope, start, end)
    }

    pub fn month_many(&self, scopes: &[StatsScope]) -> CoreResult<HashMap<StatsScope, (u64, u64)>> {
        let (start, end) = month_range(Utc::now());
        self.totals_many(scopes, start, end)
    }

    pub fn used_bytes(&self, scope: StatsScope) -> CoreResult<u64> {
        let (rx, tx) = self.month(scope)?;
        Ok(rx + tx)
    }

    pub fn used_bytes_many(&self, scopes: &[StatsScope]) -> CoreResult<HashMap<StatsScope, u64>> {
        Ok(self
            .month_many(scopes)?
            .into_iter()
            .map(|(scope, (rx, tx))| (scope, rx.saturating_add(tx)))
            .collect())
    }

    pub fn cleanup(&self, keep_days: i64) -> CoreResult<usize> {
        let now = Utc::now();
        let cutoff = Aggregator::hour_of(now - Duration::days(keep_days));
        let removed = self.repo.cleanup_before(cutoff)?;
        self.cleanup_rate_trackers(now);
        Ok(removed)
    }

    /// Drops rate trackers for scopes that stopped reporting traffic. Without
    /// this the map grows forever as devices, users and groups are deleted.
    fn cleanup_rate_trackers(&self, now: DateTime<Utc>) -> usize {
        let mut guard = self
            .rates
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let before = guard.len();
        guard.retain(|_, tracker| {
            now.signed_duration_since(tracker.updated_at) <= Duration::hours(RATE_TRACKER_TTL_HOURS)
        });
        before - guard.len()
    }
}

fn with_rates(mut buckets: Vec<Bucket>) -> Vec<SeriesPoint> {
    buckets.sort_by_key(|bucket| bucket.hour);
    let mut points = Vec::with_capacity(buckets.len());
    let mut previous_hour: Option<i64> = None;
    for bucket in buckets {
        let rate = match previous_hour {
            Some(previous) if bucket.hour > previous => {
                let seconds = (bucket.hour - previous) as f64;
                Rate {
                    rx_bps: bucket.rx as f64 / seconds,
                    tx_bps: bucket.tx as f64 / seconds,
                }
            }
            _ => Rate::ZERO,
        };
        previous_hour = Some(bucket.hour);
        points.push(SeriesPoint { bucket, rate });
    }
    points
}

fn day_range(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    let start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    (start, now + Duration::seconds(1))
}

fn month_range(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    let start = now
        .date_naive()
        .with_day(1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    (start, now + Duration::seconds(1))
}

fn validate_window(
    bucket: AggregateBucket,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> CoreResult<()> {
    if to < from {
        return Err(CoreError::Invalid(
            "range end must not be before start".into(),
        ));
    }
    let limit = Duration::days(bucket.max_window_days());
    if to - from > limit {
        return Err(CoreError::Invalid(format!(
            "range for {} buckets must not exceed {} days",
            bucket.as_str(),
            bucket.max_window_days()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use awg_storage::Store;

    use super::*;
    use crate::infrastructure::{RedbStatsRepository, StatsHub};

    struct FixedDirectory {
        group_id: Uuid,
        user_id: Uuid,
    }

    impl DeviceDirectory for FixedDirectory {
        fn group_and_user(&self, _device_id: Uuid) -> CoreResult<Option<(Uuid, Uuid)>> {
            Ok(Some((self.group_id, self.user_id)))
        }
    }

    #[test]
    fn cleanup_drops_stale_rate_trackers_only() {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let repo = Arc::new(RedbStatsRepository::new(store));
        let service = StatsService::new(repo, Arc::new(StatsHub::new(8)));
        let directory = FixedDirectory {
            group_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
        };
        let node_id = Uuid::new_v4();
        let interface_id = Uuid::new_v4();
        let now = Utc::now();
        let stale_device = Uuid::new_v4();
        let fresh_device = Uuid::new_v4();

        for (device_id, at) in [
            (stale_device, now - Duration::hours(48)),
            (fresh_device, now),
        ] {
            let samples = [(
                interface_id,
                device_id,
                CounterSample {
                    peer_id: Uuid::new_v4(),
                    rx_total: 10,
                    tx_total: 20,
                },
            )];
            service
                .record_node_snapshot_at(node_id, &samples, &directory, at)
                .unwrap();
        }

        service.cleanup(3_650).unwrap();

        let rates = service
            .rates
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(rates.contains_key(&StatsScope::Device(fresh_device)));
        assert!(!rates.contains_key(&StatsScope::Device(stale_device)));
        // Shared scopes were refreshed by the fresh snapshot.
        assert!(rates.contains_key(&StatsScope::Global));
    }
}
