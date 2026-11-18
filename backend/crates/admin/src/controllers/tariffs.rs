use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_tariffs::{NewTariff, TariffChanges};

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateTariffRequest, UpdateTariffRequest};
use crate::publish::publish_user_groups;
use crate::state::AppState;
use crate::views::TariffView;

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<TariffView>>> {
    user.require_admin()?;
    let items = state.tariffs.list().map_err(ApiError::from)?;
    let interface_names: std::collections::HashMap<Uuid, String> = state
        .network
        .list_interfaces()
        .map_err(ApiError::from)?
        .into_iter()
        .map(|interface| (interface.id, interface.name))
        .collect();
    let views = items
        .into_iter()
        .map(|tariff| {
            let name = tariff
                .interface_id
                .and_then(|id| interface_names.get(&id).cloned());
            TariffView::build(tariff, name)
        })
        .collect();
    Ok(Json(views))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateTariffRequest>,
) -> ApiResult<Json<TariffView>> {
    user.require_admin()?;
    ensure_interface(&state, request.interface_id)?;
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
            interface_id: request.interface_id,
        })
        .map_err(ApiError::from)?;
    Ok(Json(TariffView::build(
        tariff.clone(),
        interface_name(&state, tariff.interface_id)?,
    )))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateTariffRequest>,
) -> ApiResult<Json<TariffView>> {
    user.require_admin()?;
    if let Some(Some(interface_id)) = request.interface_id {
        ensure_interface(&state, Some(interface_id))?;
    }
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
                interface_id: request.interface_id,
            },
        )
        .map_err(ApiError::from)?;
    if let Ok(users) = state.identity.list() {
        for user in users
            .into_iter()
            .filter(|user| user.tariff_id == Some(tariff.id))
        {
            publish_user_groups(&state, user.id);
        }
    }
    Ok(Json(TariffView::build(
        tariff.clone(),
        interface_name(&state, tariff.interface_id)?,
    )))
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

fn ensure_interface(state: &AppState, interface_id: Option<Uuid>) -> ApiResult<()> {
    if let Some(interface_id) = interface_id {
        state
            .network
            .get_interface(interface_id)
            .map_err(ApiError::from)?;
    }
    Ok(())
}

fn interface_name(state: &AppState, interface_id: Option<Uuid>) -> ApiResult<Option<String>> {
    match interface_id {
        Some(interface_id) => Ok(Some(
            state
                .network
                .get_interface(interface_id)
                .map_err(ApiError::from)?
                .name,
        )),
        None => Ok(None),
    }
}
