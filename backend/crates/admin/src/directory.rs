use std::sync::Arc;

use awg_clients::DeviceService;
use awg_network::{NetworkService, NodeStatus};
use awg_orchestration::NodeDirectory;
use awg_statistics::DeviceDirectory;

pub struct NodesAdapter {
    network: Arc<NetworkService>,
}

impl NodesAdapter {
    pub fn new(network: Arc<NetworkService>) -> Self {
        Self { network }
    }
}

impl NodeDirectory for NodesAdapter {
    fn authenticate(&self, node_id: uuid::Uuid, token: &str) -> awg_shared::CoreResult<()> {
        let node = self.network.authenticate_node(token)?;
        if node.id != node_id {
            return Err(awg_shared::CoreError::Forbidden(
                "worker token does not belong to this node".into(),
            ));
        }
        Ok(())
    }

    fn set_online(
        &self,
        node_id: uuid::Uuid,
        online: bool,
        version: Option<String>,
    ) -> awg_shared::CoreResult<()> {
        self.network.mark_node(
            node_id,
            if online {
                NodeStatus::Online
            } else {
                NodeStatus::Offline
            },
            version,
        )?;
        Ok(())
    }
}

pub struct DevicesAdapter {
    devices: Arc<DeviceService>,
}

impl DevicesAdapter {
    pub fn new(devices: Arc<DeviceService>) -> Self {
        Self { devices }
    }
}

impl DeviceDirectory for DevicesAdapter {
    fn group_and_user(
        &self,
        device_id: uuid::Uuid,
    ) -> awg_shared::CoreResult<Option<(uuid::Uuid, uuid::Uuid)>> {
        match self.devices.get(device_id) {
            Ok(device) => Ok(Some((device.group_id, device.user_id))),
            Err(awg_shared::CoreError::NotFound(_)) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn group_and_user_many(
        &self,
        device_ids: &[uuid::Uuid],
    ) -> awg_shared::CoreResult<std::collections::HashMap<uuid::Uuid, (uuid::Uuid, uuid::Uuid)>>
    {
        if device_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let wanted: std::collections::HashSet<uuid::Uuid> = device_ids.iter().copied().collect();
        Ok(self
            .devices
            .list_all()?
            .into_iter()
            .filter(|device| wanted.contains(&device.id))
            .map(|device| (device.id, (device.group_id, device.user_id)))
            .collect())
    }
}
