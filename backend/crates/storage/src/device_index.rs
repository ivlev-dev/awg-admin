use chrono::DateTime;
use redb::{ReadableTable, ReadableTableMetadata};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{Result, Store, Table, WriteTransaction};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DevicePageEntry {
    pub device_id: Uuid,
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub interface_id: Uuid,
    pub name: String,
    pub revoked: bool,
    pub created_micros: i64,
}

impl DevicePageEntry {
    pub fn new(
        device_id: Uuid,
        user_id: Uuid,
        group_id: Uuid,
        interface_id: Uuid,
        name: &str,
        revoked: bool,
        created_micros: i64,
    ) -> Self {
        Self {
            device_id,
            user_id,
            group_id,
            interface_id,
            name: name.to_string(),
            revoked,
            created_micros,
        }
    }

    pub fn from_json(value: &Value) -> Option<Self> {
        let device_id = value.get("id")?.as_str().and_then(parse_uuid)?;
        let user_id = value.get("user_id")?.as_str().and_then(parse_uuid)?;
        let group_id = value
            .get("group_id")
            .and_then(Value::as_str)
            .and_then(parse_uuid)
            .unwrap_or(Uuid::nil());
        let interface_id = value
            .get("interface_id")
            .and_then(Value::as_str)
            .and_then(parse_uuid)
            .unwrap_or(Uuid::nil());
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let revoked = value
            .get("revoked")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let created_micros = value
            .get("created_at")
            .and_then(Value::as_str)
            .and_then(parse_micros)?;
        Some(Self {
            device_id,
            user_id,
            group_id,
            interface_id,
            name,
            revoked,
            created_micros,
        })
    }

    pub fn name_key(&self) -> String {
        name_index_key(&self.name, self.device_id)
    }

    pub fn created_key(&self) -> String {
        created_index_key(self.created_micros, self.device_id)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }
}

pub fn name_index_key(name: &str, device_id: Uuid) -> String {
    format!("{}|{}", name.to_lowercase(), device_id)
}

pub fn created_index_key(created_micros: i64, device_id: Uuid) -> String {
    format!("{created_micros:020}|{device_id}")
}

pub fn parse_micros(raw: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.timestamp_micros())
}

fn parse_uuid(raw: &str) -> Option<Uuid> {
    Uuid::parse_str(raw).ok()
}

pub fn insert_entry(txn: &WriteTransaction, entry: &DevicePageEntry) -> Result<()> {
    let bytes = entry.to_bytes()?;
    {
        let mut table = txn.open_table(Table::DevicePageIndex.definition())?;
        table.insert(entry.name_key().as_str(), bytes.as_slice())?;
    }
    {
        let mut table = txn.open_table(Table::DeviceCreatedIndex.definition())?;
        table.insert(entry.created_key().as_str(), bytes.as_slice())?;
    }
    Ok(())
}

pub fn remove_entry(txn: &WriteTransaction, entry: &DevicePageEntry) -> Result<()> {
    {
        let mut table = txn.open_table(Table::DevicePageIndex.definition())?;
        table.remove(entry.name_key().as_str())?;
    }
    {
        let mut table = txn.open_table(Table::DeviceCreatedIndex.definition())?;
        table.remove(entry.created_key().as_str())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceIndexSort {
    Name,
    Created,
}

/// Scans one of the device page indexes in key order and returns the ids of
/// the requested window together with the total number of matching entries.
/// `keep` is evaluated for every index entry, but at most `limit` ids are
/// retained, so the caller never materializes the whole device list.
pub fn scan<F>(
    store: &Store,
    sort: DeviceIndexSort,
    descending: bool,
    offset: usize,
    limit: usize,
    mut keep: F,
) -> Result<(Vec<Uuid>, usize)>
where
    F: FnMut(&DevicePageEntry) -> bool,
{
    store.with_read_txn(|txn| {
        let table = txn.open_table(match sort {
            DeviceIndexSort::Name => Table::DevicePageIndex.definition(),
            DeviceIndexSort::Created => Table::DeviceCreatedIndex.definition(),
        })?;
        let mut total = 0usize;
        let mut ids: Vec<Uuid> = Vec::new();
        macro_rules! drain {
            ($iter:expr) => {
                for entry in $iter {
                    let (_, value) = entry?;
                    let entry: DevicePageEntry = serde_json::from_slice(value.value())?;
                    if !keep(&entry) {
                        continue;
                    }
                    if total >= offset && ids.len() < limit {
                        ids.push(entry.device_id);
                    }
                    total += 1;
                }
            };
        }
        if descending {
            drain!(table.iter()?.rev());
        } else {
            drain!(table.iter()?);
        }
        Ok((ids, total))
    })
}

/// Counts every index entry and reads only the requested window. This is the
/// fast path for an unfiltered page: `total` comes from the table length and
/// no index value is decoded beyond the window itself.
pub fn scan_all(
    store: &Store,
    sort: DeviceIndexSort,
    descending: bool,
    offset: usize,
    limit: usize,
) -> Result<(Vec<Uuid>, usize)> {
    store.with_read_txn(|txn| {
        let table = txn.open_table(match sort {
            DeviceIndexSort::Name => Table::DevicePageIndex.definition(),
            DeviceIndexSort::Created => Table::DeviceCreatedIndex.definition(),
        })?;
        let total = table.len()? as usize;
        let mut ids: Vec<Uuid> = Vec::new();
        macro_rules! drain {
            ($iter:expr) => {
                for entry in $iter {
                    if ids.len() >= limit {
                        break;
                    }
                    let (_, value) = entry?;
                    let entry: DevicePageEntry = serde_json::from_slice(value.value())?;
                    ids.push(entry.device_id);
                }
            };
        }
        if descending {
            drain!(table.iter()?.rev().skip(offset));
        } else {
            drain!(table.iter()?.skip(offset));
        }
        Ok((ids, total))
    })
}

/// Writes a device and keeps both page indexes in sync within one transaction.
pub fn upsert_device<T: Serialize + ?Sized>(
    store: &Store,
    key: &str,
    device: &T,
    entry: &DevicePageEntry,
) -> Result<()> {
    let bytes = serde_json::to_vec(device)?;
    store.with_write_txn(|txn| {
        let previous = {
            let mut table = txn.open_table(Table::Devices.definition())?;
            let previous = table.get(key)?.map(|value| value.value().to_vec());
            table.insert(key, bytes.as_slice())?;
            previous
        };
        if let Some(previous) = previous {
            let parsed: Value = serde_json::from_slice(&previous)?;
            if let Some(old) = DevicePageEntry::from_json(&parsed) {
                remove_entry(txn, &old)?;
            }
        }
        insert_entry(txn, entry)?;
        Ok(())
    })
}

/// Removes a device and its page index entries within one transaction.
pub fn delete_device(store: &Store, key: &str) -> Result<()> {
    store.with_write_txn(|txn| {
        let previous = {
            let mut table = txn.open_table(Table::Devices.definition())?;
            let previous = table.get(key)?.map(|value| value.value().to_vec());
            table.remove(key)?;
            previous
        };
        if let Some(previous) = previous {
            let parsed: Value = serde_json::from_slice(&previous)?;
            if let Some(old) = DevicePageEntry::from_json(&parsed) {
                remove_entry(txn, &old)?;
            }
        }
        Ok(())
    })
}

/// Atomic read-modify-write for one device row.
///
/// Runs read, `apply`, write and both index updates in a single write
/// transaction, so a revocation written here cannot be overwritten by a
/// concurrent [`Store::update`]. The name and created-at index rows of the old
/// value are removed before the new value is indexed.
pub fn mutate_device<T, R>(
    store: &Store,
    key: &str,
    apply: impl FnOnce(Option<T>) -> (Option<T>, R),
) -> Result<R>
where
    T: Serialize + DeserializeOwned,
{
    store.with_write_txn(|txn| {
        let previous = {
            let table = txn.open_table(Table::Devices.definition())?;
            table.get(key)?.map(|value| value.value().to_vec())
        };
        let current = match &previous {
            Some(bytes) => Some(serde_json::from_slice(bytes)?),
            None => None,
        };
        let (next, output) = apply(current);
        let next = match next {
            Some(value) => Some(serde_json::to_value(&value)?),
            None => None,
        };

        {
            let mut table = txn.open_table(Table::Devices.definition())?;
            match &next {
                Some(value) => {
                    let bytes = serde_json::to_vec(value)?;
                    table.insert(key, bytes.as_slice())?;
                }
                None => {
                    table.remove(key)?;
                }
            }
        }

        if let Some(previous) = previous {
            let parsed: Value = serde_json::from_slice(&previous)?;
            if let Some(old) = DevicePageEntry::from_json(&parsed) {
                remove_entry(txn, &old)?;
            }
        }
        if let Some(value) = &next
            && let Some(entry) = DevicePageEntry::from_json(value)
        {
            insert_entry(txn, &entry)?;
        }
        Ok(output)
    })
}

pub(crate) fn clear(txn: &WriteTransaction) -> Result<()> {
    clear_table(txn, Table::DevicePageIndex)?;
    clear_table(txn, Table::DeviceCreatedIndex)?;
    Ok(())
}

fn clear_table(txn: &WriteTransaction, table: Table) -> Result<()> {
    let keys: Vec<String> = {
        let table = txn.open_table(table.definition())?;
        table
            .iter()?
            .map(|entry| entry.map(|(key, _)| key.value().to_string()))
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    if keys.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(table.definition())?;
    for key in keys {
        table.remove(key.as_str())?;
    }
    Ok(())
}

pub(crate) fn backfill(txn: &WriteTransaction) -> Result<()> {
    let entries: Vec<DevicePageEntry> = {
        let devices = txn.open_table(Table::Devices.definition())?;
        let mut entries = Vec::new();
        for entry in devices.iter()? {
            let (_, value) = entry?;
            let parsed: Value = serde_json::from_slice(value.value())?;
            if let Some(index) = DevicePageEntry::from_json(&parsed) {
                entries.push(index);
            }
        }
        entries
    };
    clear(txn)?;
    for entry in entries {
        insert_entry(txn, &entry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_keys_are_case_insensitive_and_ordered_by_device() {
        let lower = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let upper = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let a = name_index_key("Phone", lower);
        let b = name_index_key("phone", upper);
        assert_eq!(a, format!("phone|{lower}"));
        assert_eq!(b, format!("phone|{upper}"));
        assert!(a < b);
        assert_eq!(name_index_key("PHONE", lower), a);
    }

    #[test]
    fn created_keys_sort_by_timestamp() {
        let first = Uuid::parse_str("00000000-0000-0000-0000-00000000000a").unwrap();
        let second = Uuid::parse_str("00000000-0000-0000-0000-00000000000b").unwrap();
        assert!(created_index_key(1_000, first) < created_index_key(2_000, second));
        assert!(created_index_key(1_000, first) < created_index_key(1_000, second));
    }

    #[test]
    fn parses_legacy_device_json() {
        let id = Uuid::new_v4();
        let user = Uuid::new_v4();
        let group = Uuid::new_v4();
        let value = serde_json::json!({
            "id": id,
            "user_id": user,
            "group_id": group,
            "name": "Phone",
            "revoked": true,
            "created_at": "2026-01-02T03:04:05.123456Z",
        });
        let entry = DevicePageEntry::from_json(&value).unwrap();
        assert_eq!(entry.device_id, id);
        assert_eq!(entry.user_id, user);
        assert_eq!(entry.group_id, group);
        assert_eq!(entry.interface_id, Uuid::nil());
        assert_eq!(entry.name, "Phone");
        assert!(entry.revoked);
        assert_eq!(entry.created_micros, 1_767_323_045_123_456);
    }

    #[test]
    fn rejects_entries_without_created_at() {
        let value = serde_json::json!({
            "id": Uuid::new_v4(),
            "user_id": Uuid::new_v4(),
        });
        assert!(DevicePageEntry::from_json(&value).is_none());
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct DeviceRow {
        id: Uuid,
        user_id: Uuid,
        group_id: Uuid,
        interface_id: Uuid,
        name: String,
        revoked: bool,
        created_at: String,
    }

    #[test]
    fn mutate_device_updates_row_and_both_indexes() {
        let store = Store::open_in_memory().unwrap();
        let id = Uuid::new_v4();
        let key = id.to_string();
        let device = DeviceRow {
            id,
            user_id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            interface_id: Uuid::new_v4(),
            name: "Phone".to_string(),
            revoked: false,
            created_at: "2026-01-02T03:04:05Z".to_string(),
        };

        let created = mutate_device::<DeviceRow, _>(&store, &key, |current| {
            assert!(current.is_none());
            (Some(device.clone()), 1u8)
        })
        .unwrap();
        assert_eq!(created, 1);

        let old_name_key = name_index_key("Phone", id);
        let old_created_key = created_index_key(parse_micros(&device.created_at).unwrap(), id);
        assert_eq!(
            store.keys(Table::DevicePageIndex).unwrap(),
            vec![old_name_key.clone()]
        );
        assert_eq!(
            store.keys(Table::DeviceCreatedIndex).unwrap(),
            vec![old_created_key.clone()]
        );

        let updated_created = "2026-02-03T04:05:06Z";
        mutate_device::<DeviceRow, _>(&store, &key, |current| {
            let mut device = current.expect("the device exists");
            device.name = "Laptop".to_string();
            device.revoked = true;
            device.created_at = updated_created.to_string();
            (Some(device), ())
        })
        .unwrap();

        let new_name_key = name_index_key("Laptop", id);
        let new_created_key = created_index_key(parse_micros(updated_created).unwrap(), id);
        let name_keys = store.keys(Table::DevicePageIndex).unwrap();
        assert_eq!(name_keys, vec![new_name_key.clone()]);
        assert!(
            !name_keys.contains(&old_name_key),
            "the old name key must be gone"
        );
        let created_keys = store.keys(Table::DeviceCreatedIndex).unwrap();
        assert_eq!(created_keys, vec![new_created_key.clone()]);
        assert!(
            !created_keys.contains(&old_created_key),
            "the old created-at key must be gone"
        );

        let entry: DevicePageEntry = store
            .get(Table::DevicePageIndex, &new_name_key)
            .unwrap()
            .unwrap();
        assert!(entry.revoked);
        assert_eq!(entry.name, "Laptop");

        mutate_device::<DeviceRow, _>(&store, &key, |_| (None, ())).unwrap();
        assert!(
            store
                .get::<DeviceRow>(Table::Devices, &key)
                .unwrap()
                .is_none()
        );
        assert!(store.keys(Table::DevicePageIndex).unwrap().is_empty());
        assert!(store.keys(Table::DeviceCreatedIndex).unwrap().is_empty());
    }
}
