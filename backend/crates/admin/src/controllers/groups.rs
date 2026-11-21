use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_clients::{Device, DeviceService};
use awg_network::{Interface, NetworkService, NewPool};

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateGroupRequest, CreatePoolRequest, UpdateGroupRequest, UpdatePoolRequest};
use crate::publish::{node_ids_for_group, publish_group, publish_nodes};
use crate::state::AppState;
use crate::views::{GroupView, PoolView};

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<GroupView>>> {
    let admin = user.is_admin();
    let user_id = user.id();
    let state = state.clone();
    let views = blocking::run_api(move || {
        let group_filter = if admin {
            None
        } else {
            let current = state.identity.find(user_id).map_err(ApiError::from)?;
            Some(current.group_id)
        };
        load_views(&state.network, &state.devices, group_filter)
    })
    .await?;
    Ok(Json(views))
}

fn load_views(
    network: &NetworkService,
    devices: &DeviceService,
    group_filter: Option<Option<Uuid>>,
) -> ApiResult<Vec<GroupView>> {
    let groups = network.list_groups().map_err(ApiError::from)?;
    let interfaces = network.list_interfaces().map_err(ApiError::from)?;
    let devices = devices.list_all().map_err(ApiError::from)?;
    Ok(assemble_views(&groups, &interfaces, &devices, group_filter))
}

fn assemble_views(
    groups: &[awg_network::Group],
    interfaces: &[Interface],
    devices: &[Device],
    group_filter: Option<Option<Uuid>>,
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
        .filter(|group| match group_filter {
            None => true,
            Some(visible) => visible == Some(group.id),
        })
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
    let group = {
        let network = state.network.clone();
        blocking::run_core(move || {
            network.create_group(
                &request.name,
                &request.description,
                &request.base_cidr,
                request.forwarding_default,
            )
        })
        .await
        .map_err(ApiError::from)?
    };
    publish_group(&state, group.id).await;
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
    let view = {
        let state = state.clone();
        blocking::run_api(move || {
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
                .filter(|device| device.group_id == id)
                .count();
            Ok(GroupView {
                group,
                interfaces,
                devices,
            })
        })
        .await?
    };
    publish_group(&state, id).await;
    Ok(Json(view))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let nodes = {
        let state = state.clone();
        blocking::run_api(move || {
            let nodes = node_ids_for_group(&state, id);
            state.network.delete_group(id).map_err(ApiError::from)?;
            Ok(nodes)
        })
        .await?
    };
    publish_nodes(&state, nodes).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_pools(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(group_id): Path<Uuid>,
) -> ApiResult<Json<Vec<PoolView>>> {
    let admin = user.is_admin();
    let user_id = user.id();
    let state = state.clone();
    let views = blocking::run_api(move || {
        if !admin {
            let current = state.identity.find(user_id).map_err(ApiError::from)?;
            if current.group_id != Some(group_id) {
                return Err(ApiError::Forbidden(
                    "access to another group is denied".into(),
                ));
            }
        }
        let pools = state.network.list_pools(group_id).map_err(ApiError::from)?;
        Ok(pools.iter().map(PoolView::from).collect())
    })
    .await?;
    Ok(Json(views))
}

pub async fn create_pool(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(request): Json<CreatePoolRequest>,
) -> ApiResult<Json<PoolView>> {
    user.require_admin()?;
    let pool = {
        let network = state.network.clone();
        blocking::run_core(move || {
            network.add_pool(
                group_id,
                NewPool {
                    name: request.name,
                    cidr: request.cidr,
                    mode: request.mode,
                    gateway: request.gateway,
                },
            )
        })
        .await
        .map_err(ApiError::from)?
    };
    publish_group(&state, group_id).await;
    Ok(Json(PoolView::from(&pool)))
}

pub async fn update_pool(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdatePoolRequest>,
) -> ApiResult<Json<PoolView>> {
    user.require_admin()?;
    let pool = {
        let network = state.network.clone();
        blocking::run_core(move || {
            network.update_pool(
                id,
                request.name,
                request.mode,
                request.gateway,
                request.enabled,
            )
        })
        .await
        .map_err(ApiError::from)?
    };
    publish_group(&state, pool.group_id).await;
    Ok(Json(PoolView::from(&pool)))
}

pub async fn delete_pool(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let pool = {
        let network = state.network.clone();
        blocking::run_core(move || {
            let pool = network.get_pool(id)?;
            network.delete_pool(id)?;
            Ok(pool)
        })
        .await
        .map_err(ApiError::from)?
    };
    publish_group(&state, pool.group_id).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded;

    #[test]
    fn group_list_counts_in_bulk() {
        let (env, sample) = seeded();
        let views = load_views(&env.network, &env.devices, None).unwrap();
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
        let views = load_views(&env.network, &env.devices, None).unwrap();
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

    #[test]
    fn group_list_honours_the_visible_group_filter() {
        let (env, sample) = seeded();
        let only_beta = load_views(&env.network, &env.devices, Some(Some(sample.group_b))).unwrap();
        assert_eq!(only_beta.len(), 1);
        assert_eq!(only_beta[0].group.id, sample.group_b);
        assert_eq!(only_beta[0].interfaces, 1);
        assert_eq!(only_beta[0].devices, 1);

        let unassigned = load_views(&env.network, &env.devices, Some(None)).unwrap();
        assert!(unassigned.is_empty());

        let unknown = load_views(&env.network, &env.devices, Some(Some(Uuid::new_v4()))).unwrap();
        assert!(unknown.is_empty());
    }
}
