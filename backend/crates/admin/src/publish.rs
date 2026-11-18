use std::collections::HashSet;

use uuid::Uuid;

use crate::state::AppState;

pub(crate) fn publish_group(state: &AppState, group_id: Uuid) {
    if let Ok(interfaces) = state.network.interfaces_by_group(group_id) {
        let mut nodes: Vec<Uuid> = interfaces.iter().map(|i| i.node_id).collect();
        nodes.sort();
        nodes.dedup();
        for node in nodes {
            let _ = state.orchestration.publish(node);
        }
    }
}

pub(crate) fn publish_nodes(state: &AppState, mut nodes: Vec<Uuid>) {
    nodes.sort();
    nodes.dedup();
    for node in nodes {
        let _ = state.orchestration.publish(node);
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

/// Publishes every group that can be affected by a user change: the group the
/// user is assigned to plus the groups of their devices.
pub(crate) fn publish_user_groups(state: &AppState, user_id: Uuid) {
    let mut groups: HashSet<Uuid> = HashSet::new();
    if let Ok(user) = state.identity.find(user_id)
        && let Some(group_id) = user.group_id
    {
        groups.insert(group_id);
    }
    if let Ok(devices) = state.devices.list_for_user(user_id) {
        groups.extend(devices.iter().map(|device| device.group_id));
    }
    for group in groups {
        publish_group(state, group);
    }
}
