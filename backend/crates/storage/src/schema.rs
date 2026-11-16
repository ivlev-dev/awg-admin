use redb::{Database, ReadableDatabase, WriteTransaction};

use crate::{ALL_TABLES, Result, StorageError, Table};

pub const CURRENT_SCHEMA_VERSION: u32 = 2;
pub const SCHEMA_VERSION_KEY: &str = "schema_version";

pub type MigrationFn = fn(&WriteTransaction) -> Result<()>;

#[derive(Debug, Clone, Copy)]
pub struct MigrationStep {
    pub from: u32,
    pub to: u32,
    pub apply: MigrationFn,
}

pub const MIGRATIONS: &[MigrationStep] = &[MigrationStep {
    from: 1,
    to: 2,
    apply: v2_billing,
}];

const BILLING_TABLES: &[Table] = &[
    Table::BillingPlans,
    Table::BillingSubscriptions,
    Table::BillingInvoices,
    Table::BillingPaymentMethods,
    Table::BillingEvents,
];

fn v2_billing(txn: &WriteTransaction) -> Result<()> {
    for table in BILLING_TABLES {
        txn.open_table(table.definition())?;
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

        migrate(&db, 1, CURRENT_SCHEMA_VERSION).unwrap();

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
    fn migration_v2_is_idempotent() {
        let db = in_memory();
        seed_legacy(&db, Some(1));

        migrate(&db, 1, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, 1, CURRENT_SCHEMA_VERSION).unwrap();
        migrate(&db, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION).unwrap();

        let txn = db.begin_write().unwrap();
        v2_billing(&txn).unwrap();
        v2_billing(&txn).unwrap();
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
    }
}
