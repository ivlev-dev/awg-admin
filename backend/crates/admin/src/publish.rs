use std::collections::HashSet;
use std::sync::Arc;

use uuid::Uuid;

use crate::blocking;
use crate::state::AppState;

pub(crate) async fn publish_group(state: &Arc<AppState>, group_id: Uuid) {
    let state = state.clone();
    let _ = blocking::run_ignored(move || publish_group_now(&state, group_id)).await;
}

pub(crate) async fn publish_nodes(state: &Arc<AppState>, mut nodes: Vec<Uuid>) {
    nodes.sort_unstable();
    nodes.dedup();
    let state = state.clone();
    let _ = blocking::run_ignored(move || {
        for node in nodes {
            push_node(&state, node);
        }
    })
    .await;
}

/// Publishes every group that can be affected by a user change: the group the
/// user is assigned to plus the groups of their devices.
pub(crate) async fn publish_user_groups(state: &Arc<AppState>, user_id: Uuid) {
    let state = state.clone();
    let _ = blocking::run_ignored(move || publish_user_groups_now(&state, user_id)).await;
}

pub(crate) async fn publish_dirty(state: &Arc<AppState>) -> usize {
    let state = state.clone();
    blocking::run_ignored(move || state.orchestration.publish_dirty())
        .await
        .unwrap_or_default()
}

pub(crate) async fn publish_all(state: &Arc<AppState>) {
    let state = state.clone();
    let _ = blocking::run_ignored(move || state.orchestration.publish_all()).await;
}

pub(crate) async fn publish_node(state: &Arc<AppState>, node_id: Uuid) {
    let state = state.clone();
    let _ = blocking::run_ignored(move || push_node(&state, node_id)).await;
}

fn publish_group_now(state: &AppState, group_id: Uuid) {
    let mut nodes = node_ids_for_group(state, group_id);
    nodes.sort_unstable();
    nodes.dedup();
    for node in nodes {
        push_node(state, node);
    }
}

fn push_node(state: &AppState, node: Uuid) {
    // Building a snapshot for a node without a connected worker is wasted
    // work. Offline nodes receive a fresh snapshot on connect, so no pending
    // marker is required.
    if !state.registry.is_online(node) {
        return;
    }
    if state.registry.mark_dirty(node) {
        let _ = state.orchestration.publish(node);
    }
}

fn publish_user_groups_now(state: &AppState, user_id: Uuid) {
    let mut groups: HashSet<Uuid> = HashSet::new();
    if let Ok(user) = state.identity.find(user_id)
        && let Some(group_id) = user.group_id
    {
        groups.insert(group_id);
    }
    if let Ok(devices) = state.devices.list_for_user(user_id) {
        groups.extend(devices.iter().map(|device| device.group_id));
    }
    let mut nodes: HashSet<Uuid> = HashSet::new();
    for group in groups {
        nodes.extend(node_ids_for_group(state, group));
    }
    let mut nodes: Vec<Uuid> = nodes.into_iter().collect();
    nodes.sort_unstable();
    for node in nodes {
        push_node(state, node);
    }
}

pub(crate) fn node_ids_for_group(state: &AppState, group_id: Uuid) -> Vec<Uuid> {
    state
        .network
        .interfaces_by_group(group_id)
        .map(|interfaces| {
            interfaces
                .into_iter()
                .map(|interface| interface.node_id)
                .collect()
        })
        .unwrap_or_default()
}
