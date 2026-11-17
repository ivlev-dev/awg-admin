use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Datelike, Duration, Utc};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    AggregateBucket, Aggregator, Bucket, CounterSample, CounterState, DailyBucket, DeviceDirectory,
    MonthlyBucket, Rate, StatsBroadcaster, StatsRepository, StatsScope,
};

const RATE_SNAPSHOTS: usize = 2;

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

#[derive(Debug, Default)]
struct RateTracker {
    samples: VecDeque<CounterState>,
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
}

impl StatsService {
    pub fn new(repo: Arc<dyn StatsRepository>, broadcaster: Arc<dyn StatsBroadcaster>) -> Self {
        Self {
            repo,
            broadcaster,
            rates: Mutex::new(HashMap::new()),
        }
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
        let mut updates = Vec::with_capacity(samples.len());
        let mut scoped: HashMap<StatsScope, (u64, u64)> = HashMap::new();
        let mut devices: Vec<(Uuid, CounterSample)> = Vec::with_capacity(samples.len());
        for (device_id, sample) in samples {
            let previous = self.repo.counter(node_id, interface_id, *device_id)?;
            let (mut delta, state) = Aggregator::delta(previous, *sample);
            delta.at = at;
            let Some((group_id, user_id)) = directory.group_and_user(*device_id)? else {
                continue;
            };
            devices.push((*device_id, *sample));
            for scope in [
                StatsScope::Interface(interface_id),
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
            self.repo
                .save_counter(node_id, interface_id, *device_id, &state)?;
            let hour = Aggregator::hour_of(delta.at);
            for scope in [
                StatsScope::Device(*device_id),
                StatsScope::Interface(interface_id),
                StatsScope::Group(group_id),
                StatsScope::User(user_id),
                StatsScope::Global,
            ] {
                self.repo.add_bucket(scope, hour, delta.rx, delta.tx)?;
            }
            let update = StatsUpdate {
                node_id,
                interface_id,
                device_id: *device_id,
                group_id,
                user_id,
                rx: delta.rx,
                tx: delta.tx,
                at: delta.at,
            };
            self.broadcaster.broadcast(update.clone());
            updates.push(update);
        }
        self.record_rates(&scoped, &devices, at);
        Ok(updates)
    }

    fn record_rates(
        &self,
        scoped: &HashMap<StatsScope, (u64, u64)>,
        devices: &[(Uuid, CounterSample)],
        at: DateTime<Utc>,
    ) {
        let mut guard = self
            .rates
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for (scope, (rx, tx)) in scoped {
            let tracker = guard.entry(*scope).or_default();
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
        for (device_id, sample) in devices {
            guard
                .entry(StatsScope::Device(*device_id))
                .or_default()
                .push(CounterState {
                    rx_total: sample.rx_total,
                    tx_total: sample.tx_total,
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
        let now = Utc::now();
        let start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
        self.totals(scope, start, now + Duration::seconds(1))
    }

    pub fn month(&self, scope: StatsScope) -> CoreResult<(u64, u64)> {
        let now = Utc::now();
        let start = now
            .date_naive()
            .with_day(1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        self.totals(scope, start, now + Duration::seconds(1))
    }

    pub fn used_bytes(&self, scope: StatsScope) -> CoreResult<u64> {
        let (rx, tx) = self.month(scope)?;
        Ok(rx + tx)
    }

    pub fn cleanup(&self, keep_days: i64) -> CoreResult<usize> {
        let cutoff = Aggregator::hour_of(Utc::now() - Duration::days(keep_days));
        self.repo.cleanup_before(cutoff)
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
