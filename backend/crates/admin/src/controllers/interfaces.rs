use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_clients::{DevicePeer, DeviceService};
use awg_network::{Group, Interface, NetworkService, NewInterface, Node};

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
    Ok(Json(load_views(
        &state.network,
        &state.devices,
        group_filter,
    )?))
}

fn load_views(
    network: &NetworkService,
    devices: &DeviceService,
    group_filter: Option<Option<Uuid>>,
) -> ApiResult<Vec<InterfaceView>> {
    let interfaces = network.list_interfaces().map_err(ApiError::from)?;
    let groups = network.list_groups().map_err(ApiError::from)?;
    let nodes = network.list_nodes().map_err(ApiError::from)?;
    let peers = devices.all_peers().map_err(ApiError::from)?;
    Ok(assemble_views(
        &interfaces,
        &groups,
        &nodes,
        group_filter,
        &peers,
    ))
}

fn assemble_views(
    interfaces: &[Interface],
    groups: &[Group],
    nodes: &[Node],
    group_filter: Option<Option<Uuid>>,
    peers: &[DevicePeer],
) -> Vec<InterfaceView> {
    let group_names: HashMap<Uuid, &str> = groups
        .iter()
        .map(|group| (group.id, group.name.as_str()))
        .collect();
    let node_names: HashMap<Uuid, &str> = nodes
        .iter()
        .map(|node| (node.id, node.name.as_str()))
        .collect();
    let mut peer_counts: HashMap<Uuid, usize> = HashMap::new();
    for peer in peers {
        *peer_counts.entry(peer.interface_id).or_default() += 1;
    }
    let mut out = Vec::with_capacity(interfaces.len());
    for interface in interfaces {
        if let Some(filter) = group_filter
            && filter != Some(interface.group_id)
        {
            continue;
        }
        let group_name = group_names
            .get(&interface.group_id)
            .copied()
            .unwrap_or_default();
        let node_name = node_names
            .get(&interface.node_id)
            .copied()
            .unwrap_or_default();
        let count = peer_counts.get(&interface.id).copied().unwrap_or_default();
        out.push(InterfaceView::build(
            interface, group_name, node_name, count,
        ));
    }
    out
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded;

    #[test]
    fn interface_list_counts_peers_in_bulk() {
        let (env, sample) = seeded();
        let views = load_views(&env.network, &env.devices, None).unwrap();
        assert_eq!(env.peers.list_calls(), 1);
        assert_eq!(env.peers.by_device_calls(), 0);
        assert_eq!(env.interfaces.list_calls(), 1);
        assert_eq!(env.interfaces.by_group_calls(), 0);

        let by_id: HashMap<Uuid, &InterfaceView> =
            views.iter().map(|view| (view.id, view)).collect();
        assert_eq!(by_id[&sample.iface_a0].peers, 2);
        assert_eq!(by_id[&sample.iface_a1].peers, 0);
        assert_eq!(by_id[&sample.iface_b0].peers, 1);
        assert_eq!(by_id[&sample.iface_a0].group_name, "alpha");
        assert_eq!(by_id[&sample.iface_b0].group_name, "beta");
        assert_eq!(by_id[&sample.iface_a0].node_name, "node-a");

        let names: Vec<Uuid> = views.iter().map(|view| view.id).collect();
        let expected: Vec<Uuid> = env
            .network
            .list_interfaces()
            .unwrap()
            .iter()
            .map(|interface| interface.id)
            .collect();
        assert_eq!(names, expected);
    }

    #[test]
    fn interface_list_honours_group_filter() {
        let (env, sample) = seeded();
        let views = load_views(&env.network, &env.devices, Some(Some(sample.group_b))).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, sample.iface_b0);

        let unknown = load_views(&env.network, &env.devices, Some(Some(Uuid::new_v4()))).unwrap();
        assert!(unknown.is_empty());

        let unassigned = load_views(&env.network, &env.devices, Some(None)).unwrap();
        assert!(unassigned.is_empty());
    }
}
