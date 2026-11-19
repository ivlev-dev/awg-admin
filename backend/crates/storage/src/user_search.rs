use std::collections::BTreeSet;

use redb::{ReadTransaction, ReadableTable, ReadableTableMetadata};
use serde_json::Value;
use uuid::Uuid;

use crate::user_index::UserPageEntry;
use crate::{Result, Store, Table, WriteTransaction, prefix_upper_bound};

pub const MIN_GRAM: usize = 3;

const EMPTY: &[u8] = &[];

/// Characters that survive search-index normalization. Emails and logins use
/// the same alphabet, so a query made of these characters can be matched by
/// intersecting trigram postings without losing substring matches.
fn is_index_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '@' | '.' | '-')
}

/// Lower-cases `raw` and drops every character outside the indexed alphabet.
/// The function is idempotent.
pub fn normalize(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .filter(|c| is_index_char(*c))
        .collect()
}

/// Returns the trigrams of `value`, or the whole (short) value when it has
/// fewer than three characters.
pub fn grams(value: &str) -> Vec<String> {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return Vec::new();
    }
    if bytes.len() < MIN_GRAM {
        return vec![value.to_string()];
    }
    bytes
        .windows(MIN_GRAM)
        .map(|window| String::from_utf8_lossy(window).into_owned())
        .collect()
}

pub fn search_keys(value: &str, user_id: Uuid) -> Vec<String> {
    grams(value)
        .into_iter()
        .map(|gram| format!("{gram}|{user_id}"))
        .collect()
}

fn values_for_entry(entry: &UserPageEntry) -> Vec<&str> {
    let mut values: Vec<&str> = Vec::new();
    if let Some(email) = entry
        .email
        .as_deref()
        .map(str::trim)
        .filter(|email| !email.is_empty())
    {
        values.push(email);
    }
    values.push(&entry.login);
    values
}

/// Every `user_search_index` key that must exist for `entry`. Emails and
/// logins are indexed separately (deduplicated) so that a query can still match
/// a login that is not a prefix of the email, preserving the legacy
/// `email.contains(q) || login.contains(q)` semantics.
pub fn keys_for_entry(entry: &UserPageEntry) -> Vec<String> {
    let mut keys: BTreeSet<String> = BTreeSet::new();
    for raw in values_for_entry(entry) {
        let normalized = normalize(raw);
        if normalized.is_empty() {
            continue;
        }
        for key in search_keys(&normalized, entry.user_id) {
            keys.insert(key);
        }
    }
    keys.into_iter().collect()
}

pub fn insert_entry(txn: &WriteTransaction, entry: &UserPageEntry) -> Result<()> {
    let keys = keys_for_entry(entry);
    if keys.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::UserSearchIndex.definition())?;
    for key in keys {
        table.insert(key.as_str(), EMPTY)?;
    }
    Ok(())
}

pub fn remove_entry(txn: &WriteTransaction, entry: &UserPageEntry) -> Result<()> {
    let keys = keys_for_entry(entry);
    if keys.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::UserSearchIndex.definition())?;
    for key in keys {
        table.remove(key.as_str())?;
    }
    Ok(())
}

/// Returns the trigrams of an indexable query. `None` means the caller must
/// fall back to the full `user_page_index` scan: queries shorter than three
/// characters and queries containing characters outside the indexed alphabet
/// cannot be answered by prefix intersection without changing the result.
fn query_grams(q: &str) -> Option<Vec<String>> {
    let normalized = normalize(q);
    if normalized.chars().count() < MIN_GRAM {
        return None;
    }
    if !q
        .trim()
        .chars()
        .all(|c| is_index_char(c.to_ascii_lowercase()))
    {
        return None;
    }
    Some(grams(&normalized))
}

fn postings(txn: &ReadTransaction, gram: &str) -> Result<BTreeSet<Uuid>> {
    let table = txn.open_table(Table::UserSearchIndex.definition())?;
    let prefix = format!("{gram}|");
    let mut ids = BTreeSet::new();
    let Some(upper) = prefix_upper_bound(&prefix) else {
        return Ok(ids);
    };
    for entry in table.range::<&str>(prefix.as_str()..upper.as_str())? {
        let (key, _) = entry?;
        let key = key.value();
        let Some((_, id)) = key.rsplit_once('|') else {
            continue;
        };
        if let Ok(id) = Uuid::parse_str(id) {
            ids.insert(id);
        }
    }
    Ok(ids)
}

/// Retains the candidates that carry a posting for `gram`. Point lookups are
/// cheaper than a range scan once the candidate window is small.
fn retain_posting(
    txn: &ReadTransaction,
    gram: &str,
    candidates: &BTreeSet<Uuid>,
) -> Result<BTreeSet<Uuid>> {
    let table = txn.open_table(Table::UserSearchIndex.definition())?;
    let mut ids = BTreeSet::new();
    for id in candidates {
        let key = format!("{gram}|{id}");
        if table.get(key.as_str())?.is_some() {
            ids.insert(*id);
        }
    }
    Ok(ids)
}

/// Grams with digits, `@`, `.` or `-` are usually far more selective than
/// grams made of letters only, so they are intersected first.
fn gram_priority(gram: &str) -> usize {
    gram.chars().filter(|c| !c.is_ascii_alphabetic()).count()
}

const POINT_LOOKUP_THRESHOLD: usize = 512;
/// Above this many candidates a broad query is answered from the compact
/// `user_page_index` instead: counting and verifying most of the user table is
/// cheaper there than decoding full `users` rows.
const BROAD_FALLBACK_THRESHOLD: usize = 1024;

/// Intersects the postings of every query trigram. The returned set is a
/// superset of the users whose normalized email or login contains the query;
/// the caller still verifies the raw substring.
pub fn candidates(txn: &ReadTransaction, q: &str) -> Result<Option<BTreeSet<Uuid>>> {
    let Some(mut grams) = query_grams(q) else {
        return Ok(None);
    };
    grams.sort_by_key(|gram| std::cmp::Reverse(gram_priority(gram)));
    let mut intersection: Option<BTreeSet<Uuid>> = None;
    let mut total_users: Option<usize> = None;
    for gram in grams {
        let ids = match &intersection {
            Some(current) if current.len() <= POINT_LOOKUP_THRESHOLD => {
                retain_posting(txn, &gram, current)?
            }
            _ => postings(txn, &gram)?,
        };
        if ids.is_empty() {
            return Ok(Some(BTreeSet::new()));
        }
        if intersection.is_none() && ids.len() > BROAD_FALLBACK_THRESHOLD {
            let total = match total_users {
                Some(total) => total,
                None => {
                    let total = txn.open_table(Table::UserPageIndex.definition())?.len()? as usize;
                    total_users = Some(total);
                    total
                }
            };
            if ids.len() * 10 >= total * 9 {
                return Ok(None);
            }
        }
        intersection = Some(match intersection {
            None => ids,
            Some(current) => current.intersection(&ids).copied().collect(),
        });
    }
    Ok(Some(intersection.unwrap_or_default()))
}

/// Answers a search page from the trigram index. Returns `None` when the query
/// cannot use the index, so the caller can fall back to `user_index::scan`.
///
/// Only the intersection of the trigram postings is materialized; `users` is
/// read for those candidates alone, never the whole `user_page_index`.
pub fn search_page<F>(
    store: &Store,
    q: &str,
    offset: usize,
    limit: usize,
    mut keep: F,
) -> Result<Option<(Vec<Uuid>, usize)>>
where
    F: FnMut(&UserPageEntry) -> bool,
{
    store.with_read_txn(|txn| {
        let Some(candidates) = candidates(txn, q)? else {
            return Ok(None);
        };
        if candidates.is_empty() {
            return Ok(Some((Vec::new(), 0)));
        }
        if candidates.len() > BROAD_FALLBACK_THRESHOLD {
            let total_users = txn.open_table(Table::UserPageIndex.definition())?.len()? as usize;
            if candidates.len() * 4 > total_users {
                return Ok(None);
            }
        }
        let users = txn.open_table(Table::Users.definition())?;
        let mut matched: Vec<UserPageEntry> = Vec::new();
        for id in candidates {
            let Some(raw) = users.get(id.to_string().as_str())? else {
                continue;
            };
            let parsed: Value = serde_json::from_slice(raw.value())?;
            let Some(entry) = UserPageEntry::from_json(&parsed) else {
                continue;
            };
            if !entry.matches_search(q) || !keep(&entry) {
                continue;
            }
            matched.push(entry);
        }
        matched.sort_by_key(UserPageEntry::index_key);
        let total = matched.len();
        let ids = matched
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|entry| entry.user_id)
            .collect();
        Ok(Some((ids, total)))
    })
}

pub(crate) fn clear(txn: &WriteTransaction) -> Result<()> {
    let keys: Vec<String> = {
        let table = txn.open_table(Table::UserSearchIndex.definition())?;
        table
            .iter()?
            .map(|entry| entry.map(|(key, _)| key.value().to_string()))
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    if keys.is_empty() {
        return Ok(());
    }
    let mut table = txn.open_table(Table::UserSearchIndex.definition())?;
    for key in keys {
        table.remove(key.as_str())?;
    }
    Ok(())
}

/// Rebuilds the trigram index from `users`. Idempotent: the table is cleared
/// first, then every parsable user is indexed again.
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

    fn entry(email: Option<&str>, login: &str) -> UserPageEntry {
        UserPageEntry::new(
            Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
            email.map(str::to_string),
            login,
            "user",
            "active",
            false,
            chrono::DateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn normalization_lowercases_and_keeps_only_the_indexed_alphabet() {
        assert_eq!(normalize("  Alice@Example.COM "), "alice@example.com");
        assert_eq!(normalize("User_Name!"), "username");
        assert_eq!(normalize("ЖУК@example.com"), "@example.com");
        assert_eq!(normalize("---"), "---");
        assert_eq!(normalize("!!!"), "");
        assert_eq!(normalize("Ab-C.d@e"), "ab-c.d@e");
    }

    #[test]
    fn grams_are_generated_for_long_values_and_kept_whole_when_short() {
        assert_eq!(grams("abc"), vec!["abc"]);
        assert_eq!(grams("abcd"), vec!["abc", "bcd"]);
        assert_eq!(grams("ab"), vec!["ab"]);
        assert_eq!(grams("a"), vec!["a"]);
        assert!(grams("").is_empty());
    }

    #[test]
    fn search_keys_use_gram_pipe_user_id() {
        let id = Uuid::parse_str("00000000-0000-0000-0000-0000000000ab").unwrap();
        assert_eq!(
            search_keys("abcd", id),
            vec![format!("abc|{id}"), format!("bcd|{id}"),]
        );
        assert_eq!(search_keys("ab", id), vec![format!("ab|{id}")]);
    }

    #[test]
    fn keys_cover_email_and_login_and_skip_empty_values() {
        let keys = keys_for_entry(&entry(Some("Alice@Example.COM"), "alice"));
        assert!(keys.iter().any(|key| key.starts_with("ali|")));
        assert_eq!(
            keys.iter().filter(|key| key.starts_with("ali|")).count(),
            1,
            "duplicate grams across email and login are deduplicated"
        );

        let distinct = keys_for_entry(&entry(Some("person@example.com"), "legacy-login"));
        assert!(distinct.iter().any(|key| key.starts_with("leg|")));
        assert!(distinct.iter().any(|key| key.starts_with("per|")));

        assert!(keys_for_entry(&entry(None, "")).is_empty());
    }

    #[test]
    fn query_grams_reject_short_and_non_indexable_queries() {
        assert!(query_grams("ab").is_none());
        assert!(query_grams("a").is_none());
        assert!(query_grams("abc").is_some());
        assert!(query_grams("ab_cd").is_none());
        assert!(query_grams("жук").is_none());
        assert!(query_grams("AbC").is_some());
        assert!(query_grams(" a b ").is_none());
    }
}
