use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use uuid::Uuid;

use awg_statistics::StatsScope;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::views::{DeviceTrafficView, OverviewView, StatsPoint, TrafficTotals};

#[derive(Debug, Deserialize)]
pub struct SeriesQuery {
    pub scope: String,
    pub id: Option<Uuid>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

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

    let devices = if user.is_admin() {
        state.devices.list_all().map_err(ApiError::from)?
    } else {
        state
            .devices
            .list_for_user(user.id())
            .map_err(ApiError::from)?
    };
    let mut top = Vec::new();
    for device in devices.iter().filter(|d| !d.revoked) {
        let (rx, tx) = state
            .stats
            .today(StatsScope::Device(device.id))
            .map_err(ApiError::from)?;
        top.push(DeviceTrafficView {
            device_id: device.id,
            name: device.name.clone(),
            user_id: device.user_id,
            rx,
            tx,
            online: false,
        });
    }
    top.sort_by_key(|d| std::cmp::Reverse(d.rx + d.tx));
    top.truncate(8);

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
        devices: state.devices.list_all().map_err(ApiError::from)?.len(),
        users: if user.is_admin() {
            state.identity.list().map_err(ApiError::from)?.len()
        } else {
            1
        },
        top_devices: top,
    }))
}

pub async fn series(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<SeriesQuery>,
) -> ApiResult<Json<Vec<StatsPoint>>> {
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
    let buckets = state
        .stats
        .series(scope, from, to)
        .map_err(ApiError::from)?;
    Ok(Json(
        buckets
            .into_iter()
            .map(|bucket| StatsPoint {
                at: DateTime::from_timestamp(bucket.hour, 0).unwrap_or_else(Utc::now),
                rx: bucket.rx,
                tx: bucket.tx,
            })
            .collect(),
    ))
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
    Ok(Json(serde_json::json!({
        "device_id": id,
        "today": { "rx": today_rx, "tx": today_tx },
        "month": { "rx": month_rx, "tx": month_tx },
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

pub fn authorize_scope(
    state: &AppState,
    user: &AuthUser,
    scope: StatsScope,
) -> Result<(), ApiError> {
    if user.is_admin() {
        return Ok(());
    }
    match scope {
        StatsScope::User(id) if id == user.id() => Ok(()),
        StatsScope::Device(id) => {
            let device = state.devices.get(id).map_err(ApiError::from)?;
            if device.user_id == user.id() {
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
