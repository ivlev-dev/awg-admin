use std::collections::HashMap;

use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "scope", content = "id")]
pub enum StatsScope {
    Global,
    User(Uuid),
    Group(Uuid),
    Interface(Uuid),
    Device(Uuid),
}

impl StatsScope {
    pub fn kind(&self) -> &'static str {
        match self {
            StatsScope::Global => "global",
            StatsScope::User(_) => "user",
            StatsScope::Group(_) => "group",
            StatsScope::Interface(_) => "interface",
            StatsScope::Device(_) => "device",
        }
    }

    pub fn id(&self) -> Option<Uuid> {
        match self {
            StatsScope::Global => None,
            StatsScope::User(id)
            | StatsScope::Group(id)
            | StatsScope::Interface(id)
            | StatsScope::Device(id) => Some(*id),
        }
    }

    pub fn key_prefix(&self) -> String {
        match self.id() {
            Some(id) => format!("{}|{id}|", self.kind()),
            None => "global|-|".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CounterSample {
    pub peer_id: Uuid,
    pub rx_total: u64,
    pub tx_total: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CounterKey {
    pub node_id: Uuid,
    pub interface_id: Uuid,
    pub device_id: Uuid,
    pub peer_id: Uuid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CounterEntry {
    pub key: CounterKey,
    pub state: CounterState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BucketDelta {
    pub scope: StatsScope,
    pub hour: i64,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CounterState {
    pub rx_total: u64,
    pub tx_total: u64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrafficDelta {
    pub rx: u64,
    pub tx: u64,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Rate {
    pub rx_bps: f64,
    pub tx_bps: f64,
}

impl Rate {
    pub const ZERO: Self = Self {
        rx_bps: 0.0,
        tx_bps: 0.0,
    };

    pub fn between(previous: CounterState, current: CounterState) -> Option<Self> {
        let seconds = current
            .updated_at
            .signed_duration_since(previous.updated_at)
            .num_milliseconds() as f64
            / 1_000.0;
        if seconds <= 0.0 {
            return None;
        }
        if current.rx_total < previous.rx_total || current.tx_total < previous.tx_total {
            return Some(Self::ZERO);
        }
        Some(Self {
            rx_bps: (current.rx_total - previous.rx_total) as f64 / seconds,
            tx_bps: (current.tx_total - previous.tx_total) as f64 / seconds,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bucket {
    pub scope: StatsScope,
    pub hour: i64,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailyBucket {
    pub day: i64,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonthlyBucket {
    pub month: String,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggregateBucket {
    Day,
    Month,
}

impl AggregateBucket {
    pub const DAY_MAX_WINDOW_DAYS: i64 = 366;
    pub const MONTH_MAX_WINDOW_DAYS: i64 = 3_660;

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "day" => Some(Self::Day),
            "month" => Some(Self::Month),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Month => "month",
        }
    }

    pub fn max_window_days(self) -> i64 {
        match self {
            Self::Day => Self::DAY_MAX_WINDOW_DAYS,
            Self::Month => Self::MONTH_MAX_WINDOW_DAYS,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DeviceScope {
    pub device_id: Uuid,
    pub interface_id: Uuid,
    pub group_id: Uuid,
    pub user_id: Uuid,
}

pub struct Aggregator;

impl Aggregator {
    pub fn delta(
        previous: Option<CounterState>,
        sample: CounterSample,
    ) -> (TrafficDelta, CounterState) {
        let (rx, tx) = match previous {
            Some(prev) => {
                let rx = if sample.rx_total >= prev.rx_total {
                    sample.rx_total - prev.rx_total
                } else {
                    sample.rx_total
                };
                let tx = if sample.tx_total >= prev.tx_total {
                    sample.tx_total - prev.tx_total
                } else {
                    sample.tx_total
                };
                (rx, tx)
            }
            None => (sample.rx_total, sample.tx_total),
        };
        (
            TrafficDelta {
                rx,
                tx,
                at: Utc::now(),
            },
            CounterState {
                rx_total: sample.rx_total,
                tx_total: sample.tx_total,
                updated_at: Utc::now(),
            },
        )
    }

    pub fn hour_of(at: DateTime<Utc>) -> i64 {
        at.timestamp() / 3600 * 3600
    }

    pub fn day_of(at: DateTime<Utc>) -> i64 {
        Self::day_of_hour(at.timestamp())
    }

    pub fn day_of_hour(hour: i64) -> i64 {
        hour.div_euclid(86_400) * 86_400
    }

    pub fn month_of(at: DateTime<Utc>) -> String {
        format!("{:04}-{:02}", at.year(), at.month())
    }
}

pub trait StatsRepository: Send + Sync {
    fn counter(&self, key: CounterKey) -> awg_shared::CoreResult<Option<CounterState>>;
    fn save_counter(&self, key: CounterKey, state: &CounterState) -> awg_shared::CoreResult<()>;
    fn add_bucket(
        &self,
        scope: StatsScope,
        hour: i64,
        rx: u64,
        tx: u64,
    ) -> awg_shared::CoreResult<()>;
    fn series(
        &self,
        scope: StatsScope,
        from_hour: i64,
        to_hour: i64,
    ) -> awg_shared::CoreResult<Vec<Bucket>>;
    fn cleanup_before(&self, hour: i64) -> awg_shared::CoreResult<usize>;

    fn counters(
        &self,
        keys: &[CounterKey],
    ) -> awg_shared::CoreResult<HashMap<CounterKey, CounterState>> {
        let mut out = HashMap::with_capacity(keys.len());
        for key in keys {
            if let Some(state) = self.counter(*key)? {
                out.insert(*key, state);
            }
        }
        Ok(out)
    }

    fn save_counters(&self, entries: &[CounterEntry]) -> awg_shared::CoreResult<()> {
        for entry in entries {
            self.save_counter(entry.key, &entry.state)?;
        }
        Ok(())
    }

    fn add_buckets_batch(&self, deltas: &[BucketDelta]) -> awg_shared::CoreResult<()> {
        for delta in deltas {
            self.add_bucket(delta.scope, delta.hour, delta.rx, delta.tx)?;
        }
        Ok(())
    }

    fn commit_snapshot(
        &self,
        counters: &[CounterEntry],
        buckets: &[BucketDelta],
    ) -> awg_shared::CoreResult<()> {
        self.save_counters(counters)?;
        self.add_buckets_batch(buckets)
    }

    fn totals_many(
        &self,
        scopes: &[StatsScope],
        from_hour: i64,
        to_hour: i64,
    ) -> awg_shared::CoreResult<HashMap<StatsScope, (u64, u64)>> {
        let mut out = HashMap::with_capacity(scopes.len());
        for scope in scopes {
            let totals = self.series(*scope, from_hour, to_hour)?.into_iter().fold(
                (0u64, 0u64),
                |acc, bucket| {
                    (
                        acc.0.saturating_add(bucket.rx),
                        acc.1.saturating_add(bucket.tx),
                    )
                },
            );
            out.insert(*scope, totals);
        }
        Ok(out)
    }

    /// Totals for every device scope in a single backend pass.
    ///
    /// Backends that cannot scan all device buckets at once may fall back to
    /// returning an empty map, which callers treat as "no traffic yet".
    fn device_totals(
        &self,
        _from_hour: i64,
        _to_hour: i64,
    ) -> awg_shared::CoreResult<HashMap<Uuid, (u64, u64)>> {
        Ok(HashMap::new())
    }
}

pub trait StatsBroadcaster: Send + Sync {
    fn broadcast(&self, update: crate::application::StatsUpdate);
}

pub trait DeviceDirectory: Send + Sync {
    fn group_and_user(&self, device_id: Uuid) -> awg_shared::CoreResult<Option<(Uuid, Uuid)>>;

    /// Resolves many devices at once. Implementations backed by a key-value
    /// store should override this to avoid one lookup per device.
    fn group_and_user_many(
        &self,
        device_ids: &[Uuid],
    ) -> awg_shared::CoreResult<HashMap<Uuid, (Uuid, Uuid)>> {
        let mut out = HashMap::with_capacity(device_ids.len());
        for device_id in device_ids {
            if let Some(ids) = self.group_and_user(*device_id)? {
                out.insert(*device_id, ids);
            }
        }
        Ok(out)
    }
}
