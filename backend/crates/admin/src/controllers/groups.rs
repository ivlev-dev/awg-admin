use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_network::NewPool;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateGroupRequest, CreatePoolRequest, UpdateGroupRequest, UpdatePoolRequest};
use crate::state::AppState;
use crate::views::{GroupView, PoolView};

pub async fn list(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
) -> ApiResult<Json<Vec<GroupView>>> {
    let groups = state.network.list_groups().map_err(ApiError::from)?;
    let devices = state.devices.list_all().map_err(ApiError::from)?;
    let mut out = Vec::with_capacity(groups.len());
    for group in groups {
        let interfaces = state
            .network
            .interfaces_by_group(group.id)
            .map_err(ApiError::from)?
            .len();
        let device_count = devices.iter().filter(|d| d.group_id == group.id).count();
        out.push(GroupView {
            group,
            interfaces,
            devices: device_count,
        });
    }
    Ok(Json(out))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateGroupRequest>,
) -> ApiResult<Json<GroupView>> {
    user.require_admin()?;
    let group = state
        .network
        .create_group(
            &request.name,
            &request.description,
            &request.base_cidr,
            request.forwarding_default,
        )
        .map_err(ApiError::from)?;
    Ok(Json(GroupView {
        group,
        interfaces: 0,
        devices: 0,
    }))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateGroupRequest>,
) -> ApiResult<Json<GroupView>> {
    user.require_admin()?;
    let group = state
        .network
        .update_group(
            id,
            request.name,
            request.description,
            request.base_cidr,
            request.forwarding_default,
        )
        .map_err(ApiError::from)?;
    let interfaces = state
        .network
        .interfaces_by_group(id)
        .map_err(ApiError::from)?
        .len();
    let devices = state
        .devices
        .list_all()
        .map_err(ApiError::from)?
        .iter()
        .filter(|d| d.group_id == id)
        .count();
    Ok(Json(GroupView {
        group,
        interfaces,
        devices,
    }))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    state.network.delete_group(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_pools(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(group_id): Path<Uuid>,
) -> ApiResult<Json<Vec<PoolView>>> {
    let pools = state.network.list_pools(group_id).map_err(ApiError::from)?;
    Ok(Json(pools.iter().map(PoolView::from).collect()))
}

pub async fn create_pool(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(request): Json<CreatePoolRequest>,
) -> ApiResult<Json<PoolView>> {
    user.require_admin()?;
    let pool = state
        .network
        .add_pool(
            group_id,
            NewPool {
                name: request.name,
                cidr: request.cidr,
                mode: request.mode,
                gateway: request.gateway,
            },
        )
        .map_err(ApiError::from)?;
    Ok(Json(PoolView::from(&pool)))
}

pub async fn update_pool(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdatePoolRequest>,
) -> ApiResult<Json<PoolView>> {
    user.require_admin()?;
    let pool = state
        .network
        .update_pool(
            id,
            request.name,
            request.mode,
            request.gateway,
            request.enabled,
        )
        .map_err(ApiError::from)?;
    Ok(Json(PoolView::from(&pool)))
}

pub async fn delete_pool(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    state.network.delete_pool(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
