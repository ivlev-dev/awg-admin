use std::sync::Arc;

use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use crate::domain::{
    Device, DevicePeer, DevicePeerRepository, DeviceRepository, ShareLink, ShareLinkRepository,
};

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

pub struct RedbDeviceRepository {
    store: Arc<Store>,
}

impl RedbDeviceRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl DeviceRepository for RedbDeviceRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Device>> {
        self.store
            .get(Table::Devices, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Device>> {
        self.store.list(Table::Devices).map_err(map_err)
    }

    fn by_user(&self, user_id: Uuid) -> CoreResult<Vec<Device>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|d| d.user_id == user_id)
            .collect())
    }

    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Device>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|d| d.group_id == group_id)
            .collect())
    }

    fn save(&self, device: &Device) -> CoreResult<()> {
        self.store
            .put(Table::Devices, &device.id.to_string(), device)
            .map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        self.store
            .delete(Table::Devices, &id.to_string())
            .map_err(map_err)
    }
}

pub struct RedbDevicePeerRepository {
    store: Arc<Store>,
}

impl RedbDevicePeerRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

pub struct RedbShareLinkRepository {
    store: Arc<Store>,
}

impl RedbShareLinkRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl ShareLinkRepository for RedbShareLinkRepository {
    fn find(&self, token: &str) -> CoreResult<Option<ShareLink>> {
        self.store.get(Table::ShareLinks, token).map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<ShareLink>> {
        self.store.list(Table::ShareLinks).map_err(map_err)
    }

    fn save(&self, link: &ShareLink) -> CoreResult<()> {
        self.store
            .put(Table::ShareLinks, &link.token, link)
            .map_err(map_err)
    }

    fn delete(&self, token: &str) -> CoreResult<()> {
        self.store.delete(Table::ShareLinks, token).map_err(map_err)
    }
}

impl DevicePeerRepository for RedbDevicePeerRepository {
    fn find(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<Option<DevicePeer>> {
        self.store
            .get(
                Table::DevicePeers,
                &DevicePeer::key(device_id, interface_id),
            )
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<DevicePeer>> {
        self.store.list(Table::DevicePeers).map_err(map_err)
    }

    fn by_device(&self, device_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|p| p.device_id == device_id)
            .collect())
    }

    fn by_interface(&self, interface_id: Uuid) -> CoreResult<Vec<DevicePeer>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|p| p.interface_id == interface_id)
            .collect())
    }

    fn save(&self, peer: &DevicePeer) -> CoreResult<()> {
        self.store
            .put(
                Table::DevicePeers,
                &DevicePeer::key(peer.device_id, peer.interface_id),
                peer,
            )
            .map_err(map_err)
    }

    fn delete_for_device(&self, device_id: Uuid) -> CoreResult<usize> {
        self.store
            .delete_prefix(Table::DevicePeers, &format!("{device_id}:"))
            .map_err(map_err)
    }

    fn delete(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<()> {
        self.store
            .delete(
                Table::DevicePeers,
                &DevicePeer::key(device_id, interface_id),
            )
            .map_err(map_err)
    }
}
