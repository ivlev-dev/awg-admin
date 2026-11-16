use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    Aggregator, Bucket, CounterSample, DeviceDirectory, StatsBroadcaster, StatsRepository,
    StatsScope,
};

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

pub struct StatsService {
    repo: Arc<dyn StatsRepository>,
    broadcaster: Arc<dyn StatsBroadcaster>,
}

impl StatsService {
    pub fn new(repo: Arc<dyn StatsRepository>, broadcaster: Arc<dyn StatsBroadcaster>) -> Self {
        Self { repo, broadcaster }
    }

    pub fn record_snapshot(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        samples: &[(Uuid, CounterSample)],
        directory: &dyn DeviceDirectory,
    ) -> CoreResult<Vec<StatsUpdate>> {
        let mut updates = Vec::with_capacity(samples.len());
        for (device_id, sample) in samples {
            let previous = self.repo.counter(node_id, interface_id, *device_id)?;
            let (delta, state) = Aggregator::delta(previous, *sample);
            if delta.rx == 0 && delta.tx == 0 {
                continue;
            }
            self.repo
                .save_counter(node_id, interface_id, *device_id, &state)?;
            let hour = Aggregator::hour_of(delta.at);
            let Some((group_id, user_id)) = directory.group_and_user(*device_id)? else {
                continue;
            };
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
        Ok(updates)
    }

    pub fn series(
        &self,
        scope: StatsScope,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> CoreResult<Vec<Bucket>> {
        if to <= from {
            return Err(CoreError::Invalid("range end must be after start".into()));
        }
        self.repo
            .series(scope, Aggregator::hour_of(from), Aggregator::hour_of(to))
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

use chrono::Datelike;
