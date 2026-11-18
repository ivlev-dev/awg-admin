use redb::{Database, ReadableDatabase, ReadableTable, WriteTransaction};
use serde_json::{Value, json};

use crate::{ALL_TABLES, Result, StorageError, Table};

pub const CURRENT_SCHEMA_VERSION: u32 = 5;
pub const SCHEMA_VERSION_KEY: &str = "schema_version";
const NIL_UUID: &str = "00000000-0000-0000-0000-000000000000";

pub type MigrationFn = fn(&WriteTransaction) -> Result<()>;

#[derive(Debug, Clone, Copy)]
pub struct MigrationStep {
    pub from: u32,
    pub to: u32,
    pub apply: MigrationFn,
}

pub const MIGRATIONS: &[MigrationStep] = &[
    MigrationStep {
        from: 1,
        to: 2,
        apply: v2_billing,
    },
    MigrationStep {
        from: 2,
        to: 3,
        apply: v3_rate_limits,
    },
    MigrationStep {
        from: 3,
        to: 4,
        apply: v4_device_interfaces,
    },
    MigrationStep {
        from: 4,
        to: 5,
        apply: v5_user_nodes,
    },
];

const BILLING_TABLES: &[Table] = &[
    Table::BillingPlans,
    Table::BillingSubscriptions,
    Table::BillingInvoices,
    Table::BillingPaymentMethods,
    Table::BillingEvents,
];

const RATE_LIMIT_TABLES: &[Table] = &[Table::RateLimits];

fn v2_billing(txn: &WriteTransaction) -> Result<()> {
    for table in BILLING_TABLES {
        txn.open_table(table.definition())?;
    }
    Ok(())
}

fn v3_rate_limits(txn: &WriteTransaction) -> Result<()> {
    for table in RATE_LIMIT_TABLES {
        txn.open_table(table.definition())?;
    }
    Ok(())
}

fn read_values(txn: &WriteTransaction, table: Table) -> Result<Vec<(String, Value)>> {
    let table = txn.open_table(table.definition())?;
    let mut out = Vec::new();
    for entry in table.iter()? {
        let (key, value) = entry?;
        out.push((
            key.value().to_string(),
            serde_json::from_slice(value.value())?,
        ));
    }
    Ok(out)
}

fn v4_device_interfaces(txn: &WriteTransaction) -> Result<()> {
    let mut interfaces_by_group: std::collections::BTreeMap<String, Vec<(String, bool)>> =
        std::collections::BTreeMap::new();
    for (_, value) in read_values(txn, Table::Interfaces)? {
        let (Some(id), Some(group_id)) = (
            value.get("id").and_then(Value::as_str),
            value.get("group_id").and_then(Value::as_str),
        ) else {
            continue;
        };
        let enabled = value
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        interfaces_by_group
            .entry(group_id.to_string())
            .or_default()
            .push((id.to_string(), enabled));
    }

    let peers = read_values(txn, Table::DevicePeers)?;
    let mut updated_devices: Vec<(String, Value)> = Vec::new();
    let mut removed_peers: Vec<String> = Vec::new();
    let mut replacement_peers: Vec<(String, Value)> = Vec::new();

    for (key, mut device) in read_values(txn, Table::Devices)? {
        let Some(group_id) = device.get("group_id").and_then(Value::as_str) else {
            continue;
        };
        let existing = device
            .get("interface_id")
            .and_then(Value::as_str)
            .filter(|id| *id != NIL_UUID)
            .map(str::to_string);
        let chosen = existing.or_else(|| {
            let candidates = interfaces_by_group.get(group_id)?;
            candidates
                .iter()
                .find(|(_, enabled)| *enabled)
                .or_else(|| candidates.first())
                .map(|(id, _)| id.clone())
        });
        let Some(interface_id) = chosen else {
            continue;
        };
        if device.get("interface_id").and_then(Value::as_str) != Some(interface_id.as_str()) {
            device["interface_id"] = json!(interface_id);
            updated_devices.push((key.clone(), device));
        }

        let prefix = format!("{key}:");
        let device_peers: Vec<&(String, Value)> = peers
            .iter()
            .filter(|(peer_key, _)| peer_key.starts_with(&prefix))
            .collect();
        let target_key = format!("{key}:{interface_id}");
        if device_peers
            .iter()
            .any(|(peer_key, _)| *peer_key == target_key)
        {
            for (peer_key, _) in device_peers {
                if *peer_key != target_key {
                    removed_peers.push(peer_key.clone());
                }
            }
            continue;
        }
        let Some((_, template)) = device_peers.first() else {
            continue;
        };
        let mut peer = template.clone();
        peer["device_id"] = json!(key);
        peer["interface_id"] = json!(interface_id);
        replacement_peers.push((target_key.clone(), peer));
        for (peer_key, _) in device_peers {
            if *peer_key != target_key {
                removed_peers.push(peer_key.clone());
            }
        }
    }

    if !updated_devices.is_empty() {
        let mut table = txn.open_table(Table::Devices.definition())?;
        for (key, value) in updated_devices {
            let bytes = serde_json::to_vec(&value)?;
            table.insert(key.as_str(), bytes.as_slice())?;
        }
    }
    if !removed_peers.is_empty() || !replacement_peers.is_empty() {
        let mut table = txn.open_table(Table::DevicePeers.definition())?;
        for key in removed_peers {
            table.remove(key.as_str())?;
        }
        for (key, value) in replacement_peers {
            let bytes = serde_json::to_vec(&value)?;
            table.insert(key.as_str(), bytes.as_slice())?;
        }
    }
    Ok(())
}

fn v5_user_nodes(txn: &WriteTransaction) -> Result<()> {
    let mut nodes_by_group: std::collections::BTreeMap<String, String> =
        std::collections::BTreeMap::new();
    for (_, value) in read_values(txn, Table::Interfaces)? {
        let (Some(group_id), Some(node_id)) = (
            value.get("group_id").and_then(Value::as_str),
            value.get("node_id").and_then(Value::as_str),
        ) else {
            continue;
        };
        nodes_by_group
            .entry(group_id.to_string())
            .or_insert_with(|| node_id.to_string());
    }
    if nodes_by_group.is_empty() {
        return Ok(());
    }

    let mut updated: Vec<(String, Value)> = Vec::new();
    for (key, mut user) in read_values(txn, Table::Users)? {
        if user
            .get("node_id")
            .is_some_and(|node_id| !node_id.is_null())
        {
            continue;
        }
        let Some(group_id) = user.get("group_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(node_id) = nodes_by_group.get(group_id) else {
            continue;
        };
        user["node_id"] = json!(node_id);
        updated.push((key, user));
    }

    if !updated.is_empty() {
        let mut table = txn.open_table(Table::Users.definition())?;
        for (key, value) in updated {
            let bytes = serde_json::to_vec(&value)?;
            table.insert(key.as_str(), bytes.as_slice())?;
        }
    }
    Ok(())
}

pub(crate) fn initialize(db: &Database) -> Result<()> {
    let version = read_version(db)?;
    if let Some(version) = version
        && version > CURRENT_SCHEMA_VERSION
    {
        return Err(StorageError::SchemaTooNew {
            found: version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }
    ensure_tables(db)?;
    match version {
        None => write_version(db, CURRENT_SCHEMA_VERSION),
        Some(version) if version == CURRENT_SCHEMA_VERSION => Ok(()),
        Some(version) => migrate(db, version, CURRENT_SCHEMA_VERSION),
    }
}

pub(crate) fn ensure_tables(db: &Database) -> Result<()> {
    let txn = db.begin_write()?;
    for table in ALL_TABLES {
        txn.open_table(table.definition())?;
    }
    txn.commit()?;
    Ok(())
}

pub(crate) fn read_version(db: &Database) -> Result<Option<u32>> {
    let txn = db.begin_read()?;
    let table = match txn.open_table(Table::Meta.definition()) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    let Some(raw) = table.get(SCHEMA_VERSION_KEY)? else {
        return Ok(None);
    };
    decode_version(raw.value()).map(Some)
}

pub(crate) fn write_version(db: &Database, version: u32) -> Result<()> {
    let txn = db.begin_write()?;
    write_version_txn(&txn, version)?;
    txn.commit()?;
    Ok(())
}

pub(crate) fn write_version_txn(txn: &WriteTransaction, version: u32) -> Result<()> {
    let bytes = serde_json::to_vec(&version)?;
    let mut table = txn.open_table(Table::Meta.definition())?;
    table.insert(SCHEMA_VERSION_KEY, bytes.as_slice())?;
    Ok(())
}

pub(crate) fn migrate(db: &Database, from: u32, to: u32) -> Result<()> {
    migrate_with(db, from, to, MIGRATIONS)
}

pub(crate) fn migrate_with(
    db: &Database,
    from: u32,
    to: u32,
    steps: &[MigrationStep],
) -> Result<()> {
    if to < from {
        return Err(StorageError::InvalidMigration { from, to });
    }
    if from == to {
        return Ok(());
    }

    let mut chain = Vec::new();
    let mut cursor = from;
    while cursor < to {
        let step = steps
            .iter()
            .find(|step| step.from == cursor && step.to > step.from && step.to <= to)
            .copied()
            .ok_or(StorageError::MissingMigration { from: cursor, to })?;
        chain.push(step);
        cursor = step.to;
    }

    let txn = db.begin_write()?;
    for step in chain {
        (step.apply)(&txn)?;
    }
    write_version_txn(&txn, to)?;
    txn.commit()?;
    Ok(())
}

fn decode_version(bytes: &[u8]) -> Result<u32> {
    serde_json::from_slice(bytes).map_err(|err| StorageError::InvalidSchemaVersion(err.to_string()))
}

#[cfg(test)]
mod tests {
    use redb::{Database, ReadableTable, TableDefinition, backends::InMemoryBackend};

    use super::*;

    const LEGACY: TableDefinition<&str, &[u8]> = TableDefinition::new("legacy");

    fn in_memory() -> Database {
        Database::builder()
            .create_with_backend(InMemoryBackend::new())
            .unwrap()
    }

    fn seed_legacy(db: &Database, version: Option<u32>) {
        let txn = db.begin_write().unwrap();
        {
            let mut legacy = txn.open_table(LEGACY).unwrap();
            legacy.insert("greeting", b"hello".as_slice()).unwrap();
        }
        txn.commit().unwrap();
        if let Some(version) = version {
            write_version(db, version).unwrap();
        }
    }

    fn rename_legacy_key(txn: &WriteTransaction) -> Result<()> {
        let value = {
            let legacy = txn.open_table(LEGACY)?;
            legacy
                .get("greeting")?
                .map(|guard| guard.value().to_vec())
                .expect("legacy key must exist")
        };
        {
            let mut meta = txn.open_table(Table::Meta.definition())?;
            meta.insert("greeting", value.as_slice())?;
        }
        txn.delete_table(LEGACY)?;
        Ok(())
    }

    fn failing_migration(txn: &WriteTransaction) -> Result<()> {
        {
            let mut meta = txn.open_table(Table::Meta.definition())?;
            meta.insert("partial", b"partial".as_slice())?;
        }
        Err(StorageError::InvalidSchemaVersion("boom".into()))
    }

    #[test]
    fn fresh_database_gets_current_version() {
        let db = in_memory();
        initialize(&db).unwrap();
        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn opening_existing_current_schema_is_noop() {
        let db = in_memory();
        initialize(&db).unwrap();
        initialize(&db).unwrap();
        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn applies_registered_migration_in_one_transaction() {
        let db = in_memory();
        seed_legacy(&db, Some(0));

        let steps = [MigrationStep {
            from: 0,
            to: 1,
            apply: rename_legacy_key,
        }];
        migrate_with(&db, 0, 1, &steps).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(1));
        let txn = db.begin_read().unwrap();
        let meta = txn.open_table(Table::Meta.definition()).unwrap();
        assert_eq!(
            meta.get("greeting").unwrap().unwrap().value(),
            b"hello".as_slice()
        );
        drop(meta);
        drop(txn);
        let txn = db.begin_read().unwrap();
        assert!(matches!(
            txn.open_table(LEGACY),
            Err(redb::TableError::TableDoesNotExist(_))
        ));
    }

    #[test]
    fn failed_migration_rolls_back_and_keeps_version() {
        let db = in_memory();
        seed_legacy(&db, Some(0));

        let steps = [MigrationStep {
            from: 0,
            to: 1,
            apply: failing_migration,
        }];
        assert!(migrate_with(&db, 0, 1, &steps).is_err());

        assert_eq!(read_version(&db).unwrap(), Some(0));
        let txn = db.begin_read().unwrap();
        let meta = txn.open_table(Table::Meta.definition()).unwrap();
        assert!(meta.get("partial").unwrap().is_none());
    }

    #[test]
    fn missing_step_is_reported() {
        let db = in_memory();
        seed_legacy(&db, Some(0));
        let err = migrate_with(&db, 0, 1, &[]).unwrap_err();
        assert!(matches!(
            err,
            StorageError::MissingMigration { from: 0, to: 1 }
        ));
        assert_eq!(read_version(&db).unwrap(), Some(0));
    }

    #[test]
    fn newer_schema_is_rejected() {
        let db = in_memory();
        seed_legacy(&db, Some(CURRENT_SCHEMA_VERSION + 1));
        let err = initialize(&db).unwrap_err();
        assert!(matches!(err, StorageError::SchemaTooNew { .. }));
    }

    #[test]
    fn downgrade_is_rejected() {
        let db = in_memory();
        seed_legacy(&db, Some(1));
        let err = migrate_with(&db, 1, 0, &[]).unwrap_err();
        assert!(matches!(
            err,
            StorageError::InvalidMigration { from: 1, to: 0 }
        ));
    }

    #[test]
    fn corrupt_version_is_reported() {
        let db = in_memory();
        {
            let txn = db.begin_write().unwrap();
            {
                let mut meta = txn.open_table(Table::Meta.definition()).unwrap();
                meta.insert(SCHEMA_VERSION_KEY, b"not-a-number".as_slice())
                    .unwrap();
            }
            txn.commit().unwrap();
        }
        let err = initialize(&db).unwrap_err();
        assert!(matches!(err, StorageError::InvalidSchemaVersion(_)));
    }

    #[test]
    fn migration_v2_creates_billing_tables_and_keeps_data() {
        let db = in_memory();
        seed_legacy(&db, Some(1));
        {
            let txn = db.begin_write().unwrap();
            {
                let mut users = txn.open_table(Table::Users.definition()).unwrap();
                users
                    .insert("user-1", b"{\"login\":\"alice\"}".as_slice())
                    .unwrap();
                let mut tariffs = txn.open_table(Table::Tariffs.definition()).unwrap();
                tariffs
                    .insert("tariff-1", b"{\"name\":\"pro\"}".as_slice())
                    .unwrap();
            }
            txn.commit().unwrap();
        }

        migrate(&db, 1, 2).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(2));
        let txn = db.begin_read().unwrap();
        for table in BILLING_TABLES {
            assert!(txn.open_table(table.definition()).is_ok());
        }
        {
            let users = txn.open_table(Table::Users.definition()).unwrap();
            assert_eq!(
                users.get("user-1").unwrap().unwrap().value(),
                b"{\"login\":\"alice\"}".as_slice()
            );
        }
        {
            let tariffs = txn.open_table(Table::Tariffs.definition()).unwrap();
            assert_eq!(
                tariffs.get("tariff-1").unwrap().unwrap().value(),
                b"{\"name\":\"pro\"}".as_slice()
            );
        }
        {
            let meta = txn.open_table(Table::Meta.definition()).unwrap();
            assert_eq!(
                meta.get(SCHEMA_VERSION_KEY).unwrap().unwrap().value(),
                b"2".as_slice()
            );
        }
    }

    #[test]
    fn migration_v3_creates_rate_limits_and_keeps_data() {
        let db = in_memory();
        seed_legacy(&db, Some(2));
        {
            let txn = db.begin_write().unwrap();
            {
                let mut users = txn.open_table(Table::Users.definition()).unwrap();
                users
                    .insert("user-1", b"{\"login\":\"alice\"}".as_slice())
                    .unwrap();
                let mut plans = txn.open_table(Table::BillingPlans.definition()).unwrap();
                plans
                    .insert("plan-1", b"{\"name\":\"basic\"}".as_slice())
                    .unwrap();
            }
            txn.commit().unwrap();
        }

        migrate(&db, 2, CURRENT_SCHEMA_VERSION).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
        let txn = db.begin_read().unwrap();
        for table in RATE_LIMIT_TABLES {
            assert!(txn.open_table(table.definition()).is_ok());
        }
        {
            let users = txn.open_table(Table::Users.definition()).unwrap();
            assert_eq!(
                users.get("user-1").unwrap().unwrap().value(),
                b"{\"login\":\"alice\"}".as_slice()
            );
        }
        {
            let plans = txn.open_table(Table::BillingPlans.definition()).unwrap();
            assert_eq!(
                plans.get("plan-1").unwrap().unwrap().value(),
                b"{\"name\":\"basic\"}".as_slice()
            );
        }
        {
            let meta = txn.open_table(Table::Meta.definition()).unwrap();
            assert_eq!(
                meta.get(SCHEMA_VERSION_KEY).unwrap().unwrap().value(),
                b"5".as_slice()
            );
        }
    }

    #[test]
    fn migration_v4_binds_devices_to_a_single_interface() {
        let db = in_memory();
        seed_legacy(&db, Some(3));
        let txn = db.begin_write().unwrap();
        {
            let mut interfaces = txn.open_table(Table::Interfaces.definition()).unwrap();
            interfaces
                .insert(
                    "iface-1",
                    br#"{"id":"11111111-1111-1111-1111-111111111111","group_id":"group-1","enabled":false}"#.as_slice(),
                )
                .unwrap();
            interfaces
                .insert(
                    "iface-2",
                    br#"{"id":"22222222-2222-2222-2222-222222222222","group_id":"group-1","enabled":true}"#.as_slice(),
                )
                .unwrap();
            let mut devices = txn.open_table(Table::Devices.definition()).unwrap();
            for key in ["device-1", "device-2", "device-3"] {
                devices
                    .insert(
                        key,
                        format!(r#"{{"id":"{key}","group_id":"group-1","name":"{key}"}}"#)
                            .as_bytes(),
                    )
                    .unwrap();
            }
            let mut peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
            for (key, interface_id) in [
                ("device-1:iface-1", "11111111-1111-1111-1111-111111111111"),
                ("device-1:iface-2", "22222222-2222-2222-2222-222222222222"),
                ("device-2:iface-1", "11111111-1111-1111-1111-111111111111"),
            ] {
                peers
                    .insert(
                        key,
                        format!(
                            r#"{{"device_id":"{}","interface_id":"{interface_id}","public_key":"key-{key}","private_key_sealed":"private","preshared_key_sealed":"psk","ips":{{}},"client_obf":{{}},"created_at":"2026-01-01T00:00:00Z"}}"#,
                            key.split(':').next().unwrap()
                        )
                        .as_bytes(),
                    )
                    .unwrap();
            }
        }
        txn.commit().unwrap();

        migrate(&db, 3, 4).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(4));
        let txn = db.begin_read().unwrap();
        {
            let devices = txn.open_table(Table::Devices.definition()).unwrap();
            for key in ["device-1", "device-2", "device-3"] {
                let raw = devices.get(key).unwrap().unwrap();
                let value: Value = serde_json::from_slice(raw.value()).unwrap();
                assert_eq!(
                    value["interface_id"],
                    json!("22222222-2222-2222-2222-222222222222")
                );
            }
        }
        {
            let peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
            let keys: Vec<String> = peers
                .iter()
                .unwrap()
                .map(|entry| entry.unwrap().0.value().to_string())
                .collect();
            assert_eq!(
                keys,
                vec![
                    "device-1:22222222-2222-2222-2222-222222222222".to_string(),
                    "device-2:22222222-2222-2222-2222-222222222222".to_string()
                ]
            );
            let moved = peers
                .get("device-2:22222222-2222-2222-2222-222222222222")
                .unwrap()
                .unwrap();
            let value: Value = serde_json::from_slice(moved.value()).unwrap();
            assert_eq!(value["public_key"], "key-device-2:iface-1");
            assert_eq!(value["private_key_sealed"], "private");
            assert_eq!(value["preshared_key_sealed"], "psk");
            assert_eq!(
                value["interface_id"],
                json!("22222222-2222-2222-2222-222222222222")
            );
        }
    }

    #[test]
    fn migration_v4_falls_back_to_the_first_interface_of_the_group() {
        let db = in_memory();
        seed_legacy(&db, Some(3));
        let txn = db.begin_write().unwrap();
        {
            let mut interfaces = txn.open_table(Table::Interfaces.definition()).unwrap();
            interfaces
                .insert(
                    "iface-1",
                    br#"{"id":"11111111-1111-1111-1111-111111111111","group_id":"group-1","enabled":false}"#.as_slice(),
                )
                .unwrap();
            let mut devices = txn.open_table(Table::Devices.definition()).unwrap();
            devices
                .insert(
                    "device-1",
                    br#"{"id":"device-1","group_id":"group-1","name":"phone"}"#.as_slice(),
                )
                .unwrap();
        }
        txn.commit().unwrap();

        migrate(&db, 3, 4).unwrap();

        let txn = db.begin_read().unwrap();
        let devices = txn.open_table(Table::Devices.definition()).unwrap();
        let raw = devices.get("device-1").unwrap().unwrap();
        let value: Value = serde_json::from_slice(raw.value()).unwrap();
        assert_eq!(
            value["interface_id"],
            json!("11111111-1111-1111-1111-111111111111")
        );
        drop(devices);
        drop(txn);
    }

    #[test]
    fn migration_v4_keeps_devices_without_group_interfaces() {
        let db = in_memory();
        seed_legacy(&db, Some(3));
        let txn = db.begin_write().unwrap();
        {
            let mut devices = txn.open_table(Table::Devices.definition()).unwrap();
            devices
                .insert(
                    "device-1",
                    br#"{"id":"device-1","group_id":"group-1","name":"phone"}"#.as_slice(),
                )
                .unwrap();
        }
        txn.commit().unwrap();

        migrate(&db, 3, 4).unwrap();

        let txn = db.begin_read().unwrap();
        let devices = txn.open_table(Table::Devices.definition()).unwrap();
        let raw = devices.get("device-1").unwrap().unwrap();
        let value: Value = serde_json::from_slice(raw.value()).unwrap();
        assert!(value.get("interface_id").is_none());
    }

    #[test]
    fn migration_v5_binds_users_to_the_node_of_the_first_group_interface() {
        let db = in_memory();
        seed_legacy(&db, Some(4));
        let txn = db.begin_write().unwrap();
        {
            let mut interfaces = txn.open_table(Table::Interfaces.definition()).unwrap();
            for (key, group_id, node_id) in [
                ("iface-1", "group-1", "node-1"),
                ("iface-2", "group-1", "node-2"),
                ("iface-3", "group-2", "node-3"),
            ] {
                interfaces
                    .insert(
                        key,
                        format!(
                            r#"{{"id":"{key}","group_id":"{group_id}","node_id":"{node_id}","enabled":true}}"#
                        )
                        .as_bytes(),
                    )
                    .unwrap();
            }
            let mut users = txn.open_table(Table::Users.definition()).unwrap();
            for (key, group_id, node_id) in [
                ("user-1", "group-1", None),
                ("user-2", "group-2", None),
                ("user-3", "", None),
                ("user-4", "group-1", Some("node-9")),
            ] {
                let group = if group_id.is_empty() {
                    "null".to_string()
                } else {
                    format!("\"{group_id}\"")
                };
                let node = match node_id {
                    Some(node_id) => format!("\"{node_id}\""),
                    None => "null".to_string(),
                };
                users
                    .insert(
                        key,
                        format!(
                            r#"{{"id":"{key}","login":"{key}","group_id":{group},"node_id":{node}}}"#
                        )
                        .as_bytes(),
                    )
                    .unwrap();
            }
        }
        txn.commit().unwrap();

        migrate(&db, 4, 5).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(5));
        let txn = db.begin_read().unwrap();
        let users = txn.open_table(Table::Users.definition()).unwrap();
        let node_of = |key: &str| {
            let raw = users.get(key).unwrap().unwrap();
            let value: Value = serde_json::from_slice(raw.value()).unwrap();
            value
                .get("node_id")
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        assert_eq!(node_of("user-1"), Some("node-1".to_string()));
        assert_eq!(node_of("user-2"), Some("node-3".to_string()));
        assert_eq!(node_of("user-3"), None);
        assert_eq!(node_of("user-4"), Some("node-9".to_string()));
        drop(users);
        drop(txn);

        let txn = db.begin_write().unwrap();
        v5_user_nodes(&txn).unwrap();
        txn.commit().unwrap();
    }

    #[test]
    fn migration_v5_leaves_users_without_group_interfaces() {
        let db = in_memory();
        seed_legacy(&db, Some(4));
        let txn = db.begin_write().unwrap();
        {
            let mut users = txn.open_table(Table::Users.definition()).unwrap();
            users
                .insert(
                    "user-1",
                    br#"{"id":"user-1","login":"alice","group_id":"group-1"}"#.as_slice(),
                )
                .unwrap();
        }
        txn.commit().unwrap();

        migrate(&db, 4, 5).unwrap();

        let txn = db.begin_read().unwrap();
        let users = txn.open_table(Table::Users.definition()).unwrap();
        let raw = users.get("user-1").unwrap().unwrap();
        let value: Value = serde_json::from_slice(raw.value()).unwrap();
        assert_eq!(value.get("node_id"), None);
    }

    #[test]
    fn migration_v3_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(2));

        migrate(&db, 2, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 2, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION).unwrap();

        let txn = db.begin_write().unwrap();
        v3_rate_limits(&txn).unwrap();
        v3_rate_limits(&txn).unwrap();
        txn.commit().unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn migration_v2_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(1));

        migrate(&db, 1, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 1, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION).unwrap();

        let txn = db.begin_write().unwrap();
        v2_billing(&txn).unwrap();
        v2_billing(&txn).unwrap();
        v3_rate_limits(&txn).unwrap();
        v3_rate_limits(&txn).unwrap();
        txn.commit().unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn initialize_migrates_v1_store_without_touching_data() {
        let db = in_memory();
        seed_legacy(&db, Some(1));
        {
            let txn = db.begin_write().unwrap();
            {
                let mut legacy = txn.open_table(LEGACY).unwrap();
                legacy.insert("second", b"world".as_slice()).unwrap();
            }
            txn.commit().unwrap();
        }

        initialize(&db).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
        let txn = db.begin_read().unwrap();
        let legacy = txn.open_table(LEGACY).unwrap();
        assert_eq!(
            legacy.get("greeting").unwrap().unwrap().value(),
            b"hello".as_slice()
        );
        assert_eq!(
            legacy.get("second").unwrap().unwrap().value(),
            b"world".as_slice()
        );
        drop(legacy);
        for table in BILLING_TABLES {
            assert!(txn.open_table(table.definition()).is_ok());
        }
        for table in RATE_LIMIT_TABLES {
            assert!(txn.open_table(table.definition()).is_ok());
        }
    }
}
