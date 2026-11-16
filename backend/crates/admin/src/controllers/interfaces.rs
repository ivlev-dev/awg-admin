use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_network::NewInterface;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateInterfaceRequest, UpdateInterfaceRequest};
use crate::state::AppState;
use crate::views::InterfaceView;

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<InterfaceView>>> {
    let group_filter = if user.is_admin() {
        None
    } else {
        let current = state.identity.find(user.id()).map_err(ApiError::from)?;
        Some(current.group_id)
    };
    let interfaces = state.network.list_interfaces().map_err(ApiError::from)?;
    let groups = state.network.list_groups().map_err(ApiError::from)?;
    let nodes = state.network.list_nodes().map_err(ApiError::from)?;
    let mut out = Vec::new();
    for interface in interfaces {
        if let Some(filter) = group_filter
            && filter != Some(interface.group_id)
        {
            continue;
        }
        let group_name = groups
            .iter()
            .find(|g| g.id == interface.group_id)
            .map(|g| g.name.clone())
            .unwrap_or_default();
        let node_name = nodes
            .iter()
            .find(|n| n.id == interface.node_id)
            .map(|n| n.name.clone())
            .unwrap_or_default();
        let peers = state
            .devices
            .peers_for_interface(interface.id)
            .map_err(ApiError::from)?
            .len();
        out.push(InterfaceView::build(
            &interface,
            &group_name,
            &node_name,
            peers,
        ));
    }
    Ok(Json(out))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateInterfaceRequest>,
) -> ApiResult<Json<InterfaceView>> {
    user.require_admin()?;
    let settings = state.settings.get().map_err(ApiError::from)?;
    let interface = state
        .network
        .add_interface(
            request.group_id,
            request.node_id,
            NewInterface {
                name: request.name,
                label: request.label,
                endpoint_host: request.endpoint_host,
                endpoint_port: request.endpoint_port,
                listen_port: request.listen_port,
                mtu: request.mtu,
            },
            &settings.obfuscation,
        )
        .map_err(ApiError::from)?;
    let _ = state.orchestration.publish(interface.node_id);
    let group_name = state
        .network
        .get_group(interface.group_id)
        .map(|g| g.name)
        .unwrap_or_default();
    let node_name = state
        .network
        .get_node(interface.node_id)
        .map(|n| n.name)
        .unwrap_or_default();
    Ok(Json(InterfaceView::build(
        &interface,
        &group_name,
        &node_name,
        0,
    )))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateInterfaceRequest>,
) -> ApiResult<Json<InterfaceView>> {
    user.require_admin()?;
    let interface = state
        .network
        .update_interface(
            id,
            awg_network::application::InterfaceChanges {
                label: request.label,
                endpoint_host: request.endpoint_host,
                endpoint_port: request.endpoint_port,
                listen_port: request.listen_port,
                mtu: request.mtu,
                enabled: request.enabled,
            },
        )
        .map_err(ApiError::from)?;
    let _ = state.orchestration.publish(interface.node_id);
    let group_name = state
        .network
        .get_group(interface.group_id)
        .map(|g| g.name)
        .unwrap_or_default();
    let node_name = state
        .network
        .get_node(interface.node_id)
        .map(|n| n.name)
        .unwrap_or_default();
    let peers = state
        .devices
        .peers_for_interface(id)
        .map_err(ApiError::from)?
        .len();
    Ok(Json(InterfaceView::build(
        &interface,
        &group_name,
        &node_name,
        peers,
    )))
}

pub async fn rotate(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<InterfaceView>> {
    user.require_admin()?;
    let settings = state.settings.get().map_err(ApiError::from)?;
    let interface = state
        .network
        .rotate_interface(id, &settings.obfuscation)
        .map_err(ApiError::from)?;
    let _ = state.orchestration.publish(interface.node_id);
    let group_name = state
        .network
        .get_group(interface.group_id)
        .map(|g| g.name)
        .unwrap_or_default();
    let node_name = state
        .network
        .get_node(interface.node_id)
        .map(|n| n.name)
        .unwrap_or_default();
    let peers = state
        .devices
        .peers_for_interface(id)
        .map_err(ApiError::from)?
        .len();
    Ok(Json(InterfaceView::build(
        &interface,
        &group_name,
        &node_name,
        peers,
    )))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let interface = state.network.get_interface(id).map_err(ApiError::from)?;
    state.network.delete_interface(id).map_err(ApiError::from)?;
    let _ = state.orchestration.publish(interface.node_id);
    Ok(Json(serde_json::json!({ "ok": true })))
}
