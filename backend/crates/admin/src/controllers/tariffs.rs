use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_tariffs::{NewTariff, TariffChanges};

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateTariffRequest, UpdateTariffRequest};
use crate::state::AppState;
use crate::views::TariffView;

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<TariffView>>> {
    user.require_admin()?;
    let items = state.tariffs.list().map_err(ApiError::from)?;
    Ok(Json(items.into_iter().map(TariffView::from).collect()))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateTariffRequest>,
) -> ApiResult<Json<TariffView>> {
    user.require_admin()?;
    let tariff = state
        .tariffs
        .create(NewTariff {
            name: request.name,
            description: request.description,
            max_devices: request.max_devices,
            device_down_kbps: request.device_down_kbps,
            device_up_kbps: request.device_up_kbps,
            group_down_kbps: request.group_down_kbps,
            group_up_kbps: request.group_up_kbps,
            traffic_quota_bytes: request.traffic_quota_bytes,
        })
        .map_err(ApiError::from)?;
    Ok(Json(TariffView::from(tariff)))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateTariffRequest>,
) -> ApiResult<Json<TariffView>> {
    user.require_admin()?;
    let tariff = state
        .tariffs
        .update(
            id,
            TariffChanges {
                name: request.name,
                description: request.description,
                max_devices: request.max_devices,
                device_down_kbps: request.device_down_kbps,
                device_up_kbps: request.device_up_kbps,
                group_down_kbps: request.group_down_kbps,
                group_up_kbps: request.group_up_kbps,
                traffic_quota_bytes: request.traffic_quota_bytes,
            },
        )
        .map_err(ApiError::from)?;
    Ok(Json(TariffView::from(tariff)))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    state.tariffs.delete(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
