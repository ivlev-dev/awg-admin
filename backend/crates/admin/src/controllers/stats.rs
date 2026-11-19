use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use uuid::Uuid;

use awg_statistics::{AggregateBucket, StatsScope};

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

pub async fn overview(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<OverviewView>> {
    let scope = if user.is_admin() {
        StatsScope::Global
    } else {
        StatsScope::User(user.id())
    };
    let (today_rx, today_tx) = state.stats.today(scope).map_err(ApiError::from)?;
    let (month_rx, month_tx) = state.stats.month(scope).map_err(ApiError::from)?;
    let rate = state.stats.current_rate(&scope).unwrap_or_default();

    let devices = visible_devices(&state, &user).await?;
    let devices_total = devices.len();
    let today_by_device = state.stats.today_device_totals().map_err(ApiError::from)?;
    let top = top_devices(&devices, &today_by_device, TOP_DEVICES);

    let nodes = if user.is_admin() {
        state.network.list_nodes().map_err(ApiError::from)?
    } else {
        Vec::new()
    };
    let nodes_online = nodes
        .iter()
        .filter(|n| state.registry.is_online(n.id))
        .count();

    Ok(Json(OverviewView {
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
        nodes_online,
        nodes_total: nodes.len(),
        interfaces: if user.is_admin() {
            state
                .network
                .list_interfaces()
                .map_err(ApiError::from)?
                .len()
        } else {
            0
        },
        groups: if user.is_admin() {
            state.network.list_groups().map_err(ApiError::from)?.len()
        } else {
            0
        },
        devices: devices_total,
        users: if user.is_admin() {
            state.identity.list().map_err(ApiError::from)?.len()
        } else {
            1
        },
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
    totals: &std::collections::HashMap<Uuid, (u64, u64)>,
    limit: usize,
) -> Vec<DeviceTrafficView> {
    let mut ranked: Vec<DeviceTrafficView> = devices
        .iter()
        .filter(|device| !device.revoked)
        .map(|device| {
            let (rx, tx) = totals.get(&device.id).copied().unwrap_or_default();
            DeviceTrafficView {
                device_id: device.id,
                name: device.name.clone(),
                user_id: device.user_id,
                rx,
                tx,
                online: false,
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
    let scopes: Vec<StatsScope> = devices
        .iter()
        .filter(|device| !device.revoked)
        .map(|device| StatsScope::Device(device.id))
        .collect();
    let today = state.stats.today_many(&scopes).map_err(ApiError::from)?;
    let month = state.stats.month_many(&scopes).map_err(ApiError::from)?;
    let mut views = Vec::with_capacity(scopes.len());
    for device in devices.iter().filter(|device| !device.revoked) {
        let scope = StatsScope::Device(device.id);
        let (today_rx, today_tx) = today.get(&scope).copied().unwrap_or_default();
        let (month_rx, month_tx) = month.get(&scope).copied().unwrap_or_default();
        let rate = state.stats.current_rate(&scope).unwrap_or_default();
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
    Ok(Json(views))
}

pub async fn series(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<SeriesQuery>,
) -> ApiResult<Json<Vec<StatsSeriesPoint>>> {
    let scope = parse_scope(&query.scope, query.id)?;
    authorize_scope(&state, &user, scope)?;
    let to = query
        .to
        .and_then(|ts| DateTime::from_timestamp(ts, 0))
        .unwrap_or_else(Utc::now);
    let from = query
        .from
        .and_then(|ts| DateTime::from_timestamp(ts, 0))
        .unwrap_or_else(|| to - Duration::days(1));
    let points = state
        .stats
        .series_with_rates(scope, from, to)
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
    let points = match bucket {
        AggregateBucket::Day => state
            .stats
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
        AggregateBucket::Month => state
            .stats
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
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let scope = StatsScope::Device(id);
    let (today_rx, today_tx) = state.stats.today(scope).map_err(ApiError::from)?;
    let (month_rx, month_tx) = state.stats.month(scope).map_err(ApiError::from)?;
    let rate = state.stats.current_rate(&scope).unwrap_or_default();
    Ok(Json(serde_json::json!({
        "device_id": id,
        "today": { "rx": today_rx, "tx": today_tx },
        "month": { "rx": month_rx, "tx": month_tx },
        "rx_bps": rate.rx_bps,
        "tx_bps": rate.tx_bps,
    })))
}

pub fn parse_scope(scope: &str, id: Option<Uuid>) -> Result<StatsScope, ApiError> {
    if scope == "global" {
        return Ok(StatsScope::Global);
    }
    let id = id.ok_or_else(|| ApiError::BadRequest("scope id is required".into()))?;
    match scope {
        "global" => Ok(StatsScope::Global),
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
}
