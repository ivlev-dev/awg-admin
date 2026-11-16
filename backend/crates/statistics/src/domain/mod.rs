use chrono::{DateTime, Utc};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CounterSample {
    pub rx_total: u64,
    pub tx_total: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bucket {
    pub scope: StatsScope,
    pub hour: i64,
    pub rx: u64,
    pub tx: u64,
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
}

pub trait StatsRepository: Send + Sync {
    fn counter(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        device_id: Uuid,
    ) -> awg_shared::CoreResult<Option<CounterState>>;
    fn save_counter(
        &self,
        node_id: Uuid,
        interface_id: Uuid,
        device_id: Uuid,
        state: &CounterState,
    ) -> awg_shared::CoreResult<()>;
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
}

pub trait StatsBroadcaster: Send + Sync {
    fn broadcast(&self, update: crate::application::StatsUpdate);
}

pub trait DeviceDirectory: Send + Sync {
    fn group_and_user(&self, device_id: Uuid) -> awg_shared::CoreResult<Option<(Uuid, Uuid)>>;
}
