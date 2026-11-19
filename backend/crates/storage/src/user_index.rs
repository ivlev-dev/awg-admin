use chrono::{DateTime, Utc};
use redb::{ReadableTable, ReadableTableMetadata};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{Result, Store, Table, WriteTransaction};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserPageEntry {
    pub user_id: Uuid,
    #[serde(default)]
    pub email: Option<String>,
    pub login: String,
    pub role: String,
    pub status: String,
    pub disabled: bool,
    #[serde(default = "default_created_at")]
    pub created_at: DateTime<Utc>,
}

impl UserPageEntry {
    pub fn new(
        user_id: Uuid,
        email: Option<String>,
        login: &str,
        role: &str,
        status: &str,
        disabled: bool,
        created_at: DateTime<Utc>,
    ) -> Self {
        Self {
            user_id,
            email: email.filter(|value| !value.trim().is_empty()),
            login: login.to_string(),
            role: role.to_string(),
            status: status.to_string(),
            disabled,
            created_at,
        }
    }

    pub fn from_json(value: &Value) -> Option<Self> {
        let user_id = value.get("id")?.as_str().and_then(parse_uuid)?;
        let login = value
            .get("login")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let email = value
            .get("email")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|email| !email.is_empty())
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
            login,
            role,
            status,
            disabled,
            created_at,
        })
    }

    pub fn sort_name(&self) -> String {
        self.email
            .as_deref()
            .filter(|email| !email.is_empty())
            .unwrap_or(&self.login)
            .to_lowercase()
    }

    pub fn index_key(&self) -> String {
        index_key(&self.sort_name(), self.user_id)
    }

    pub fn matches_search(&self, q: &str) -> bool {
        let q = q.to_lowercase();
        self.sort_name().contains(&q) || self.login.to_lowercase().contains(&q)
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

/// Scans the user page index in key order (email or login, case-insensitive)
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

/// Writes a user and keeps the page index in sync within one transaction.
pub fn upsert_user<T: Serialize + ?Sized>(
    store: &Store,
    key: &str,
    user: &T,
    entry: &UserPageEntry,
) -> Result<()> {
    let bytes = serde_json::to_vec(user)?;
    store.with_write_txn(|txn| {
        let previous = {
            let mut table = txn.open_table(Table::Users.definition())?;
            let previous = table.get(key)?.map(|value| value.value().to_vec());
            table.insert(key, bytes.as_slice())?;
            previous
        };
        if let Some(previous) = previous {
            let parsed: Value = serde_json::from_slice(&previous)?;
            if let Some(old) = UserPageEntry::from_json(&parsed) {
                remove_entry(txn, &old)?;
            }
        }
        insert_entry(txn, entry)?;
        Ok(())
    })
}

/// Removes a user and its page index entry within one transaction.
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
            if let Some(old) = UserPageEntry::from_json(&parsed) {
                remove_entry(txn, &old)?;
            }
        }
        Ok(())
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
    fn parses_user_json_and_falls_back_to_login() {
        let id = Uuid::new_v4();
        let value = serde_json::json!({
            "id": id,
            "login": "Alice",
            "role": "admin",
            "status": "pending_approval",
            "disabled": true,
            "created_at": "2026-01-02T03:04:05.123456Z",
        });
        let entry = UserPageEntry::from_json(&value).unwrap();
        assert_eq!(entry.user_id, id);
        assert_eq!(entry.email, None);
        assert_eq!(entry.sort_name(), "alice");
        assert_eq!(entry.role, "admin");
        assert_eq!(entry.status, "pending_approval");
        assert!(entry.disabled);
        assert_eq!(entry.created_at.timestamp_micros(), 1_767_323_045_123_456);
    }

    #[test]
    fn rejects_entries_without_created_at() {
        let value = serde_json::json!({
            "id": Uuid::new_v4(),
            "login": "alice",
        });
        assert!(UserPageEntry::from_json(&value).is_none());
    }
}
