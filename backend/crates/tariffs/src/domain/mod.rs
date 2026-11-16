use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tariff {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub max_devices: u32,
    pub device_down_kbps: u32,
    pub device_up_kbps: u32,
    pub group_down_kbps: u32,
    pub group_up_kbps: u32,
    pub traffic_quota_bytes: Option<u64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Tariff {
    pub fn validate(&self) -> CoreResult<()> {
        if self.name.trim().is_empty() {
            return Err(CoreError::Invalid("tariff name is required".into()));
        }
        if self.max_devices == 0 {
            return Err(CoreError::Invalid(
                "tariff must allow at least one device".into(),
            ));
        }
        if self.device_down_kbps > 0
            && self.group_down_kbps > 0
            && self.device_down_kbps > self.group_down_kbps
        {
            return Err(CoreError::Invalid(
                "device download limit cannot exceed the group limit".into(),
            ));
        }
        if self.device_up_kbps > 0
            && self.group_up_kbps > 0
            && self.device_up_kbps > self.group_up_kbps
        {
            return Err(CoreError::Invalid(
                "device upload limit cannot exceed the group limit".into(),
            ));
        }
        Ok(())
    }

    pub fn period_usage_exceeded(&self, used_bytes: u64) -> bool {
        matches!(self.traffic_quota_bytes, Some(quota) if quota > 0 && used_bytes >= quota)
    }

    pub fn quota_state(&self, used_bytes: u64) -> QuotaState {
        match self.traffic_quota_bytes {
            Some(quota) if quota > 0 => {
                let percent = (used_bytes as f64 / quota as f64 * 1000.0).round() / 10.0;
                QuotaState {
                    used_bytes,
                    quota_bytes: Some(quota),
                    exceeded: used_bytes >= quota,
                    remaining_bytes: Some(quota.saturating_sub(used_bytes)),
                    percent: Some(percent),
                }
            }
            _ => QuotaState::unlimited(used_bytes),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct QuotaState {
    pub used_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub exceeded: bool,
    pub remaining_bytes: Option<u64>,
    pub percent: Option<f64>,
}

impl QuotaState {
    pub fn unlimited(used_bytes: u64) -> Self {
        Self {
            used_bytes,
            quota_bytes: None,
            exceeded: false,
            remaining_bytes: None,
            percent: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuotaPeriod {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub reset_at: DateTime<Utc>,
}

impl QuotaPeriod {
    pub fn for_month(now: DateTime<Utc>) -> Self {
        let date = now.date_naive();
        let year = date.year();
        let month = date.month();
        let (next_year, next_month) = if month == 12 {
            (year + 1, 1)
        } else {
            (year, month + 1)
        };
        let start_date =
            NaiveDate::from_ymd_opt(year, month, 1).expect("valid current month boundary");
        let reset_at = NaiveDate::from_ymd_opt(next_year, next_month, 1)
            .expect("valid next month boundary")
            .and_hms_opt(0, 0, 0)
            .expect("valid midnight")
            .and_utc();
        Self {
            start: start_date
                .and_hms_opt(0, 0, 0)
                .expect("valid midnight")
                .and_utc(),
            end: reset_at - Duration::seconds(1),
            reset_at,
        }
    }
}

pub trait TariffRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Tariff>>;
    fn list(&self) -> CoreResult<Vec<Tariff>>;
    fn save(&self, tariff: &Tariff) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Timelike};

    use super::*;

    fn tariff(quota: Option<u64>) -> Tariff {
        Tariff {
            id: Uuid::new_v4(),
            name: "Test".into(),
            description: String::new(),
            max_devices: 5,
            device_down_kbps: 100_000,
            device_up_kbps: 50_000,
            group_down_kbps: 200_000,
            group_up_kbps: 100_000,
            traffic_quota_bytes: quota,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn quota_state_without_quota_is_unlimited() {
        for quota in [None, Some(0)] {
            let state = tariff(quota).quota_state(1234);
            assert_eq!(
                state,
                QuotaState {
                    used_bytes: 1234,
                    quota_bytes: None,
                    exceeded: false,
                    remaining_bytes: None,
                    percent: None,
                }
            );
            assert!(!tariff(quota).period_usage_exceeded(1_000_000));
        }
    }

    #[test]
    fn quota_state_reports_zero_usage() {
        let state = tariff(Some(1000)).quota_state(0);
        assert_eq!(state.percent, Some(0.0));
        assert_eq!(state.remaining_bytes, Some(1000));
        assert!(!state.exceeded);
    }

    #[test]
    fn quota_state_reports_half_usage() {
        let state = tariff(Some(1000)).quota_state(500);
        assert_eq!(state.percent, Some(50.0));
        assert_eq!(state.remaining_bytes, Some(500));
        assert!(!state.exceeded);
    }

    #[test]
    fn quota_state_reports_exact_usage_as_exceeded() {
        let state = tariff(Some(1000)).quota_state(1000);
        assert_eq!(state.percent, Some(100.0));
        assert_eq!(state.remaining_bytes, Some(0));
        assert!(state.exceeded);
        assert!(tariff(Some(1000)).period_usage_exceeded(1000));
    }

    #[test]
    fn quota_state_reports_over_usage_above_hundred_percent() {
        let state = tariff(Some(1000)).quota_state(1500);
        assert_eq!(state.percent, Some(150.0));
        assert_eq!(state.remaining_bytes, Some(0));
        assert!(state.exceeded);
    }

    #[test]
    fn quota_percent_rounds_to_one_decimal() {
        let state = tariff(Some(3000)).quota_state(1000);
        assert_eq!(state.percent, Some(33.3));
        let state = tariff(Some(3)).quota_state(2);
        assert_eq!(state.percent, Some(66.7));
    }

    #[test]
    fn quota_period_covers_calendar_month() {
        let now = Utc.with_ymd_and_hms(2026, 11, 16, 12, 34, 56).unwrap();
        let period = QuotaPeriod::for_month(now);
        assert_eq!(
            period.start,
            Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap()
        );
        assert_eq!(
            period.end,
            Utc.with_ymd_and_hms(2026, 11, 30, 23, 59, 59).unwrap()
        );
        assert_eq!(period.reset_at, period.end + Duration::seconds(1));
        assert_eq!(period.end.day(), 30);
        assert_eq!(period.end.hour(), 23);
    }

    #[test]
    fn quota_period_rolls_over_december() {
        let now = Utc.with_ymd_and_hms(2026, 12, 31, 23, 59, 59).unwrap();
        let period = QuotaPeriod::for_month(now);
        assert_eq!(
            period.start,
            Utc.with_ymd_and_hms(2026, 12, 1, 0, 0, 0).unwrap()
        );
        assert_eq!(
            period.end,
            Utc.with_ymd_and_hms(2026, 12, 31, 23, 59, 59).unwrap()
        );
        assert_eq!(
            period.reset_at,
            Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap()
        );
    }
}
