use redb::{Database, ReadableDatabase, ReadableTable, WriteTransaction};
use serde_json::{Value, json};

use awg_shared::crypto::{Sealer, sha256_hex};

use crate::{ALL_TABLES, Result, StorageError, Table};

pub const CURRENT_SCHEMA_VERSION: u32 = 12;
pub const SCHEMA_VERSION_KEY: &str = "schema_version";
const NIL_UUID: &str = "00000000-0000-0000-0000-000000000000";

pub type MigrationFn = fn(&WriteTransaction, Option<&Sealer>) -> Result<()>;

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
    MigrationStep {
        from: 5,
        to: 6,
        apply: v6_user_emails,
    },
    MigrationStep {
        from: 6,
        to: 7,
        apply: v7_idempotency,
    },
    MigrationStep {
        from: 7,
        to: 8,
        apply: v8_peer_ids,
    },
    MigrationStep {
        from: 8,
        to: 9,
        apply: v9_device_page_index,
    },
    MigrationStep {
        from: 9,
        to: 10,
        apply: v10_user_page_index,
    },
    MigrationStep {
        from: 10,
        to: 11,
        apply: v11_share_token_hash,
    },
    MigrationStep {
        from: 11,
        to: 12,
        apply: v12_user_search_index,
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

const IDEMPOTENCY_TABLES: &[Table] = &[Table::Idempotency];

fn v2_billing(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    for table in BILLING_TABLES {
        txn.open_table(table.definition())?;
    }
    Ok(())
}

fn v3_rate_limits(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    for table in RATE_LIMIT_TABLES {
        txn.open_table(table.definition())?;
    }
    Ok(())
}

fn v7_idempotency(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    for table in IDEMPOTENCY_TABLES {
        txn.open_table(table.definition())?;
    }
    Ok(())
}

fn v8_peer_ids(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    let mut interface_names: std::collections::BTreeMap<String, String> =
        std::collections::BTreeMap::new();
    for (_, interface) in read_values(txn, Table::Interfaces)? {
        let (Some(id), Some(name)) = (
            interface.get("id").and_then(Value::as_str),
            interface.get("name").and_then(Value::as_str),
        ) else {
            continue;
        };
        interface_names.insert(id.to_string(), name.to_string());
    }

    let mut writes: Vec<(String, Value)> = Vec::new();
    let mut removals: Vec<String> = Vec::new();

    for (key, mut peer) in read_values(txn, Table::DevicePeers)? {
        let parts: Vec<&str> = key.split(':').collect();
        let device_id = peer
            .get("device_id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| parts.first().map(|part| part.to_string()));
        let interface_id = peer
            .get("interface_id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| parts.get(1).map(|part| part.to_string()));
        let (Some(device_id), Some(interface_id)) = (device_id, interface_id) else {
            continue;
        };
        if uuid::Uuid::parse_str(&device_id).is_err()
            || uuid::Uuid::parse_str(&interface_id).is_err()
        {
            continue;
        }

        let existing = peer
            .get("id")
            .and_then(Value::as_str)
            .and_then(|raw| uuid::Uuid::parse_str(raw).ok())
            .filter(|id| !id.is_nil())
            .or_else(|| {
                parts
                    .get(2)
                    .and_then(|raw| uuid::Uuid::parse_str(raw).ok())
                    .filter(|id| !id.is_nil())
            });
        let peer_id = existing.unwrap_or_else(uuid::Uuid::new_v4);
        let label = peer
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(str::to_string)
            .or_else(|| interface_names.get(&interface_id).cloned())
            .unwrap_or_else(|| "default".to_string());

        let target = format!("{device_id}:{interface_id}:{peer_id}");
        let current_id = peer
            .get("id")
            .and_then(Value::as_str)
            .and_then(|raw| uuid::Uuid::parse_str(raw).ok());
        let is_current = key == target
            && current_id == Some(peer_id)
            && peer.get("label").and_then(Value::as_str) == Some(label.as_str())
            && peer.get("device_id").and_then(Value::as_str) == Some(device_id.as_str())
            && peer.get("interface_id").and_then(Value::as_str) == Some(interface_id.as_str());
        if is_current {
            continue;
        }

        peer["id"] = json!(peer_id);
        peer["device_id"] = json!(device_id);
        peer["interface_id"] = json!(interface_id);
        peer["label"] = json!(label);
        writes.push((target.clone(), peer));
        if key != target {
            removals.push(key);
        }
    }

    if !writes.is_empty() || !removals.is_empty() {
        let mut table = txn.open_table(Table::DevicePeers.definition())?;
        for (key, value) in writes {
            let bytes = serde_json::to_vec(&value)?;
            table.insert(key.as_str(), bytes.as_slice())?;
        }
        for key in removals {
            table.remove(key.as_str())?;
        }
    }
    Ok(())
}

fn v9_device_page_index(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    crate::device_index::backfill(txn)
}

fn v10_user_page_index(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    crate::user_index::backfill(txn)
}

fn v12_user_search_index(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    crate::user_search::backfill(txn)
}

fn v11_share_token_hash(txn: &WriteTransaction, sealer: Option<&Sealer>) -> Result<()> {
    let existing = read_values(txn, Table::ShareLinks)?;
    if existing.is_empty() {
        return Ok(());
    }
    let mut writes: Vec<(String, Value)> = Vec::with_capacity(existing.len());
    let mut removals: Vec<String> = Vec::new();
    for (key, mut link) in existing {
        let Some(plaintext) = link
            .get("token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_string)
        else {
            continue;
        };
        let sealed = match sealer {
            Some(sealer) => sealer
                .seal_str(&plaintext)
                .map_err(|error| StorageError::Secret(error.to_string()))?,
            None => {
                return Err(StorageError::Secret(
                    "migrating share links requires the master key".into(),
                ));
            }
        };
        let hash = sha256_hex(plaintext.as_bytes());
        if let Some(object) = link.as_object_mut() {
            object.remove("token");
        }
        link["token_hash"] = json!(hash);
        link["token_sealed"] = json!(sealed);
        if key != hash {
            removals.push(key);
        }
        writes.push((hash, link));
    }
    if writes.is_empty() && removals.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::ShareLinks.definition())?;
    for key in removals {
        table.remove(key.as_str())?;
    }
    for (key, value) in writes {
        let bytes = serde_json::to_vec(&value)?;
        table.insert(key.as_str(), bytes.as_slice())?;
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

fn v4_device_interfaces(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
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

fn v5_user_nodes(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
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

fn v6_user_emails(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
    let mut used: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for (_, user) in read_values(txn, Table::Users)? {
        if let Some(email) = user_email(&user) {
            used.insert(email.to_ascii_lowercase());
        }
    }

    let mut updated: Vec<(String, Value)> = Vec::new();
    for (key, mut user) in read_values(txn, Table::Users)? {
        if user_email(&user).is_some() {
            continue;
        }
        let login = user
            .get("login")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let id = user
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(key.as_str());
        let local = sanitize_email_local(login);
        let mut candidate = format!("{local}@local");
        let mut attempt = 0;
        while used.contains(&candidate) {
            attempt += 1;
            let suffix = match attempt {
                1 => sanitize_email_local(id),
                other => format!("{}-{other}", sanitize_email_local(id)),
            };
            let suffix = if suffix.is_empty() {
                attempt.to_string()
            } else {
                suffix
            };
            candidate = format!("{local}+{suffix}@local");
        }
        used.insert(candidate.clone());
        user["email"] = json!(candidate);
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

fn user_email(user: &Value) -> Option<&str> {
    user.get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| !email.is_empty())
}

fn sanitize_email_local(raw: &str) -> String {
    let mut sanitized: String = raw
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect();
    sanitized.truncate(64);
    sanitized.trim_matches(['-', '.']).to_string()
}

#[cfg(test)]
pub(crate) fn initialize(db: &Database) -> Result<()> {
    initialize_with(db, None)
}

pub(crate) fn initialize_with(db: &Database, sealer: Option<&Sealer>) -> Result<()> {
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
        Some(version) => migrate_with(db, version, CURRENT_SCHEMA_VERSION, MIGRATIONS, sealer),
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

#[cfg(test)]
pub(crate) fn migrate(db: &Database, from: u32, to: u32) -> Result<()> {
    migrate_with(db, from, to, MIGRATIONS, None)
}

pub(crate) fn migrate_with(
    db: &Database,
    from: u32,
    to: u32,
    steps: &[MigrationStep],
    sealer: Option<&Sealer>,
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
        (step.apply)(&txn, sealer)?;
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

    fn rename_legacy_key(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
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

    fn failing_migration(txn: &WriteTransaction, _sealer: Option<&Sealer>) -> Result<()> {
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
        migrate_with(&db, 0, 1, &steps, None).unwrap();

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
        assert!(migrate_with(&db, 0, 1, &steps, None).is_err());

        assert_eq!(read_version(&db).unwrap(), Some(0));
        let txn = db.begin_read().unwrap();
        let meta = txn.open_table(Table::Meta.definition()).unwrap();
        assert!(meta.get("partial").unwrap().is_none());
    }

    #[test]
    fn missing_step_is_reported() {
        let db = in_memory();
        seed_legacy(&db, Some(0));
        let err = migrate_with(&db, 0, 1, &[], None).unwrap_err();
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
        let err = migrate_with(&db, 1, 0, &[], None).unwrap_err();
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
            let raw = users.get("user-1").unwrap().unwrap();
            let value: Value = serde_json::from_slice(raw.value()).unwrap();
            assert_eq!(value["login"], json!("alice"));
            assert_eq!(value["email"], json!("alice@local"));
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
                CURRENT_SCHEMA_VERSION.to_string().as_bytes()
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
        v5_user_nodes(&txn, None).unwrap();
        txn.commit().unwrap();
    }

    #[test]
    fn migration_v6_fills_missing_user_emails() {
        let db = in_memory();
        seed_legacy(&db, Some(5));
        let txn = db.begin_write().unwrap();
        {
            let mut users = txn.open_table(Table::Users.definition()).unwrap();
            for (key, value) in [
                (
                    "admin",
                    r#"{"id":"11111111-1111-1111-1111-111111111111","login":"Admin"}"#,
                ),
                (
                    "user-1",
                    r#"{"id":"22222222-2222-2222-2222-222222222222","login":"alice","email":"Alice@Example.COM"}"#,
                ),
                (
                    "user-2",
                    r#"{"id":"33333333-3333-3333-3333-333333333333","login":"Admin"}"#,
                ),
                (
                    "user-3",
                    r#"{"id":"44444444-4444-4444-4444-444444444444","login":"Bad Login!","email":null}"#,
                ),
            ] {
                users.insert(key, value.as_bytes()).unwrap();
            }
        }
        txn.commit().unwrap();

        migrate(&db, 5, 6).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(6));
        let txn = db.begin_read().unwrap();
        let users = txn.open_table(Table::Users.definition()).unwrap();
        let email_of = |key: &str| {
            let raw = users.get(key).unwrap().unwrap();
            let value: Value = serde_json::from_slice(raw.value()).unwrap();
            value
                .get("email")
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        assert_eq!(email_of("admin"), Some("admin@local".to_string()));
        assert_eq!(
            email_of("user-1"),
            Some("Alice@Example.COM".to_string()),
            "existing emails are preserved as-is"
        );
        assert_eq!(
            email_of("user-2"),
            Some("admin+33333333-3333-3333-3333-333333333333@local".to_string())
        );
        assert_eq!(email_of("user-3"), Some("bad-login@local".to_string()));
        drop(users);
        drop(txn);

        let txn = db.begin_write().unwrap();
        v6_user_emails(&txn, None).unwrap();
        txn.commit().unwrap();

        let txn = db.begin_read().unwrap();
        let users = txn.open_table(Table::Users.definition()).unwrap();
        let raw = users.get("admin").unwrap().unwrap();
        let value: Value = serde_json::from_slice(raw.value()).unwrap();
        assert_eq!(value["email"], json!("admin@local"));
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
    fn migration_v7_creates_idempotency_table_and_keeps_data() {
        let db = in_memory();
        seed_legacy(&db, Some(6));
        {
            let txn = db.begin_write().unwrap();
            {
                let mut users = txn.open_table(Table::Users.definition()).unwrap();
                users
                    .insert("user-1", b"{\"login\":\"alice\"}".as_slice())
                    .unwrap();
            }
            txn.commit().unwrap();
        }

        migrate(&db, 6, 7).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(7));
        let txn = db.begin_read().unwrap();
        for table in IDEMPOTENCY_TABLES {
            assert!(txn.open_table(table.definition()).is_ok());
        }
        let users = txn.open_table(Table::Users.definition()).unwrap();
        assert_eq!(
            users.get("user-1").unwrap().unwrap().value(),
            b"{\"login\":\"alice\"}".as_slice()
        );
    }

    #[test]
    fn migration_v7_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(6));

        migrate(&db, 6, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 6, CURRENT_SCHEMA_VERSION).unwrap();

        let txn = db.begin_write().unwrap();
        v7_idempotency(&txn, None).unwrap();
        v7_idempotency(&txn, None).unwrap();
        txn.commit().unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn migration_v3_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(2));

        migrate(&db, 2, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 2, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION).unwrap();

        let txn = db.begin_write().unwrap();
        v3_rate_limits(&txn, None).unwrap();
        v3_rate_limits(&txn, None).unwrap();
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
        v2_billing(&txn, None).unwrap();
        v2_billing(&txn, None).unwrap();
        v3_rate_limits(&txn, None).unwrap();
        v3_rate_limits(&txn, None).unwrap();
        txn.commit().unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn migration_v8_assigns_peer_ids_and_labels() {
        let db = in_memory();
        seed_legacy(&db, Some(7));
        let device = uuid::Uuid::new_v4();
        let interface = uuid::Uuid::new_v4();
        {
            let txn = db.begin_write().unwrap();
            {
                let mut interfaces = txn.open_table(Table::Interfaces.definition()).unwrap();
                interfaces
                    .insert(
                        interface.to_string().as_str(),
                        json!({"id": interface, "name": "awg0"})
                            .to_string()
                            .as_bytes(),
                    )
                    .unwrap();
            }
            {
                let mut peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
                peers
                    .insert(
                        format!("{device}:{interface}").as_str(),
                        json!({
                            "device_id": device,
                            "interface_id": interface,
                            "public_key": "legacy-key",
                            "private_key_sealed": "",
                            "preshared_key_sealed": "",
                            "ips": {},
                            "client_obf": {
                                "jc": 0, "jmin": 0, "jmax": 0,
                                "i1": "", "i2": "", "i3": "", "i4": "", "i5": "",
                                "disable_cookies": false,
                                "keepalive_low": 10, "keepalive_high": 50
                            },
                            "created_at": "2026-01-01T00:00:00Z"
                        })
                        .to_string()
                        .as_bytes(),
                    )
                    .unwrap();
            }
            txn.commit().unwrap();
        }

        migrate(&db, 7, 8).unwrap();

        let txn = db.begin_read().unwrap();
        let peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
        let entries: Vec<_> = peers.iter().unwrap().map(|entry| entry.unwrap()).collect();
        assert_eq!(entries.len(), 1);
        let (key, value) = &entries[0];
        let value: Value = serde_json::from_slice(value.value()).unwrap();
        let id = value["id"].as_str().expect("peer id is assigned");
        uuid::Uuid::parse_str(id).unwrap();
        assert_eq!(value["label"], "awg0");
        assert_eq!(value["public_key"], "legacy-key");
        assert_eq!(key.value(), format!("{device}:{interface}:{id}").as_str());
    }

    #[test]
    fn migration_v8_defaults_label_without_interface() {
        let db = in_memory();
        seed_legacy(&db, Some(7));
        let device = uuid::Uuid::new_v4();
        let interface = uuid::Uuid::new_v4();
        {
            let txn = db.begin_write().unwrap();
            {
                let mut peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
                peers
                    .insert(
                        format!("{device}:{interface}").as_str(),
                        json!({
                            "device_id": device,
                            "interface_id": interface,
                            "public_key": "orphan-key"
                        })
                        .to_string()
                        .as_bytes(),
                    )
                    .unwrap();
            }
            txn.commit().unwrap();
        }

        migrate(&db, 7, 8).unwrap();

        let txn = db.begin_read().unwrap();
        let peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
        let entry = peers.iter().unwrap().next().unwrap().unwrap();
        let value: Value = serde_json::from_slice(entry.1.value()).unwrap();
        assert_eq!(value["label"], "default");
        assert!(value["id"].as_str().is_some());
    }

    #[test]
    fn migration_v8_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(7));
        let device = uuid::Uuid::new_v4();
        let interface = uuid::Uuid::new_v4();
        {
            let txn = db.begin_write().unwrap();
            {
                let mut peers = txn.open_table(Table::DevicePeers.definition()).unwrap();
                peers
                    .insert(
                        format!("{device}:{interface}").as_str(),
                        json!({
                            "device_id": device,
                            "interface_id": interface,
                            "public_key": "legacy-key"
                        })
                        .to_string()
                        .as_bytes(),
                    )
                    .unwrap();
            }
            txn.commit().unwrap();
        }

        migrate(&db, 7, 8).unwrap();
        let first: Vec<(String, Value)> = {
            let txn = db.begin_read().unwrap();
            let table = txn.open_table(Table::DevicePeers.definition()).unwrap();
            table
                .iter()
                .unwrap()
                .map(|entry| {
                    let (key, value) = entry.unwrap();
                    (
                        key.value().to_string(),
                        serde_json::from_slice(value.value()).unwrap(),
                    )
                })
                .collect()
        };

        let txn = db.begin_write().unwrap();
        v8_peer_ids(&txn, None).unwrap();
        txn.commit().unwrap();

        let txn = db.begin_read().unwrap();
        let table = txn.open_table(Table::DevicePeers.definition()).unwrap();
        let second: Vec<(String, Value)> = table
            .iter()
            .unwrap()
            .map(|entry| {
                let (key, value) = entry.unwrap();
                (
                    key.value().to_string(),
                    serde_json::from_slice(value.value()).unwrap(),
                )
            })
            .collect();
        assert_eq!(first, second);
        assert_eq!(read_version(&db).unwrap(), Some(8));
    }

    #[test]
    fn migration_v9_backfills_device_page_index() {
        let db = in_memory();
        seed_legacy(&db, Some(8));
        let user = uuid::Uuid::new_v4();
        let group = uuid::Uuid::new_v4();
        let interface = uuid::Uuid::new_v4();
        let first = uuid::Uuid::new_v4();
        let second = uuid::Uuid::new_v4();
        {
            let txn = db.begin_write().unwrap();
            let mut devices = txn.open_table(Table::Devices.definition()).unwrap();
            for (id, name, created) in [
                (first, "Phone", "2026-01-01T00:00:00Z"),
                (second, "Laptop", "2026-01-02T00:00:00Z"),
            ] {
                devices
                    .insert(
                        id.to_string().as_str(),
                        json!({
                            "id": id,
                            "user_id": user,
                            "group_id": group,
                            "interface_id": interface,
                            "name": name,
                            "revoked": false,
                            "created_at": created,
                        })
                        .to_string()
                        .as_bytes(),
                    )
                    .unwrap();
            }
            drop(devices);
            txn.commit().unwrap();
        }

        migrate(&db, 8, 9).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(9));
        let txn = db.begin_read().unwrap();
        let names = txn.open_table(Table::DevicePageIndex.definition()).unwrap();
        let keys: Vec<String> = names
            .iter()
            .unwrap()
            .map(|entry| entry.unwrap().0.value().to_string())
            .collect();
        assert_eq!(
            keys,
            vec![format!("laptop|{second}"), format!("phone|{first}"),]
        );
        let created = txn
            .open_table(Table::DeviceCreatedIndex.definition())
            .unwrap();
        let created_keys: Vec<String> = created
            .iter()
            .unwrap()
            .map(|entry| entry.unwrap().0.value().to_string())
            .collect();
        assert_eq!(created_keys.len(), 2);
        assert!(created_keys[0].ends_with(&first.to_string()));
        assert!(created_keys[1].ends_with(&second.to_string()));
        drop(created);
        {
            let devices = txn.open_table(Table::Devices.definition()).unwrap();
            assert_eq!(devices.iter().unwrap().count(), 2);
            let raw = devices.get(first.to_string().as_str()).unwrap().unwrap();
            let value: Value = serde_json::from_slice(raw.value()).unwrap();
            assert_eq!(value["name"], json!("Phone"));
        }
        drop(names);
        drop(txn);

        let txn = db.begin_write().unwrap();
        v9_device_page_index(&txn, None).unwrap();
        v9_device_page_index(&txn, None).unwrap();
        txn.commit().unwrap();

        let txn = db.begin_read().unwrap();
        let names = txn.open_table(Table::DevicePageIndex.definition()).unwrap();
        assert_eq!(names.iter().unwrap().count(), 2);
    }

    #[test]
    fn migration_v9_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(8));
        migrate(&db, 8, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 8, CURRENT_SCHEMA_VERSION).unwrap();

        let txn = db.begin_write().unwrap();
        v9_device_page_index(&txn, None).unwrap();
        v9_device_page_index(&txn, None).unwrap();
        txn.commit().unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));
    }

    #[test]
    fn migration_v10_backfills_user_page_index() {
        let db = in_memory();
        seed_legacy(&db, Some(9));
        let first = uuid::Uuid::new_v4();
        let second = uuid::Uuid::new_v4();
        let third = uuid::Uuid::new_v4();
        {
            let txn = db.begin_write().unwrap();
            let mut users = txn.open_table(Table::Users.definition()).unwrap();
            for (id, login, email, role, status, disabled) in [
                (
                    first,
                    "alice",
                    Some("Alice@Example.COM"),
                    "user",
                    "active",
                    false,
                ),
                (second, "bob", None, "admin", "pending_approval", true),
                (
                    third,
                    "carol",
                    Some("carol@example.com"),
                    "user",
                    "active",
                    false,
                ),
            ] {
                users
                    .insert(
                        id.to_string().as_str(),
                        json!({
                            "id": id,
                            "login": login,
                            "email": email,
                            "role": role,
                            "status": status,
                            "disabled": disabled,
                            "created_at": "2026-01-01T00:00:00Z",
                        })
                        .to_string()
                        .as_bytes(),
                    )
                    .unwrap();
            }
            drop(users);
            txn.commit().unwrap();
        }

        migrate(&db, 9, 10).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(10));
        let txn = db.begin_read().unwrap();
        let index = txn.open_table(Table::UserPageIndex.definition()).unwrap();
        let keys: Vec<String> = index
            .iter()
            .unwrap()
            .map(|entry| entry.unwrap().0.value().to_string())
            .collect();
        assert_eq!(
            keys,
            vec![
                format!("alice@example.com|{first}"),
                format!("bob|{second}"),
                format!("carol@example.com|{third}"),
            ]
        );
        let raw = index
            .get(format!("bob|{second}").as_str())
            .unwrap()
            .unwrap();
        let value: Value = serde_json::from_slice(raw.value()).unwrap();
        assert_eq!(value["role"], json!("admin"));
        assert_eq!(value["status"], json!("pending_approval"));
        assert_eq!(value["disabled"], json!(true));
        drop(raw);
        drop(index);
        drop(txn);

        let txn = db.begin_write().unwrap();
        v10_user_page_index(&txn, None).unwrap();
        v10_user_page_index(&txn, None).unwrap();
        txn.commit().unwrap();

        let txn = db.begin_read().unwrap();
        let index = txn.open_table(Table::UserPageIndex.definition()).unwrap();
        assert_eq!(index.iter().unwrap().count(), 3);
    }

    #[test]
    fn migration_v11_hashes_and_seals_share_tokens() {
        let db = in_memory();
        seed_legacy(&db, Some(10));
        let sealer = sealer();
        {
            let txn = db.begin_write().unwrap();
            let mut links = txn.open_table(Table::ShareLinks.definition()).unwrap();
            links
                .insert(
                    "legacy-token",
                    json!({
                        "token": "legacy-token",
                        "device_id": uuid::Uuid::new_v4(),
                        "interface_id": uuid::Uuid::new_v4(),
                        "created_by": uuid::Uuid::new_v4(),
                        "format": "conf",
                        "expires_at": "2026-01-01T00:00:00Z",
                        "used_at": null,
                        "created_at": "2026-01-01T00:00:00Z",
                    })
                    .to_string()
                    .as_bytes(),
                )
                .unwrap();
            drop(links);
            txn.commit().unwrap();
        }

        migrate_with(&db, 10, 11, MIGRATIONS, Some(&sealer)).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(11));
        let hash = awg_shared::crypto::sha256_hex(b"legacy-token");
        let txn = db.begin_read().unwrap();
        let links = txn.open_table(Table::ShareLinks.definition()).unwrap();
        let keys: Vec<String> = links
            .iter()
            .unwrap()
            .map(|entry| entry.unwrap().0.value().to_string())
            .collect();
        assert_eq!(keys, vec![hash.clone()]);
        let raw = links.get(hash.as_str()).unwrap().unwrap();
        assert!(
            !raw.value()
                .windows(b"legacy-token".len())
                .any(|window| window == b"legacy-token"),
            "the plaintext token must not survive the migration"
        );
        let value: Value = serde_json::from_slice(raw.value()).unwrap();
        assert!(value.get("token").is_none());
        assert_eq!(value["token_hash"], json!(hash));
        assert_eq!(
            sealer
                .open_str(value["token_sealed"].as_str().unwrap())
                .unwrap(),
            "legacy-token"
        );
        drop(raw);
        drop(links);
        drop(txn);

        let txn = db.begin_write().unwrap();
        v11_share_token_hash(&txn, Some(&sealer)).unwrap();
        v11_share_token_hash(&txn, Some(&sealer)).unwrap();
        txn.commit().unwrap();

        let txn = db.begin_read().unwrap();
        let links = txn.open_table(Table::ShareLinks.definition()).unwrap();
        assert_eq!(links.iter().unwrap().count(), 1);
    }

    #[test]
    fn migration_v11_requires_a_master_key_for_legacy_links() {
        let db = in_memory();
        seed_legacy(&db, Some(10));
        {
            let txn = db.begin_write().unwrap();
            let mut links = txn.open_table(Table::ShareLinks.definition()).unwrap();
            links
                .insert(
                    "legacy-token",
                    json!({ "token": "legacy-token" }).to_string().as_bytes(),
                )
                .unwrap();
            drop(links);
            txn.commit().unwrap();
        }

        let err = migrate_with(&db, 10, 11, MIGRATIONS, None).unwrap_err();
        assert!(matches!(err, StorageError::Secret(_)));
        assert_eq!(read_version(&db).unwrap(), Some(10));
    }

    #[test]
    fn migration_v12_backfills_the_user_search_index() {
        let db = in_memory();
        seed_legacy(&db, Some(11));
        let first = uuid::Uuid::new_v4();
        let second = uuid::Uuid::new_v4();
        {
            let txn = db.begin_write().unwrap();
            let mut users = txn.open_table(Table::Users.definition()).unwrap();
            users
                .insert(
                    first.to_string().as_str(),
                    json!({
                        "id": first,
                        "login": "alice",
                        "email": "Alice@Example.COM",
                        "role": "user",
                        "status": "active",
                        "disabled": false,
                        "created_at": "2026-01-01T00:00:00Z",
                    })
                    .to_string()
                    .as_bytes(),
                )
                .unwrap();
            users
                .insert(
                    second.to_string().as_str(),
                    json!({
                        "id": second,
                        "login": "bob",
                        "role": "admin",
                        "status": "active",
                        "disabled": false,
                        "created_at": "2026-01-02T00:00:00Z",
                    })
                    .to_string()
                    .as_bytes(),
                )
                .unwrap();
            drop(users);
            txn.commit().unwrap();
        }

        migrate(&db, 11, 12).unwrap();

        assert_eq!(read_version(&db).unwrap(), Some(12));
        let first_keys =
            crate::user_search::keys_for_entry(&crate::user_index::UserPageEntry::new(
                first,
                Some("Alice@Example.COM".into()),
                "alice",
                "user",
                "active",
                false,
                chrono::DateTime::UNIX_EPOCH,
            ));
        let second_keys =
            crate::user_search::keys_for_entry(&crate::user_index::UserPageEntry::new(
                second,
                None,
                "bob",
                "admin",
                "active",
                false,
                chrono::DateTime::UNIX_EPOCH,
            ));
        assert!(!first_keys.is_empty());
        assert_eq!(second_keys, vec![format!("bob|{second}")]);

        let expected: std::collections::BTreeSet<String> =
            first_keys.into_iter().chain(second_keys).collect();
        let txn = db.begin_read().unwrap();
        let index = txn.open_table(Table::UserSearchIndex.definition()).unwrap();
        let keys: std::collections::BTreeSet<String> = index
            .iter()
            .unwrap()
            .map(|entry| entry.unwrap().0.value().to_string())
            .collect();
        assert_eq!(keys, expected);
        assert!(keys.contains(format!("ali|{first}").as_str()));
        assert!(keys.contains(format!("com|{first}").as_str()));
        drop(index);
        drop(txn);

        let txn = db.begin_write().unwrap();
        v12_user_search_index(&txn, None).unwrap();
        v12_user_search_index(&txn, None).unwrap();
        txn.commit().unwrap();

        let txn = db.begin_read().unwrap();
        let index = txn.open_table(Table::UserSearchIndex.definition()).unwrap();
        assert_eq!(index.iter().unwrap().count(), expected.len());
    }

    #[test]
    fn migration_v12_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(11));
        migrate(&db, 11, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 11, CURRENT_SCHEMA_VERSION).unwrap();
        assert_eq!(read_version(&db).unwrap(), Some(CURRENT_SCHEMA_VERSION));

        let txn = db.begin_write().unwrap();
        v12_user_search_index(&txn, None).unwrap();
        v12_user_search_index(&txn, None).unwrap();
        txn.commit().unwrap();
    }

    fn sealer() -> Sealer {
        Sealer::from_master_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap()
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
