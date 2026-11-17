use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use awg_tariffs::{QuotaPeriod, QuotaState};

#[derive(Debug, Serialize, Default)]
pub struct TrafficTotals {
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Serialize)]
pub struct StatsPoint {
    pub at: DateTime<Utc>,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Serialize)]
pub struct StatsSeriesPoint {
    pub at: DateTime<Utc>,
    pub rx: u64,
    pub tx: u64,
    pub rx_bps: f64,
    pub tx_bps: f64,
}

#[derive(Debug, Serialize)]
pub struct OverviewView {
    pub today: TrafficTotals,
    pub month: TrafficTotals,
    pub rx_bps: f64,
    pub tx_bps: f64,
    pub nodes_online: usize,
    pub nodes_total: usize,
    pub interfaces: usize,
    pub groups: usize,
    pub devices: usize,
    pub users: usize,
    pub top_devices: Vec<DeviceTrafficView>,
}

#[derive(Debug, Serialize)]
pub struct DeviceTrafficView {
    pub device_id: Uuid,
    pub name: String,
    pub user_id: Uuid,
    pub rx: u64,
    pub tx: u64,
    pub online: bool,
}

#[derive(Debug, Serialize)]
pub struct QuotaView {
    pub used_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub exceeded: bool,
    pub remaining_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub reset_at: DateTime<Utc>,
}

impl QuotaView {
    pub fn build(state: QuotaState, period: QuotaPeriod) -> Self {
        Self {
            used_bytes: state.used_bytes,
            quota_bytes: state.quota_bytes,
            exceeded: state.exceeded,
            remaining_bytes: state.remaining_bytes,
            percent: state.percent,
            period_start: period.start,
            period_end: period.end,
            reset_at: period.reset_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct QuotaUserView {
    pub user_id: Uuid,
    pub login: String,
    pub used_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub exceeded: bool,
    pub percent: Option<f64>,
}

impl QuotaUserView {
    pub fn build(user_id: Uuid, login: &str, state: QuotaState) -> Self {
        Self {
            user_id,
            login: login.to_string(),
            used_bytes: state.used_bytes,
            quota_bytes: state.quota_bytes,
            exceeded: state.exceeded,
            percent: state.percent,
        }
    }
}
