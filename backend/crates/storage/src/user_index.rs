use chrono::{DateTime, Utc};
use redb::{ReadableTable, ReadableTableMetadata};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{Result, Store, Table, WriteTransaction};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserPageEntry {
    pub user_id: Uuid,
    pub email: String,
    #[serde(default)]
    pub full_name: Option<String>,
    pub role: String,
    pub status: String,
    pub disabled: bool,
    #[serde(default = "default_created_at")]
    pub created_at: DateTime<Utc>,
}

impl UserPageEntry {
    pub fn new(
        user_id: Uuid,
        email: String,
        full_name: Option<String>,
        role: &str,
        status: &str,
        disabled: bool,
        created_at: DateTime<Utc>,
    ) -> Self {
        Self {
            user_id,
            email,
            full_name: full_name.filter(|value| !value.trim().is_empty()),
            role: role.to_string(),
            status: status.to_string(),
            disabled,
            created_at,
        }
    }

    pub fn from_json(value: &Value) -> Option<Self> {
        let user_id = value.get("id")?.as_str().and_then(parse_uuid)?;
        let email = value
            .get("email")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|email| !email.is_empty())?
            .to_lowercase();
        let full_name = value
            .get("full_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|full_name| !full_name.is_empty())
            .map(str::to_string);
        let role = value
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user")
            .to_string();
        let status = value
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            .to_string();
        let disabled = value
            .get("disabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let created_at = value
            .get("created_at")
            .and_then(Value::as_str)
            .and_then(parse_datetime)?;
        Some(Self {
            user_id,
            email,
            full_name,
            role,
            status,
            disabled,
            created_at,
        })
    }

    pub fn sort_name(&self) -> String {
        self.email.to_lowercase()
    }

    pub fn index_key(&self) -> String {
        index_key(&self.sort_name(), self.user_id)
    }

    pub fn matches_search(&self, q: &str) -> bool {
        let q = q.to_lowercase();
        self.email.to_lowercase().contains(&q)
            || self
                .full_name
                .as_deref()
                .is_some_and(|full_name| full_name.to_lowercase().contains(&q))
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }
}

fn default_created_at() -> DateTime<Utc> {
    DateTime::<Utc>::UNIX_EPOCH
}

pub fn index_key(sort_name: &str, user_id: Uuid) -> String {
    format!("{}|{}", sort_name.to_lowercase(), user_id)
}

fn email_field(value: &Value) -> Option<&str> {
    value
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| !email.is_empty())
}

/// Synchronizes `user_email_index` for one user write. An unchanged email keeps
/// its row; a changed or removed one loses the old row before the new one is
/// inserted.
fn sync_email_index(
    txn: &WriteTransaction,
    previous: Option<&str>,
    next: Option<&str>,
    user_id: &str,
) -> Result<()> {
    let unchanged = match (previous, next) {
        (Some(previous), Some(next)) => {
            crate::lookup_index::email_key(previous) == crate::lookup_index::email_key(next)
        }
        _ => false,
    };
    if let Some(previous) = previous
        && !unchanged
    {
        crate::lookup_index::remove_user_email(txn, previous)?;
    }
    if let Some(next) = next {
        crate::lookup_index::insert_user_email(txn, next, user_id)?;
    }
    Ok(())
}

pub fn parse_datetime(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn parse_uuid(raw: &str) -> Option<Uuid> {
    Uuid::parse_str(raw).ok()
}

pub fn insert_entry(txn: &WriteTransaction, entry: &UserPageEntry) -> Result<()> {
    let bytes = entry.to_bytes()?;
    {
        let mut table = txn.open_table(Table::UserPageIndex.definition())?;
        table.insert(entry.index_key().as_str(), bytes.as_slice())?;
    }
    crate::user_search::insert_entry(txn, entry)?;
    Ok(())
}

pub fn remove_entry(txn: &WriteTransaction, entry: &UserPageEntry) -> Result<()> {
    {
        let mut table = txn.open_table(Table::UserPageIndex.definition())?;
        table.remove(entry.index_key().as_str())?;
    }
    crate::user_search::remove_entry(txn, entry)?;
    Ok(())
}

/// Scans the user page index in key order (email, case-insensitive)
/// and returns the ids of the requested window together with the total number
/// of matching entries. `keep` runs for every index entry, but at most
/// `limit` ids are retained, so the caller never materializes the full user
/// table.
pub fn scan<F>(
    store: &Store,
    offset: usize,
    limit: usize,
    mut keep: F,
) -> Result<(Vec<Uuid>, usize)>
where
    F: FnMut(&UserPageEntry) -> bool,
{
    store.with_read_txn(|txn| {
        let table = txn.open_table(Table::UserPageIndex.definition())?;
        let mut total = 0usize;
        let mut ids: Vec<Uuid> = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            let entry: UserPageEntry = serde_json::from_slice(value.value())?;
            if !keep(&entry) {
                continue;
            }
            if total >= offset && ids.len() < limit {
                ids.push(entry.user_id);
            }
            total += 1;
        }
        Ok((ids, total))
    })
}

/// Counts every index entry and reads only the requested window. This is the
/// fast path for an unfiltered page: `total` comes from the table length and
/// no index value is decoded beyond the window itself.
pub fn scan_all(store: &Store, offset: usize, limit: usize) -> Result<(Vec<Uuid>, usize)> {
    store.with_read_txn(|txn| {
        let table = txn.open_table(Table::UserPageIndex.definition())?;
        let total = table.len()? as usize;
        let mut ids: Vec<Uuid> = Vec::new();
        for entry in table.iter()?.skip(offset) {
            if ids.len() >= limit {
                break;
            }
            let (_, value) = entry?;
            let entry: UserPageEntry = serde_json::from_slice(value.value())?;
            ids.push(entry.user_id);
        }
        Ok((ids, total))
    })
}

/// Writes a user and keeps the page index and the email lookup index in sync
/// within one transaction.
pub fn upsert_user<T: Serialize + ?Sized>(
    store: &Store,
    key: &str,
    user: &T,
    entry: &UserPageEntry,
) -> Result<()> {
    let bytes = serde_json::to_vec(user)?;
    let value = serde_json::to_value(user)?;
    let next_email = email_field(&value);
    store.with_write_txn(|txn| {
        let previous = {
            let mut table = txn.open_table(Table::Users.definition())?;
            let previous = table.get(key)?.map(|value| value.value().to_vec());
            table.insert(key, bytes.as_slice())?;
            previous
        };
        let previous_value = match &previous {
            Some(previous) => Some(serde_json::from_slice::<Value>(previous)?),
            None => None,
        };
        if let Some(previous) = &previous_value
            && let Some(old) = UserPageEntry::from_json(previous)
        {
            remove_entry(txn, &old)?;
        }
        sync_email_index(
            txn,
            previous_value.as_ref().and_then(email_field),
            next_email,
            &entry.user_id.to_string(),
        )?;
        insert_entry(txn, entry)?;
        Ok(())
    })
}

/// Removes a user, its page index entry and its email lookup row within one
/// transaction.
pub fn delete_user(store: &Store, key: &str) -> Result<()> {
    store.with_write_txn(|txn| {
        let previous = {
            let mut table = txn.open_table(Table::Users.definition())?;
            let previous = table.get(key)?.map(|value| value.value().to_vec());
            table.remove(key)?;
            previous
        };
        if let Some(previous) = previous {
            let parsed: Value = serde_json::from_slice(&previous)?;
            if let Some(email) = email_field(&parsed) {
                crate::lookup_index::remove_user_email(txn, email)?;
            }
            if let Some(old) = UserPageEntry::from_json(&parsed) {
                remove_entry(txn, &old)?;
            }
        }
        Ok(())
    })
}

/// Atomic read-modify-write for one user row.
///
/// The whole cycle (read, `apply`, write, reindex) runs in a single write
/// transaction, so a revocation or blocked flag changed here cannot be lost
/// against a concurrent [`Store::update`]. The page index is rebuilt from the
/// new JSON value: the previous index row is removed and the fresh one added,
/// which keeps changed emails, roles and statuses immediately searchable.
pub fn mutate_user<T, R>(
    store: &Store,
    key: &str,
    apply: impl FnOnce(Option<T>) -> (Option<T>, R),
) -> Result<R>
where
    T: Serialize + DeserializeOwned,
{
    store.with_write_txn(|txn| {
        let previous = {
            let table = txn.open_table(Table::Users.definition())?;
            table.get(key)?.map(|value| value.value().to_vec())
        };
        let previous_value = match &previous {
            Some(bytes) => Some(serde_json::from_slice::<Value>(bytes)?),
            None => None,
        };
        let current = match &previous_value {
            Some(value) => Some(serde_json::from_value(value.clone())?),
            None => None,
        };
        let (next, output) = apply(current);
        let next = match next {
            Some(value) => Some(serde_json::to_value(&value)?),
            None => None,
        };

        {
            let mut table = txn.open_table(Table::Users.definition())?;
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

        if let Some(previous) = &previous_value
            && let Some(old) = UserPageEntry::from_json(previous)
        {
            remove_entry(txn, &old)?;
        }
        let next_id = next
            .as_ref()
            .and_then(|value| value.get("id").and_then(Value::as_str))
            .unwrap_or(key);
        sync_email_index(
            txn,
            previous_value.as_ref().and_then(email_field),
            next.as_ref().and_then(email_field),
            next_id,
        )?;
        if let Some(value) = &next
            && let Some(entry) = UserPageEntry::from_json(value)
        {
            insert_entry(txn, &entry)?;
        }
        Ok(output)
    })
}

pub(crate) fn clear(txn: &WriteTransaction) -> Result<()> {
    let keys: Vec<String> = {
        let table = txn.open_table(Table::UserPageIndex.definition())?;
        table
            .iter()?
            .map(|entry| entry.map(|(key, _)| key.value().to_string()))
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    if keys.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::UserPageIndex.definition())?;
    for key in keys {
        table.remove(key.as_str())?;
    }
    Ok(())
}

pub(crate) fn backfill(txn: &WriteTransaction) -> Result<()> {
    let entries: Vec<UserPageEntry> = {
        let users = txn.open_table(Table::Users.definition())?;
        let mut entries = Vec::new();
        for entry in users.iter()? {
            let (_, value) = entry?;
            let parsed: Value = serde_json::from_slice(value.value())?;
            if let Some(index) = UserPageEntry::from_json(&parsed) {
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
    use crate::lookup_index::find_user_id_by_email;

    #[test]
    fn keys_are_case_insensitive_and_ordered_by_user() {
        let lower = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let upper = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();
        let a = index_key("Alice@Example.COM", lower);
        let b = index_key("alice@example.com", upper);
        assert_eq!(a, format!("alice@example.com|{lower}"));
        assert_eq!(b, format!("alice@example.com|{upper}"));
        assert!(a < b);
    }

    #[test]
    fn parses_user_json_with_email_and_full_name() {
        let id = Uuid::new_v4();
        let value = serde_json::json!({
            "id": id,
            "email": "Alice@Example.COM",
            "full_name": " Алиса Иванова ",
            "role": "admin",
            "status": "pending_approval",
            "disabled": true,
            "created_at": "2026-01-02T03:04:05.123456Z",
        });
        let entry = UserPageEntry::from_json(&value).unwrap();
        assert_eq!(entry.user_id, id);
        assert_eq!(entry.email, "alice@example.com");
        assert_eq!(entry.full_name.as_deref(), Some("Алиса Иванова"));
        assert_eq!(entry.sort_name(), "alice@example.com");
        assert_eq!(entry.role, "admin");
        assert_eq!(entry.status, "pending_approval");
        assert!(entry.disabled);
        assert_eq!(entry.created_at.timestamp_micros(), 1_767_323_045_123_456);
    }

    #[test]
    fn rejects_entries_without_created_at_or_email() {
        let value = serde_json::json!({
            "id": Uuid::new_v4(),
            "email": "alice@example.com",
        });
        assert!(UserPageEntry::from_json(&value).is_none());

        let value = serde_json::json!({
            "id": Uuid::new_v4(),
            "login": "alice",
            "created_at": "2026-01-02T03:04:05Z",
        });
        assert!(UserPageEntry::from_json(&value).is_none());
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct UserRow {
        id: Uuid,
        email: String,
        full_name: Option<String>,
        role: String,
        status: String,
        disabled: bool,
        created_at: String,
    }

    fn user_row(id: Uuid, email: &str) -> UserRow {
        UserRow {
            id,
            email: email.to_string(),
            full_name: None,
            role: "user".to_string(),
            status: "active".to_string(),
            disabled: false,
            created_at: "2026-01-02T03:04:05Z".to_string(),
        }
    }

    #[test]
    fn mutate_user_updates_row_and_page_index() {
        let store = Store::open_in_memory().unwrap();
        let id = Uuid::new_v4();
        let key = id.to_string();
        let mut user = user_row(id, "alice@example.com");

        let created = mutate_user::<UserRow, _>(&store, &key, |current| {
            assert!(current.is_none());
            (Some(user.clone()), "created")
        })
        .unwrap();
        assert_eq!(created, "created");
        assert_eq!(
            store.keys(Table::UserPageIndex).unwrap(),
            vec![format!("alice@example.com|{id}")]
        );
        assert_eq!(
            store.get::<UserRow>(Table::Users, &key).unwrap(),
            Some(user.clone())
        );
        assert_eq!(
            find_user_id_by_email(&store, "alice@example.com").unwrap(),
            Some(key.clone())
        );

        let old_key = format!("alice@example.com|{id}");
        let new_key = format!("blocked@example.com|{id}");
        mutate_user::<UserRow, _>(&store, &key, |current| {
            let mut user = current.expect("the user exists");
            user.email = "blocked@example.com".to_string();
            user.status = "blocked".to_string();
            user.disabled = true;
            (Some(user), ())
        })
        .unwrap();

        let keys = store.keys(Table::UserPageIndex).unwrap();
        assert_eq!(keys, vec![new_key.clone()]);
        assert!(!keys.contains(&old_key), "the stale index row must be gone");
        let entry: UserPageEntry = store.get(Table::UserPageIndex, &new_key).unwrap().unwrap();
        assert_eq!(entry.status, "blocked");
        assert!(entry.disabled);
        assert_eq!(
            find_user_id_by_email(&store, "alice@example.com").unwrap(),
            None
        );
        assert_eq!(
            find_user_id_by_email(&store, "blocked@example.com").unwrap(),
            Some(key.clone())
        );

        user = store.get::<UserRow>(Table::Users, &key).unwrap().unwrap();
        assert_eq!(user.email, "blocked@example.com");
        assert!(user.disabled);

        mutate_user::<UserRow, _>(&store, &key, |_| (None, ())).unwrap();
        assert!(store.get::<UserRow>(Table::Users, &key).unwrap().is_none());
        assert!(store.keys(Table::UserPageIndex).unwrap().is_empty());
        assert_eq!(
            find_user_id_by_email(&store, "blocked@example.com").unwrap(),
            None
        );
    }

    #[test]
    fn upsert_and_delete_keep_the_email_index_in_sync() {
        let store = Store::open_in_memory().unwrap();
        let id = Uuid::new_v4();
        let key = id.to_string();
        let mut user = serde_json::json!({
            "id": id,
            "email": "alice@example.com",
            "role": "user",
            "status": "active",
            "disabled": false,
            "created_at": "2026-01-02T03:04:05Z",
        });
        let entry = UserPageEntry::from_json(&user).unwrap();
        upsert_user(&store, &key, &user, &entry).unwrap();
        assert_eq!(
            find_user_id_by_email(&store, "alice@example.com").unwrap(),
            Some(key.clone())
        );

        user["email"] = serde_json::json!("bob@example.com");
        let entry = UserPageEntry::from_json(&user).unwrap();
        upsert_user(&store, &key, &user, &entry).unwrap();
        assert_eq!(
            find_user_id_by_email(&store, "alice@example.com").unwrap(),
            None
        );
        assert_eq!(
            find_user_id_by_email(&store, "bob@example.com").unwrap(),
            Some(key.clone())
        );

        delete_user(&store, &key).unwrap();
        assert_eq!(
            find_user_id_by_email(&store, "bob@example.com").unwrap(),
            None
        );
    }
}
