use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_clients::{Device, DeviceService};
use awg_network::{Interface, NetworkService, NewPool};

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateGroupRequest, CreatePoolRequest, UpdateGroupRequest, UpdatePoolRequest};
use crate::state::AppState;
use crate::views::{GroupView, PoolView};

pub async fn list(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
) -> ApiResult<Json<Vec<GroupView>>> {
    Ok(Json(load_views(&state.network, &state.devices)?))
}

fn load_views(network: &NetworkService, devices: &DeviceService) -> ApiResult<Vec<GroupView>> {
    let groups = network.list_groups().map_err(ApiError::from)?;
    let interfaces = network.list_interfaces().map_err(ApiError::from)?;
    let devices = devices.list_all().map_err(ApiError::from)?;
    Ok(assemble_views(&groups, &interfaces, &devices))
}

fn assemble_views(
    groups: &[awg_network::Group],
    interfaces: &[Interface],
    devices: &[Device],
) -> Vec<GroupView> {
    let mut interface_counts: HashMap<Uuid, usize> = HashMap::new();
    for interface in interfaces {
        *interface_counts.entry(interface.group_id).or_default() += 1;
    }
    let mut device_counts: HashMap<Uuid, usize> = HashMap::new();
    for device in devices {
        *device_counts.entry(device.group_id).or_default() += 1;
    }
    groups
        .iter()
        .map(|group| GroupView {
            group: group.clone(),
            interfaces: interface_counts.get(&group.id).copied().unwrap_or_default(),
            devices: device_counts.get(&group.id).copied().unwrap_or_default(),
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded;

    #[test]
    fn group_list_counts_in_bulk() {
        let (env, sample) = seeded();
        let views = load_views(&env.network, &env.devices).unwrap();
        assert_eq!(env.interfaces.list_calls(), 1);
        assert_eq!(env.interfaces.by_group_calls(), 0);

        let alpha = views
            .iter()
            .find(|view| view.group.id == sample.group_a)
            .unwrap();
        assert_eq!(alpha.group.name, "alpha");
        assert_eq!(alpha.interfaces, 2);
        assert_eq!(alpha.devices, 3);

        let beta = views
            .iter()
            .find(|view| view.group.id == sample.group_b)
            .unwrap();
        assert_eq!(beta.interfaces, 1);
        assert_eq!(beta.devices, 1);
    }

    #[test]
    fn group_list_preserves_order_and_zero_counts() {
        let (env, _sample) = seeded();
        let empty = env
            .network
            .create_group("gamma", "", "10.20.0.0/24", false)
            .unwrap();
        let views = load_views(&env.network, &env.devices).unwrap();
        let names: Vec<&str> = views.iter().map(|view| view.group.name.as_str()).collect();
        let expected: Vec<String> = env
            .network
            .list_groups()
            .unwrap()
            .into_iter()
            .map(|group| group.name)
            .collect();
        assert_eq!(
            names,
            expected.iter().map(String::as_str).collect::<Vec<_>>()
        );

        let gamma = views.iter().find(|view| view.group.id == empty.id).unwrap();
        assert_eq!(gamma.interfaces, 0);
        assert_eq!(gamma.devices, 0);
    }
}
