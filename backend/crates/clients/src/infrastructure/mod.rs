use std::sync::Arc;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use awg_shared::crypto::Sealer;
use awg_shared::{CoreError, CoreResult};
use awg_storage::device_index::DevicePageEntry;
use awg_storage::{StorageError, Store, Table};

use crate::domain::{
    Device, DevicePage, DevicePageQuery, DevicePeer, DevicePeerRepository, DeviceRepository,
    ShareConsume, ShareLink, ShareLinkRepository, ShareLinkState, hash_share_token,
};

fn map_err(e: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(e.to_string()))
}

fn index_entry(device: &Device) -> DevicePageEntry {
    DevicePageEntry::new(
        device.id,
        device.user_id,
        device.group_id,
        device.interface_id,
        &device.name,
        device.revoked,
        device.created_at.timestamp_micros(),
    )
}

pub struct RedbDeviceRepository {
    store: Arc<Store>,
}

impl RedbDeviceRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    /// Atomic read-modify-write of one device row.
    ///
    /// The stored row is read, mutated and written together with both page
    /// indexes in a single transaction, so concurrent writers cannot lose each
    /// other's fields (for example, an update cannot resurrect a revoked
    /// device).
    fn mutate(
        &self,
        id: Uuid,
        apply: impl FnOnce(&mut Device, &[Device]) -> CoreResult<()>,
    ) -> CoreResult<Device> {
        let key = id.to_string();
        awg_storage::device_index::mutate_device::<Device, _>(&self.store, &key, |stored| {
            let Some(mut device) = stored else {
                return (None, Err(CoreError::NotFound("device".into())));
            };
            let siblings = match self.store.list::<Device>(Table::Devices) {
                Ok(devices) => devices,
                Err(error) => return (Some(device), Err(map_err(error))),
            };
            // `apply` mutates the row in place and may fail half-way through
            // (for example after the name was set but before the tariff limit
            // check). Keep the stored value and write that back on error so a
            // rejected update never persists any of its fields.
            let original = device.clone();
            match apply(&mut device, &siblings) {
                Ok(()) => {
                    device.updated_at = Utc::now();
                    (Some(device.clone()), Ok(device))
                }
                Err(error) => (Some(original), Err(error)),
            }
        })
        .map_err(map_err)?
    }
}

impl DeviceRepository for RedbDeviceRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Device>> {
        self.store
            .get(Table::Devices, &id.to_string())
            .map_err(map_err)
    }

    fn apply_update(
        &self,
        id: Uuid,
        change: &crate::domain::DeviceChange<'_>,
    ) -> CoreResult<Device> {
        self.mutate(id, |device, siblings| {
            crate::domain::apply_device_change(device, siblings, change)
        })
    }

    fn set_revoked(&self, id: Uuid, revoked: bool) -> CoreResult<Device> {
        self.mutate(id, |device, _| {
            device.revoked = revoked;
            Ok(())
        })
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
        let entry = index_entry(device);
        awg_storage::device_index::upsert_device(
            &self.store,
            &device.id.to_string(),
            device,
            &entry,
        )
        .map_err(map_err)
    }

    fn delete(&self, id: Uuid) -> CoreResult<()> {
        awg_storage::device_index::delete_device(&self.store, &id.to_string()).map_err(map_err)
    }

    fn page(&self, query: &DevicePageQuery) -> CoreResult<DevicePage> {
        let sort = match query.sort {
            crate::domain::DevicePageSort::Name => awg_storage::device_index::DeviceIndexSort::Name,
            crate::domain::DevicePageSort::Created => {
                awg_storage::device_index::DeviceIndexSort::Created
            }
        };
        let descending = query.order == crate::domain::DevicePageOrder::Desc;
        let unfiltered = query.status == crate::domain::DevicePageStatus::All
            && query.interface_id.is_none()
            && query.user_id.is_none()
            && query.q.is_none();
        let (ids, total) = if unfiltered {
            awg_storage::device_index::scan_all(
                &self.store,
                sort,
                descending,
                query.offset,
                query.limit,
            )
            .map_err(map_err)?
        } else {
            awg_storage::device_index::scan(
                &self.store,
                sort,
                descending,
                query.offset,
                query.limit,
                |entry| {
                    query.status.matches(entry.revoked)
                        && query.interface_id.is_none_or(|id| entry.interface_id == id)
                        && query.user_id.is_none_or(|id| entry.user_id == id)
                        && query.q_matches(&entry.name, entry.user_id)
                },
            )
            .map_err(map_err)?
        };
        let keys: Vec<String> = ids.iter().map(ToString::to_string).collect();
        let items: Vec<Device> = self
            .store
            .get_many(Table::Devices, &keys)
            .map_err(map_err)?;
        Ok(DevicePage {
            items,
            total,
            limit: query.limit,
            offset: query.offset,
        })
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
    sealer: Arc<Sealer>,
}

impl RedbShareLinkRepository {
    pub fn new(store: Arc<Store>, sealer: Arc<Sealer>) -> Self {
        Self { store, sealer }
    }

    fn hydrate(&self, link: &mut ShareLink) -> CoreResult<()> {
        if !link.token_sealed.is_empty() {
            link.token = self.sealer.open_str(&link.token_sealed)?;
        }
        Ok(())
    }

    fn prepare(&self, link: &ShareLink) -> CoreResult<ShareLink> {
        let mut record = link.clone();
        if !record.token.is_empty() {
            record.token_hash = hash_share_token(&record.token);
            record.token_sealed = self.sealer.seal_str(&record.token)?;
        }
        if record.token_hash.is_empty() {
            return Err(CoreError::Invalid("share link has no token".into()));
        }
        Ok(record)
    }
}

impl ShareLinkRepository for RedbShareLinkRepository {
    fn find(&self, token: &str) -> CoreResult<Option<ShareLink>> {
        let hash = hash_share_token(token);
        let Some(mut link) = self.store.get(Table::ShareLinks, &hash).map_err(map_err)? else {
            return Ok(None);
        };
        self.hydrate(&mut link)?;
        Ok(Some(link))
    }

    fn list(&self) -> CoreResult<Vec<ShareLink>> {
        let mut links: Vec<ShareLink> = self.store.list(Table::ShareLinks).map_err(map_err)?;
        for link in &mut links {
            self.hydrate(link)?;
        }
        Ok(links)
    }

    fn save(&self, link: &ShareLink) -> CoreResult<()> {
        let record = self.prepare(link)?;
        self.store
            .put(Table::ShareLinks, &record.token_hash, &record)
            .map_err(map_err)
    }

    fn delete(&self, token: &str) -> CoreResult<()> {
        let hash = hash_share_token(token);
        self.store.delete(Table::ShareLinks, &hash).map_err(map_err)
    }

    fn consume(&self, token: &str, now: DateTime<Utc>) -> CoreResult<ShareConsume> {
        let hash = hash_share_token(token);
        // Public endpoint: never open a write transaction unless the link is
        // actually consumable. Missing, revoked, expired and exhausted links
        // are rejected by a plain read.
        let Some(link) = self
            .store
            .get::<ShareLink>(Table::ShareLinks, &hash)
            .map_err(map_err)?
        else {
            return Ok(ShareConsume::NotFound);
        };
        match link.state(now) {
            ShareLinkState::Active => {}
            ShareLinkState::Revoked => return Ok(ShareConsume::Revoked),
            ShareLinkState::Expired => return Ok(ShareConsume::Expired),
            ShareLinkState::Exhausted => return Ok(ShareConsume::Exhausted),
        }
        // Re-check the state inside the transaction: another request may have
        // consumed the last use between the read above and this write.
        let outcome = self
            .store
            .update::<ShareLink, _>(Table::ShareLinks, &hash, |current| match current {
                None => (None, ShareConsume::NotFound),
                Some(link) => match link.state(now) {
                    ShareLinkState::Active => {
                        let mut link = link;
                        link.uses = link.uses.saturating_add(1);
                        link.used_at = Some(now);
                        (Some(link.clone()), ShareConsume::Consumed(link))
                    }
                    ShareLinkState::Revoked => (Some(link), ShareConsume::Revoked),
                    ShareLinkState::Expired => (Some(link), ShareConsume::Expired),
                    ShareLinkState::Exhausted => (Some(link), ShareConsume::Exhausted),
                },
            })
            .map_err(map_err)?;
        match outcome {
            ShareConsume::Consumed(mut link) => {
                self.hydrate(&mut link)?;
                Ok(ShareConsume::Consumed(link))
            }
            other => Ok(other),
        }
    }
}

impl DevicePeerRepository for RedbDevicePeerRepository {
    fn find(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<Option<DevicePeer>> {
        let prefix = format!("{device_id}:{interface_id}:");
        let mut peers: Vec<DevicePeer> = self
            .store
            .list_prefix(Table::DevicePeers, &prefix)
            .map_err(map_err)?
            .into_iter()
            .map(|(_, peer)| peer)
            .collect();
        peers.sort_by(|left, right| left.primary_order().cmp(&right.primary_order()));
        Ok(peers.into_iter().next())
    }

    fn find_peer(&self, peer_id: Uuid) -> CoreResult<Option<DevicePeer>> {
        Ok(self.list()?.into_iter().find(|peer| peer.id == peer_id))
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

    fn by_devices(&self, device_ids: &[Uuid]) -> CoreResult<Vec<DevicePeer>> {
        let mut out = Vec::new();
        for device_id in device_ids {
            out.extend(
                self.store
                    .list_prefix::<DevicePeer>(Table::DevicePeers, &format!("{device_id}:"))
                    .map_err(map_err)?
                    .into_iter()
                    .map(|(_, peer)| peer),
            );
        }
        Ok(out)
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
            .put(Table::DevicePeers, &peer.key(), peer)
            .map_err(map_err)
    }

    fn delete_for_device(&self, device_id: Uuid) -> CoreResult<usize> {
        self.store
            .delete_prefix(Table::DevicePeers, &format!("{device_id}:"))
            .map_err(map_err)
    }

    fn delete_peer(&self, peer_id: Uuid) -> CoreResult<()> {
        let Some(peer) = self.find_peer(peer_id)? else {
            return Ok(());
        };
        self.store
            .delete(Table::DevicePeers, &peer.key())
            .map_err(map_err)
    }

    fn delete(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<()> {
        self.store
            .delete_prefix(Table::DevicePeers, &format!("{device_id}:{interface_id}:"))
            .map(|_| ())
            .map_err(map_err)
    }
}
