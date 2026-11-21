use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use uuid::Uuid;

use awg_statistics::{AggregateBucket, Rate, StatsScope};

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::views::{
    DeviceStatsView, DeviceTrafficView, OverviewView, StatsPoint, StatsSeriesPoint, TrafficTotals,
};

#[derive(Debug, Deserialize)]
pub struct SeriesQuery {
    pub scope: String,
    pub id: Option<Uuid>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AggregateQuery {
    pub scope: String,
    pub id: Option<Uuid>,
    pub bucket: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Debug, serde::Serialize)]
pub struct AggregateView {
    pub bucket: &'static str,
    pub points: Vec<StatsPoint>,
}

const TOP_DEVICES: usize = 8;
const MAX_SERIES_WINDOW_DAYS: i64 = 366;

struct OverviewData {
    devices: Vec<awg_clients::Device>,
    today: (u64, u64),
    month: (u64, u64),
    rate: Rate,
    today_by_device: HashMap<Uuid, (u64, u64)>,
    device_rates: HashMap<Uuid, Rate>,
    nodes_online: usize,
    nodes_total: usize,
    interfaces: usize,
    groups: usize,
    users: usize,
}

pub async fn overview(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<OverviewView>> {
    let admin = user.is_admin();
    let user_id = user.id();
    let stats = state.stats.clone();
    let devices_service = state.devices.clone();
    let network = state.network.clone();
    let identity = state.identity.clone();
    let registry = state.registry.clone();

    let data = blocking::run_api(move || {
        let devices = if admin {
            devices_service.list_all()?
        } else {
            devices_service.list_for_user(user_id)?
        };
        let scope = if admin {
            StatsScope::Global
        } else {
            StatsScope::User(user_id)
        };
        let today = stats.today(scope)?;
        let month = stats.month(scope)?;
        let rate = stats.current_rate(&scope).unwrap_or_default();

        let device_scopes: Vec<StatsScope> = devices
            .iter()
            .filter(|device| !device.revoked)
            .map(|device| StatsScope::Device(device.id))
            .collect();
        let today_by_device = if admin {
            stats.today_device_totals()?
        } else {
            stats
                .today_many(&device_scopes)?
                .into_iter()
                .filter_map(|(scope, totals)| match scope {
                    StatsScope::Device(id) => Some((id, totals)),
                    _ => None,
                })
                .collect()
        };
        let device_rates: HashMap<Uuid, Rate> = device_scopes
            .iter()
            .filter_map(|scope| match scope {
                StatsScope::Device(id) => stats.current_rate(scope).map(|rate| (*id, rate)),
                _ => None,
            })
            .collect();

        let nodes = if admin {
            network.list_nodes()?
        } else {
            Vec::new()
        };
        let nodes_online = nodes
            .iter()
            .filter(|node| registry.is_online(node.id))
            .count();
        let nodes_total = nodes.len();
        let interfaces = if admin {
            network.list_interfaces()?.len()
        } else {
            0
        };
        let groups = if admin {
            network.list_groups()?.len()
        } else {
            0
        };
        let users = if admin { identity.list()?.len() } else { 1 };

        Ok(OverviewData {
            devices,
            today,
            month,
            rate,
            today_by_device,
            device_rates,
            nodes_online,
            nodes_total,
            interfaces,
            groups,
            users,
        })
    })
    .await?;

    let OverviewData {
        devices,
        today,
        month,
        rate,
        today_by_device,
        device_rates,
        nodes_online,
        nodes_total,
        interfaces,
        groups,
        users,
    } = data;
    let devices_total = devices.len();
    let top = top_devices(&devices, &today_by_device, &device_rates, TOP_DEVICES);

    Ok(Json(OverviewView {
        today: TrafficTotals {
            rx: today.0,
            tx: today.1,
        },
        month: TrafficTotals {
            rx: month.0,
            tx: month.1,
        },
        rx_bps: rate.rx_bps,
        tx_bps: rate.tx_bps,
        nodes_online,
        nodes_total,
        interfaces,
        groups,
        devices: devices_total,
        users,
        top_devices: top,
    }))
}

async fn visible_devices(
    state: &Arc<AppState>,
    user: &AuthUser,
) -> ApiResult<Vec<awg_clients::Device>> {
    let devices = state.devices.clone();
    let admin = user.is_admin();
    let user_id = user.id();
    blocking::run_core(move || {
        if admin {
            devices.list_all()
        } else {
            devices.list_for_user(user_id)
        }
    })
    .await
    .map_err(ApiError::from)
}

fn top_devices(
    devices: &[awg_clients::Device],
    totals: &HashMap<Uuid, (u64, u64)>,
    rates: &HashMap<Uuid, Rate>,
    limit: usize,
) -> Vec<DeviceTrafficView> {
    let mut ranked: Vec<DeviceTrafficView> = devices
        .iter()
        .filter(|device| !device.revoked)
        .map(|device| {
            let (rx, tx) = totals.get(&device.id).copied().unwrap_or_default();
            let online = rates
                .get(&device.id)
                .is_some_and(|rate| rate.rx_bps > 0.0 || rate.tx_bps > 0.0);
            DeviceTrafficView {
                device_id: device.id,
                name: device.name.clone(),
                user_id: device.user_id,
                rx,
                tx,
                online,
            }
        })
        .collect();
    if ranked.len() > limit {
        ranked.select_nth_unstable_by(limit, |left, right| {
            (right.rx + right.tx).cmp(&(left.rx + left.tx))
        });
        ranked.truncate(limit);
    }
    ranked.sort_by_key(|device| std::cmp::Reverse(device.rx + device.tx));
    ranked
}

pub async fn devices(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<DeviceStatsView>>> {
    let devices = visible_devices(&state, &user).await?;
    let stats = state.stats.clone();
    let views = blocking::run_api(move || {
        let scopes: Vec<StatsScope> = devices
            .iter()
            .filter(|device| !device.revoked)
            .map(|device| StatsScope::Device(device.id))
            .collect();
        let today = stats.today_many(&scopes)?;
        let month = stats.month_many(&scopes)?;
        let mut views = Vec::with_capacity(scopes.len());
        for device in devices.iter().filter(|device| !device.revoked) {
            let scope = StatsScope::Device(device.id);
            let (today_rx, today_tx) = today.get(&scope).copied().unwrap_or_default();
            let (month_rx, month_tx) = month.get(&scope).copied().unwrap_or_default();
            let rate = stats.current_rate(&scope).unwrap_or_default();
            views.push(DeviceStatsView {
                device_id: device.id,
                today: TrafficTotals {
                    rx: today_rx,
                    tx: today_tx,
                },
                month: TrafficTotals {
                    rx: month_rx,
                    tx: month_tx,
                },
                rx_bps: rate.rx_bps,
                tx_bps: rate.tx_bps,
            });
        }
        Ok(views)
    })
    .await?;
    Ok(Json(views))
}

pub async fn series(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<SeriesQuery>,
) -> ApiResult<Json<Vec<StatsSeriesPoint>>> {
    let scope = parse_scope(&query.scope, query.id)?;
    authorize_scope(&state, &user, scope)?;
    let to = parse_optional_timestamp(query.to, "to")?.unwrap_or_else(Utc::now);
    let from =
        parse_optional_timestamp(query.from, "from")?.unwrap_or_else(|| to - Duration::days(1));
    validate_series_range(from, to)?;
    let stats = state.stats.clone();
    let points = blocking::run_core(move || stats.series_with_rates(scope, from, to))
        .await
        .map_err(ApiError::from)?;
    Ok(Json(
        points
            .into_iter()
            .map(|point| StatsSeriesPoint {
                at: DateTime::from_timestamp(point.bucket.hour, 0).unwrap_or_else(Utc::now),
                rx: point.bucket.rx,
                tx: point.bucket.tx,
                rx_bps: point.rate.rx_bps,
                tx_bps: point.rate.tx_bps,
            })
            .collect(),
    ))
}

pub async fn aggregate(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<AggregateQuery>,
) -> ApiResult<Json<AggregateView>> {
    let bucket = parse_bucket(query.bucket.as_deref().unwrap_or("day"))?;
    let scope = parse_scope(&query.scope, query.id)?;
    authorize_scope(&state, &user, scope)?;
    let to = match query.to {
        Some(ts) => DateTime::from_timestamp(ts, 0)
            .ok_or_else(|| ApiError::BadRequest("to is out of range".into()))?,
        None => Utc::now(),
    };
    let from = match query.from {
        Some(ts) => DateTime::from_timestamp(ts, 0)
            .ok_or_else(|| ApiError::BadRequest("from is out of range".into()))?,
        None => to - default_span(bucket),
    };
    let stats = state.stats.clone();
    let points = blocking::run_api(move || {
        let points = match bucket {
            AggregateBucket::Day => stats
                .daily(scope, from, to)
                .map_err(ApiError::from)?
                .into_iter()
                .filter_map(|bucket| {
                    DateTime::from_timestamp(bucket.day, 0).map(|at| StatsPoint {
                        at,
                        rx: bucket.rx,
                        tx: bucket.tx,
                    })
                })
                .collect(),
            AggregateBucket::Month => stats
                .monthly(scope, from, to)
                .map_err(ApiError::from)?
                .into_iter()
                .filter_map(|bucket| {
                    month_start(&bucket.month).map(|at| StatsPoint {
                        at,
                        rx: bucket.rx,
                        tx: bucket.tx,
                    })
                })
                .collect(),
        };
        Ok(points)
    })
    .await?;
    Ok(Json(AggregateView {
        bucket: bucket.as_str(),
        points,
    }))
}

pub async fn device_stats(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    let devices = state.devices.clone();
    let device = blocking::run_core(move || devices.get(id))
        .await
        .map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let stats = state.stats.clone();
    let view = blocking::run_api(move || {
        let scope = StatsScope::Device(id);
        let (today_rx, today_tx) = stats.today(scope)?;
        let (month_rx, month_tx) = stats.month(scope)?;
        let rate = stats.current_rate(&scope).unwrap_or_default();
        Ok(serde_json::json!({
            "device_id": id,
            "today": { "rx": today_rx, "tx": today_tx },
            "month": { "rx": month_rx, "tx": month_tx },
            "rx_bps": rate.rx_bps,
            "tx_bps": rate.tx_bps,
        }))
    })
    .await?;
    Ok(Json(view))
}

pub fn parse_scope(scope: &str, id: Option<Uuid>) -> Result<StatsScope, ApiError> {
    if scope == "global" {
        return Ok(StatsScope::Global);
    }
    let id = id.ok_or_else(|| ApiError::BadRequest("scope id is required".into()))?;
    match scope {
        "user" => Ok(StatsScope::User(id)),
        "group" => Ok(StatsScope::Group(id)),
        "interface" => Ok(StatsScope::Interface(id)),
        "device" => Ok(StatsScope::Device(id)),
        other => Err(ApiError::BadRequest(format!("unknown scope {other:?}"))),
    }
}

pub fn parse_bucket(value: &str) -> Result<AggregateBucket, ApiError> {
    AggregateBucket::parse(value)
        .ok_or_else(|| ApiError::BadRequest(format!("unknown bucket {value:?}")))
}

fn parse_optional_timestamp(
    value: Option<i64>,
    name: &str,
) -> Result<Option<DateTime<Utc>>, ApiError> {
    value
        .map(|ts| {
            DateTime::from_timestamp(ts, 0)
                .ok_or_else(|| ApiError::BadRequest(format!("{name} is out of range")))
        })
        .transpose()
}

fn validate_series_range(from: DateTime<Utc>, to: DateTime<Utc>) -> Result<(), ApiError> {
    if to < from {
        return Err(ApiError::BadRequest("to must not be before from".into()));
    }
    if to - from > Duration::days(MAX_SERIES_WINDOW_DAYS) {
        return Err(ApiError::BadRequest(format!(
            "range must not exceed {MAX_SERIES_WINDOW_DAYS} days"
        )));
    }
    Ok(())
}

fn default_span(bucket: AggregateBucket) -> Duration {
    match bucket {
        AggregateBucket::Day => Duration::days(30),
        AggregateBucket::Month => Duration::days(365),
    }
}

fn month_start(value: &str) -> Option<DateTime<Utc>> {
    let (year, month) = value.split_once('-')?;
    let year = year.parse::<i32>().ok()?;
    let month = month.parse::<u32>().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, month, 1)?
        .and_hms_opt(0, 0, 0)
        .map(|naive| naive.and_utc())
}

pub fn authorize_scope(
    state: &AppState,
    user: &AuthUser,
    scope: StatsScope,
) -> Result<(), ApiError> {
    authorize_scope_with(user.is_admin(), user.id(), scope, |id| {
        state
            .devices
            .get(id)
            .map(|device| device.user_id)
            .map_err(ApiError::from)
    })
}

pub fn authorize_scope_with<F>(
    is_admin: bool,
    user_id: Uuid,
    scope: StatsScope,
    device_owner: F,
) -> Result<(), ApiError>
where
    F: FnOnce(Uuid) -> Result<Uuid, ApiError>,
{
    if is_admin {
        return Ok(());
    }
    match scope {
        StatsScope::User(id) if id == user_id => Ok(()),
        StatsScope::Device(id) => {
            if device_owner(id)? == user_id {
                Ok(())
            } else {
                Err(ApiError::Forbidden(
                    "access to another user's device is denied".into(),
                ))
            }
        }
        _ => Err(ApiError::Forbidden("scope is not available".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> Uuid {
        Uuid::new_v4()
    }

    fn deny_device(_: Uuid) -> Result<Uuid, ApiError> {
        Err(ApiError::NotFound("device not found".into()))
    }

    fn utc(value: &str) -> DateTime<Utc> {
        value.parse().unwrap()
    }

    #[test]
    fn admin_accesses_any_scope() {
        let admin = user();
        assert!(authorize_scope_with(true, admin, StatsScope::Global, deny_device).is_ok());
        assert!(
            authorize_scope_with(true, admin, StatsScope::Group(Uuid::new_v4()), deny_device)
                .is_ok()
        );
    }

    #[test]
    fn user_cannot_access_global_or_other_scopes() {
        let id = user();
        assert!(matches!(
            authorize_scope_with(false, id, StatsScope::Global, deny_device),
            Err(ApiError::Forbidden(_))
        ));
        assert!(matches!(
            authorize_scope_with(false, id, StatsScope::Group(Uuid::new_v4()), deny_device),
            Err(ApiError::Forbidden(_))
        ));
        assert!(matches!(
            authorize_scope_with(
                false,
                id,
                StatsScope::Interface(Uuid::new_v4()),
                deny_device
            ),
            Err(ApiError::Forbidden(_))
        ));
        assert!(matches!(
            authorize_scope_with(false, id, StatsScope::User(Uuid::new_v4()), deny_device),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn user_accesses_own_user_and_device_scopes() {
        let id = user();
        assert!(authorize_scope_with(false, id, StatsScope::User(id), deny_device).is_ok());
        let device = Uuid::new_v4();
        assert!(authorize_scope_with(false, id, StatsScope::Device(device), |_| Ok(id)).is_ok());
        assert!(matches!(
            authorize_scope_with(
                false,
                id,
                StatsScope::Device(device),
                |_| Ok(Uuid::new_v4())
            ),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn rejects_unknown_bucket() {
        assert!(matches!(parse_bucket("week"), Err(ApiError::BadRequest(_))));
        assert_eq!(parse_bucket("day").ok(), Some(AggregateBucket::Day));
        assert_eq!(parse_bucket("month").ok(), Some(AggregateBucket::Month));
    }

    #[test]
    fn parses_month_start_in_utc() {
        let at = month_start("2026-02").unwrap();
        assert_eq!(at, utc("2026-02-01T00:00:00Z"));
        assert!(month_start("2026-13").is_none());
    }

    #[test]
    fn series_range_accepts_a_bounded_window() {
        let from = utc("2026-01-01T00:00:00Z");
        let to = from + Duration::days(MAX_SERIES_WINDOW_DAYS);
        assert!(validate_series_range(from, to).is_ok());
        assert!(validate_series_range(from, from).is_ok());
    }

    #[test]
    fn series_range_rejects_an_inverted_window() {
        let from = utc("2026-01-02T00:00:00Z");
        let to = utc("2026-01-01T00:00:00Z");
        assert!(matches!(
            validate_series_range(from, to),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn series_range_rejects_an_oversized_window() {
        let from = utc("2025-01-01T00:00:00Z");
        let to = from + Duration::days(MAX_SERIES_WINDOW_DAYS + 1);
        assert!(matches!(
            validate_series_range(from, to),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn out_of_range_series_timestamps_are_rejected() {
        assert!(matches!(
            parse_optional_timestamp(Some(i64::MAX), "to"),
            Err(ApiError::BadRequest(_))
        ));
        assert_eq!(
            parse_optional_timestamp(Some(0), "from").unwrap(),
            Some(utc("1970-01-01T00:00:00Z"))
        );
    }
}
