//! Point lookups by user email and by node token hash.
//!
//! `users` and `nodes` are keyed by id, so finding a row by a unique attribute
//! used to require a full table scan. Two small index tables fix that:
//!
//! * `user_email_index`: normalized email -> user id (JSON string)
//! * `node_token_index`: token hash -> node id (JSON string)
//!
//! The `*_txn` helpers accept a [`WriteTransaction`] so an index row can be
//! written in the same transaction as the entity it describes, and
//! [`Store::put_many_raw`] covers the case where the caller only has encoded
//! values at hand.

use redb::{ReadableTable, WriteTransaction};
use serde_json::Value;

use crate::{Result, Store, Table};

/// Normalizes an email for the `user_email_index` table.
pub fn email_key(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

/// Normalizes a node token hash for the `node_token_index` table.
pub fn node_token_key(token_hash: &str) -> String {
    token_hash.trim().to_ascii_lowercase()
}

fn id_bytes(id: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(id)?)
}

/// Writes the email index row inside `txn`.
pub fn insert_user_email(txn: &WriteTransaction, email: &str, user_id: &str) -> Result<()> {
    let key = email_key(email);
    if key.is_empty() {
        return Ok(());
    }
    let bytes = id_bytes(user_id)?;
    let mut table = txn.open_table(Table::UserEmailIndex.definition())?;
    table.insert(key.as_str(), bytes.as_slice())?;
    Ok(())
}

/// Removes the email index row inside `txn`.
pub fn remove_user_email(txn: &WriteTransaction, email: &str) -> Result<()> {
    let key = email_key(email);
    if key.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::UserEmailIndex.definition())?;
    table.remove(key.as_str())?;
    Ok(())
}

/// Writes the node token index row inside `txn`.
pub fn insert_node_token(txn: &WriteTransaction, token_hash: &str, node_id: &str) -> Result<()> {
    let key = node_token_key(token_hash);
    if key.is_empty() {
        return Ok(());
    }
    let bytes = id_bytes(node_id)?;
    let mut table = txn.open_table(Table::NodeTokenIndex.definition())?;
    table.insert(key.as_str(), bytes.as_slice())?;
    Ok(())
}

/// Removes the node token index row inside `txn`.
pub fn remove_node_token(txn: &WriteTransaction, token_hash: &str) -> Result<()> {
    let key = node_token_key(token_hash);
    if key.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::NodeTokenIndex.definition())?;
    table.remove(key.as_str())?;
    Ok(())
}

/// Indexes a user email in its own transaction.
pub fn index_user_email(store: &Store, email: &str, user_id: &str) -> Result<()> {
    let key = email_key(email);
    if key.is_empty() {
        return Ok(());
    }
    store.put_many_raw(&[(Table::UserEmailIndex, key, id_bytes(user_id)?)])
}

/// Indexes a node token hash in its own transaction.
pub fn index_node_token(store: &Store, token_hash: &str, node_id: &str) -> Result<()> {
    let key = node_token_key(token_hash);
    if key.is_empty() {
        return Ok(());
    }
    store.put_many_raw(&[(Table::NodeTokenIndex, key, id_bytes(node_id)?)])
}

/// Removes an email index row.
pub fn unindex_user_email(store: &Store, email: &str) -> Result<()> {
    let key = email_key(email);
    if key.is_empty() {
        return Ok(());
    }
    store.delete(Table::UserEmailIndex, &key)
}

/// Removes a node token index row.
pub fn unindex_node_token(store: &Store, token_hash: &str) -> Result<()> {
    let key = node_token_key(token_hash);
    if key.is_empty() {
        return Ok(());
    }
    store.delete(Table::NodeTokenIndex, &key)
}

/// Returns the id of the user with `email`, if the index has a row for it.
pub fn find_user_id_by_email(store: &Store, email: &str) -> Result<Option<String>> {
    let key = email_key(email);
    if key.is_empty() {
        return Ok(None);
    }
    store.get(Table::UserEmailIndex, &key)
}

/// Returns the id of the node with `token_hash`, if the index has a row for it.
pub fn find_node_id_by_token_hash(store: &Store, token_hash: &str) -> Result<Option<String>> {
    let key = node_token_key(token_hash);
    if key.is_empty() {
        return Ok(None);
    }
    store.get(Table::NodeTokenIndex, &key)
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

/// Rebuilds both lookup indexes from `users` and `nodes`. Idempotent: the
/// tables are cleared first, so a repeated run never leaves duplicates or
/// stale rows behind.
pub(crate) fn backfill(txn: &WriteTransaction) -> Result<()> {
    let mut emails: Vec<(String, String)> = Vec::new();
    {
        let table = txn.open_table(Table::Users.definition())?;
        for entry in table.iter()? {
            let (key, value) = entry?;
            let parsed: Value = serde_json::from_slice(value.value())?;
            let Some(email) = parsed.get("email").and_then(Value::as_str) else {
                continue;
            };
            let email = email_key(email);
            if email.is_empty() {
                continue;
            }
            let id = parsed
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| key.value().to_string());
            emails.push((email, id));
        }
    }

    let mut tokens: Vec<(String, String)> = Vec::new();
    {
        let table = txn.open_table(Table::Nodes.definition())?;
        for entry in table.iter()? {
            let (key, value) = entry?;
            let parsed: Value = serde_json::from_slice(value.value())?;
            let Some(token_hash) = parsed.get("token_hash").and_then(Value::as_str) else {
                continue;
            };
            let token_hash = node_token_key(token_hash);
            if token_hash.is_empty() {
                continue;
            }
            let id = parsed
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| key.value().to_string());
            tokens.push((token_hash, id));
        }
    }

    clear_table(txn, Table::UserEmailIndex)?;
    clear_table(txn, Table::NodeTokenIndex)?;

    if !emails.is_empty() {
        let mut table = txn.open_table(Table::UserEmailIndex.definition())?;
        for (key, id) in emails {
            let bytes = id_bytes(&id)?;
            table.insert(key.as_str(), bytes.as_slice())?;
        }
    }
    if !tokens.is_empty() {
        let mut table = txn.open_table(Table::NodeTokenIndex.definition())?;
        for (key, id) in tokens {
            let bytes = id_bytes(&id)?;
            table.insert(key.as_str(), bytes.as_slice())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_trimmed_and_lowercased() {
        assert_eq!(email_key("  Alice@Example.COM "), "alice@example.com");
        assert_eq!(email_key(""), "");
        assert_eq!(node_token_key(" ABCD1234 "), "abcd1234");
    }

    #[test]
    fn store_helpers_roundtrip_both_indexes() {
        let store = Store::open_in_memory().unwrap();
        let user = uuid::Uuid::new_v4().to_string();
        let node = uuid::Uuid::new_v4().to_string();

        index_user_email(&store, "Alice@Example.COM", &user).unwrap();
        index_node_token(&store, "ABCD1234", &node).unwrap();

        assert_eq!(
            find_user_id_by_email(&store, " alice@example.com").unwrap(),
            Some(user.clone())
        );
        assert_eq!(
            find_node_id_by_token_hash(&store, "abcd1234").unwrap(),
            Some(node.clone())
        );
        assert_eq!(
            find_user_id_by_email(&store, "bob@example.com").unwrap(),
            None
        );
        assert_eq!(find_node_id_by_token_hash(&store, "ffff").unwrap(), None);

        unindex_user_email(&store, "alice@example.com").unwrap();
        unindex_node_token(&store, "abcd1234").unwrap();
        assert_eq!(
            find_user_id_by_email(&store, "alice@example.com").unwrap(),
            None
        );
        assert_eq!(
            find_node_id_by_token_hash(&store, "abcd1234").unwrap(),
            None
        );
    }

    #[test]
    fn put_many_raw_writes_the_entity_and_its_index_atomically() {
        let store = Store::open_in_memory().unwrap();
        let user = uuid::Uuid::new_v4();
        let row = serde_json::to_vec(&serde_json::json!({
            "id": user,
            "email": "alice@example.com",
        }))
        .unwrap();

        store
            .put_many_raw(&[
                (Table::Users, user.to_string(), row),
                (
                    Table::UserEmailIndex,
                    email_key("alice@example.com"),
                    id_bytes(&user.to_string()).unwrap(),
                ),
            ])
            .unwrap();

        assert_eq!(
            find_user_id_by_email(&store, "Alice@Example.COM").unwrap(),
            Some(user.to_string())
        );
        assert!(
            store
                .get::<Value>(Table::Users, &user.to_string())
                .unwrap()
                .is_some()
        );
    }
}
