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

pub(crate) fn publish_user_groups(state: &AppState, user_id: Uuid) {
    let Ok(devices) = state.devices.list_for_user(user_id) else {
        return;
    };
    let groups: HashSet<Uuid> = devices.iter().map(|device| device.group_id).collect();
    for group in groups {
        publish_group(state, group);
    }
}
