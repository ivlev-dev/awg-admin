use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use awg_clients::{DevicePeer, DeviceService};
use awg_network::{Group, Interface, NetworkService, NewInterface, Node};

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateInterfaceRequest, UpdateInterfaceRequest};
use crate::publish::publish_node;
use crate::state::AppState;
use crate::views::InterfaceView;

/// Which interfaces a caller is allowed to see.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InterfaceScope {
    /// Administrators see every interface.
    All,
    /// Users bound to a node see the interfaces served by that node.
    Node(Uuid),
    /// Users bound only to a group see the interfaces of that group.
    Group(Uuid),
    /// Users without any placement binding see nothing.
    Empty,
}

impl InterfaceScope {
    fn contains(self, interface: &Interface) -> bool {
        match self {
            Self::All => true,
            Self::Node(node_id) => interface.node_id == node_id,
            Self::Group(group_id) => interface.group_id == group_id,
            Self::Empty => false,
        }
    }
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<InterfaceView>>> {
    let admin = user.is_admin();
    let user_id = user.id();
    let state = state.clone();
    let views = blocking::run_api(move || {
        let scope = if admin {
            InterfaceScope::All
        } else {
            let current = state.identity.find(user_id).map_err(ApiError::from)?;
            match (current.node_id, current.group_id) {
                (Some(node_id), _) => InterfaceScope::Node(node_id),
                (None, Some(group_id)) => InterfaceScope::Group(group_id),
                (None, None) => InterfaceScope::Empty,
            }
        };
        load_views(&state.network, &state.devices, scope)
    })
    .await?;
    Ok(Json(views))
}

fn load_views(
    network: &NetworkService,
    devices: &DeviceService,
    scope: InterfaceScope,
) -> ApiResult<Vec<InterfaceView>> {
    let interfaces: Vec<Interface> = network
        .list_interfaces()
        .map_err(ApiError::from)?
        .into_iter()
        .filter(|interface| scope.contains(interface))
        .collect();
    let groups = network.list_groups().map_err(ApiError::from)?;
    let nodes = network.list_nodes().map_err(ApiError::from)?;
    let counts = peer_counts(devices, scope, &interfaces)?;
    Ok(assemble_views(&interfaces, &groups, &nodes, &counts))
}

/// Admins get one bulk peer read; scoped callers only read peers of the
/// interfaces they are allowed to see, so foreign peers are never loaded.
fn peer_counts(
    devices: &DeviceService,
    scope: InterfaceScope,
    interfaces: &[Interface],
) -> ApiResult<HashMap<Uuid, usize>> {
    if scope == InterfaceScope::All {
        let peers = devices.all_peers().map_err(ApiError::from)?;
        return Ok(count_by_interface(&peers));
    }
    let mut counts = HashMap::with_capacity(interfaces.len());
    for interface in interfaces {
        let peers = devices
            .peers_for_interface(interface.id)
            .map_err(ApiError::from)?;
        counts.insert(interface.id, peers.len());
    }
    Ok(counts)
}

fn count_by_interface(peers: &[DevicePeer]) -> HashMap<Uuid, usize> {
    let mut counts: HashMap<Uuid, usize> = HashMap::new();
    for peer in peers {
        *counts.entry(peer.interface_id).or_default() += 1;
    }
    counts
}

fn assemble_views(
    interfaces: &[Interface],
    groups: &[Group],
    nodes: &[Node],
    counts: &HashMap<Uuid, usize>,
) -> Vec<InterfaceView> {
    let group_names: HashMap<Uuid, &str> = groups
        .iter()
        .map(|group| (group.id, group.name.as_str()))
        .collect();
    let node_names: HashMap<Uuid, &str> = nodes
        .iter()
        .map(|node| (node.id, node.name.as_str()))
        .collect();
    interfaces
        .iter()
        .map(|interface| {
            let group_name = group_names
                .get(&interface.group_id)
                .copied()
                .unwrap_or_default();
            let node_name = node_names
                .get(&interface.node_id)
                .copied()
                .unwrap_or_default();
            let count = counts.get(&interface.id).copied().unwrap_or_default();
            InterfaceView::build(interface, group_name, node_name, count)
        })
        .collect()
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateInterfaceRequest>,
) -> ApiResult<Json<InterfaceView>> {
    user.require_admin()?;
    let (node_id, view) = {
        let state = state.clone();
        blocking::run_api(move || {
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
            let group_name = state
                .network
                .get_group(interface.group_id)
                .map(|group| group.name)
                .unwrap_or_default();
            let node_name = state
                .network
                .get_node(interface.node_id)
                .map(|node| node.name)
                .unwrap_or_default();
            let view = InterfaceView::build(&interface, &group_name, &node_name, 0);
            Ok((interface.node_id, view))
        })
        .await?
    };
    publish_node(&state, node_id).await;
    Ok(Json(view))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateInterfaceRequest>,
) -> ApiResult<Json<InterfaceView>> {
    user.require_admin()?;
    let (node_id, view) = {
        let state = state.clone();
        blocking::run_api(move || {
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
            let group_name = state
                .network
                .get_group(interface.group_id)
                .map(|group| group.name)
                .unwrap_or_default();
            let node_name = state
                .network
                .get_node(interface.node_id)
                .map(|node| node.name)
                .unwrap_or_default();
            let peers = state
                .devices
                .peers_for_interface(id)
                .map_err(ApiError::from)?
                .len();
            let view = InterfaceView::build(&interface, &group_name, &node_name, peers);
            Ok((interface.node_id, view))
        })
        .await?
    };
    publish_node(&state, node_id).await;
    Ok(Json(view))
}

pub async fn rotate(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<InterfaceView>> {
    user.require_admin()?;
    let (node_id, view) = {
        let state = state.clone();
        blocking::run_api(move || {
            let settings = state.settings.get().map_err(ApiError::from)?;
            let interface = state
                .network
                .rotate_interface(id, &settings.obfuscation)
                .map_err(ApiError::from)?;
            let group_name = state
                .network
                .get_group(interface.group_id)
                .map(|group| group.name)
                .unwrap_or_default();
            let node_name = state
                .network
                .get_node(interface.node_id)
                .map(|node| node.name)
                .unwrap_or_default();
            let peers = state
                .devices
                .peers_for_interface(id)
                .map_err(ApiError::from)?
                .len();
            let view = InterfaceView::build(&interface, &group_name, &node_name, peers);
            Ok((interface.node_id, view))
        })
        .await?
    };
    publish_node(&state, node_id).await;
    Ok(Json(view))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let node_id = {
        let network = state.network.clone();
        blocking::run_core(move || {
            let interface = network.get_interface(id)?;
            network.delete_interface(id)?;
            Ok(interface.node_id)
        })
        .await
        .map_err(ApiError::from)?
    };
    publish_node(&state, node_id).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded;

    #[test]
    fn interface_list_counts_peers_in_bulk_for_admins() {
        let (env, sample) = seeded();
        let views = load_views(&env.network, &env.devices, InterfaceScope::All).unwrap();
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
    fn interface_list_honours_group_scope() {
        let (env, sample) = seeded();
        let views = load_views(
            &env.network,
            &env.devices,
            InterfaceScope::Group(sample.group_b),
        )
        .unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, sample.iface_b0);
        assert_eq!(views[0].peers, 1);

        let unknown = load_views(
            &env.network,
            &env.devices,
            InterfaceScope::Group(Uuid::new_v4()),
        )
        .unwrap();
        assert!(unknown.is_empty());

        let unassigned = load_views(&env.network, &env.devices, InterfaceScope::Empty).unwrap();
        assert!(unassigned.is_empty());
        assert_eq!(env.peers.list_calls(), 0, "scoped reads skip all_peers");
    }

    #[test]
    fn interface_list_honours_node_scope() {
        let (env, sample) = seeded();
        let node_id = env.network.get_interface(sample.iface_a0).unwrap().node_id;
        let views = load_views(&env.network, &env.devices, InterfaceScope::Node(node_id)).unwrap();
        assert_eq!(views.len(), 3);
        assert!(views.iter().any(|view| view.id == sample.iface_b0));
        assert!(views.iter().all(|view| view.node_id == node_id));
        assert_eq!(env.peers.list_calls(), 0, "scoped reads skip all_peers");

        let foreign = load_views(
            &env.network,
            &env.devices,
            InterfaceScope::Node(Uuid::new_v4()),
        )
        .unwrap();
        assert!(foreign.is_empty());
    }
}
