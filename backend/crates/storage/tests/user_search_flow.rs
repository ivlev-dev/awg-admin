use std::time::Instant;

use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use awg_storage::user_index::{self, UserPageEntry};
use awg_storage::user_search;
use awg_storage::{Store, Table};

struct Seeded {
    id: Uuid,
    email: String,
    full_name: Option<String>,
}

impl Seeded {
    fn matches(&self, q: &str) -> bool {
        let q = q.to_lowercase();
        self.email.to_lowercase().contains(&q)
            || self
                .full_name
                .as_deref()
                .is_some_and(|full_name| full_name.to_lowercase().contains(&q))
    }

    fn sort_key(&self) -> String {
        format!("{}|{}", self.email.to_lowercase(), self.id)
    }
}

fn save_user(store: &Store, id: Uuid, email: &str, full_name: Option<&str>, index: i64) -> Seeded {
    let created = DateTime::<Utc>::UNIX_EPOCH + Duration::seconds(index);
    let entry = UserPageEntry::new(
        id,
        email.to_string(),
        full_name.map(str::to_string),
        "user",
        "active",
        false,
        created,
    );
    let user = json!({
        "id": id,
        "email": email,
        "full_name": full_name,
        "role": "user",
        "status": "active",
        "disabled": false,
        "created_at": created.to_rfc3339(),
    });
    user_index::upsert_user(store, &id.to_string(), &user, &entry).unwrap();
    Seeded {
        id,
        email: email.to_string(),
        full_name: full_name.map(str::to_string),
    }
}

fn search(
    store: &Store,
    q: &str,
    offset: usize,
    limit: usize,
    keep: impl FnMut(&UserPageEntry) -> bool,
) -> Option<(Vec<Uuid>, usize)> {
    user_search::search_page(store, q, offset, limit, keep).unwrap()
}

fn search_ids(store: &Store, q: &str) -> Vec<Uuid> {
    search(store, q, 0, 10_000, |_| true)
        .expect("query must be indexable")
        .0
}

fn brute_force(users: &[Seeded], q: &str) -> Vec<Uuid> {
    let mut matched: Vec<&Seeded> = users.iter().filter(|user| user.matches(q)).collect();
    matched.sort_by_key(|user| user.sort_key());
    matched.into_iter().map(|user| user.id).collect()
}

fn seed_250(store: &Store) -> Vec<Seeded> {
    (0..250)
        .map(|index| {
            let id = Uuid::from_u128(1_000_000 + index as u128);
            save_user(
                store,
                id,
                &format!("user-{index:03}@example.com"),
                None,
                index as i64,
            )
        })
        .collect()
}

#[test]
fn trigram_search_matches_case_insensitively() {
    let store = Store::open_in_memory().unwrap();
    let users = seed_250(&store);

    for q in ["USER-01", "User-1", "user-01"] {
        assert_eq!(
            search_ids(&store, q),
            brute_force(&users, &q.to_lowercase())
        );
    }
    assert_eq!(search_ids(&store, "USER-01").len(), 10);
    assert_eq!(
        search_ids(&store, "example.com"),
        brute_force(&users, "example.com")
    );
    assert_eq!(
        search_ids(&store, "ple.co"),
        brute_force(&users, "ple.co"),
        "a match in the middle of the value must be found"
    );
}

#[test]
fn trigram_search_finds_full_names_in_any_script() {
    let store = Store::open_in_memory().unwrap();
    let users = vec![
        save_user(
            &store,
            Uuid::from_u128(1),
            "a@example.com",
            Some("Иван Петров"),
            1,
        ),
        save_user(
            &store,
            Uuid::from_u128(2),
            "b@example.com",
            Some("John Smith"),
            2,
        ),
    ];

    assert_eq!(search_ids(&store, "иван"), vec![users[0].id]);
    assert_eq!(search_ids(&store, "ПЕТРОВ"), vec![users[0].id]);
    assert_eq!(search_ids(&store, "smith"), vec![users[1].id]);
    assert_eq!(search_ids(&store, "иван"), brute_force(&users, "иван"));
}

#[test]
fn trigram_search_has_no_false_positives() {
    let store = Store::open_in_memory().unwrap();
    let users = vec![
        save_user(
            &store,
            Uuid::from_u128(1),
            "team-alpha-eng@corp.example",
            None,
            1,
        ),
        save_user(
            &store,
            Uuid::from_u128(2),
            "beta-team@corp.example",
            None,
            2,
        ),
        save_user(&store, Uuid::from_u128(3), "gamma@other.example", None, 3),
    ];

    assert_eq!(search_ids(&store, "alpha"), brute_force(&users, "alpha"));
    assert_eq!(search_ids(&store, "alpha"), vec![users[0].id]);
    assert_eq!(search_ids(&store, "lph"), vec![users[0].id]);
    assert_eq!(
        search_ids(&store, "corp.example"),
        brute_force(&users, "corp.example")
    );
    assert!(search_ids(&store, "aaa").is_empty());
    assert!(search_ids(&store, "no-such-user").is_empty());
    assert_eq!(search_ids(&store, "team"), brute_force(&users, "team"));
}

#[test]
fn trigram_search_paginates_and_counts_only_matches() {
    let store = Store::open_in_memory().unwrap();
    let users = seed_250(&store);
    let expected = brute_force(&users, "user-1");
    assert_eq!(expected.len(), 100);

    let mut seen = Vec::new();
    for page in 0..4 {
        let (ids, total) = search(&store, "user-1", page * 25, 25, |_| true).unwrap();
        assert_eq!(total, expected.len());
        assert_eq!(ids.len(), 25);
        seen.extend(ids);
    }
    assert_eq!(seen, expected);

    let (ids, total) = search(&store, "user-1", 500, 25, |_| true).unwrap();
    assert_eq!(total, expected.len());
    assert!(ids.is_empty());

    let (ids, total) = search(&store, "example.com", 0, 7, |_| true).unwrap();
    assert_eq!(total, 250);
    assert_eq!(ids, brute_force(&users, "example.com")[..7]);
}

#[test]
fn trigram_search_keeps_role_status_and_tab_filters() {
    let store = Store::open_in_memory().unwrap();
    let users = seed_250(&store);
    let disabled = users[2].id;
    let pending = users[3].id;

    let entry = UserPageEntry::new(
        disabled,
        "user-002@example.com".into(),
        None,
        "user",
        "active",
        true,
        DateTime::<Utc>::UNIX_EPOCH,
    );
    let user = json!({
        "id": disabled,
        "email": "user-002@example.com",
        "role": "user",
        "status": "active",
        "disabled": true,
        "created_at": "1970-01-01T00:00:00Z",
    });
    user_index::upsert_user(&store, &disabled.to_string(), &user, &entry).unwrap();

    let pending_entry = UserPageEntry::new(
        pending,
        "user-003@example.com".into(),
        None,
        "user",
        "pending_approval",
        false,
        DateTime::<Utc>::UNIX_EPOCH,
    );
    let pending_user = json!({
        "id": pending,
        "email": "user-003@example.com",
        "role": "user",
        "status": "pending_approval",
        "disabled": false,
        "created_at": "1970-01-01T00:00:00Z",
    });
    user_index::upsert_user(&store, &pending.to_string(), &pending_user, &pending_entry).unwrap();

    let (ids, total) = search(&store, "user-00", 0, 50, |entry| entry.disabled).unwrap();
    assert_eq!(total, 1);
    assert_eq!(ids, vec![disabled]);

    let (ids, total) = search(&store, "user-00", 0, 50, |entry| entry.role == "admin").unwrap();
    assert_eq!(total, 0);
    assert!(ids.is_empty());

    let (ids, total) = search(&store, "user-00", 0, 50, |entry| {
        entry.status == "pending_approval"
    })
    .unwrap();
    assert_eq!(total, 1);
    assert_eq!(ids, vec![pending]);
}

#[test]
fn index_follows_email_and_full_name_changes_and_deletion() {
    let store = Store::open_in_memory().unwrap();
    let id = Uuid::from_u128(42);
    save_user(
        &store,
        id,
        "old-address@example.com",
        Some("Legacy-Login"),
        1,
    );

    assert_eq!(
        search_ids(&store, "legacy-login"),
        vec![id],
        "the full name is indexed even when an email exists"
    );
    assert_eq!(search_ids(&store, "old-address"), vec![id]);

    save_user(
        &store,
        id,
        "new-address@example.com",
        Some("Renamed-Login"),
        1,
    );

    assert!(search_ids(&store, "old-address").is_empty());
    assert!(search_ids(&store, "legacy-login").is_empty());
    assert_eq!(search_ids(&store, "new-address"), vec![id]);
    assert_eq!(search_ids(&store, "renamed-login"), vec![id]);
    assert_eq!(
        store.count(Table::UserSearchIndex).unwrap(),
        user_search::keys_for_entry(&UserPageEntry::new(
            id,
            "new-address@example.com".into(),
            Some("Renamed-Login".into()),
            "user",
            "active",
            false,
            DateTime::<Utc>::UNIX_EPOCH,
        ))
        .len()
    );

    user_index::delete_user(&store, &id.to_string()).unwrap();
    assert!(search_ids(&store, "new-address").is_empty());
    assert!(search_ids(&store, "renamed-login").is_empty());
    assert_eq!(store.count(Table::UserSearchIndex).unwrap(), 0);
}

#[test]
fn short_and_non_indexable_queries_fall_back() {
    let store = Store::open_in_memory().unwrap();
    seed_250(&store);

    for q in ["a", "ab", "ab_cd", "user_1"] {
        assert!(
            search(&store, q, 0, 50, |_| true).is_none(),
            "query {q:?} must use the page-index scan"
        );
    }
    assert!(search(&store, "abc", 0, 50, |_| true).is_some());
    assert!(search(&store, "AbC", 0, 50, |_| true).is_some());
}

#[test]
fn short_values_are_indexed_whole() {
    let store = Store::open_in_memory().unwrap();
    let id = Uuid::from_u128(7);
    save_user(&store, id, "ab", None, 1);
    assert_eq!(
        store.keys(Table::UserSearchIndex).unwrap(),
        vec![format!("ab|{id}")],
        "a value shorter than three characters is stored under its own key"
    );
    assert!(
        search(&store, "ab", 0, 50, |_| true).is_none(),
        "queries shorter than three characters still use the fallback scan"
    );
}

#[test]
#[ignore = "10k users benchmark, run with --ignored --nocapture"]
fn search_10k_users_uses_the_trigram_index() {
    let store = Store::open_in_memory().unwrap();
    let users: Vec<Seeded> = (0..10_000)
        .map(|index| {
            let id = Uuid::from_u128(1_000_000 + index as u128);
            save_user(
                &store,
                id,
                &format!("user-{index:05}@example.com"),
                None,
                index as i64,
            )
        })
        .collect();

    let q = "4217";
    let expected = brute_force(&users, q);
    assert_eq!(expected.len(), 1);

    let scan_start = Instant::now();
    let (scan_ids, scan_total) =
        user_index::scan(&store, 0, 50, |entry| entry.matches_search(q)).unwrap();
    let scan_elapsed = scan_start.elapsed();

    let search_start = Instant::now();
    let (index_ids, index_total) = search(&store, q, 0, 50, |_| true).unwrap();
    let search_elapsed = search_start.elapsed();

    assert_eq!(scan_ids, index_ids);
    assert_eq!(scan_total, index_total);
    assert_eq!(index_ids, expected);

    let broad = "user-04217";
    let broad_scan_start = Instant::now();
    let (broad_scan_ids, broad_scan_total) =
        user_index::scan(&store, 0, 50, |entry| entry.matches_search(broad)).unwrap();
    let broad_scan_elapsed = broad_scan_start.elapsed();
    let broad_start = Instant::now();
    let (broad_ids, broad_total) = search(&store, broad, 0, 50, |_| true).unwrap();
    let broad_elapsed = broad_start.elapsed();
    assert_eq!(broad_scan_ids, broad_ids);
    assert_eq!(broad_scan_total, broad_total);
    assert_eq!(broad_total, 1);

    let all = "example";
    let all_scan_start = Instant::now();
    let (all_scan_ids, all_scan_total) =
        user_index::scan(&store, 0, 50, |entry| entry.matches_search(all)).unwrap();
    let all_scan_elapsed = all_scan_start.elapsed();
    let all_start = Instant::now();
    let indexed = search(&store, all, 0, 50, |_| true);
    let fell_back = indexed.is_none();
    let (all_ids, all_total) = indexed.unwrap_or_else(|| {
        user_index::scan(&store, 0, 50, |entry| entry.matches_search(all)).unwrap()
    });
    let all_elapsed = all_start.elapsed();
    assert_eq!(all_scan_ids, all_ids);
    assert_eq!(all_scan_total, all_total);

    println!(
        "10k users, q={q:?}: page-index scan {scan_elapsed:?}, trigram intersection {search_elapsed:?}"
    );
    println!(
        "10k users, q={broad:?}: page-index scan {broad_scan_elapsed:?}, trigram intersection {broad_elapsed:?}"
    );
    println!(
        "10k users, q={all:?} (matches all, fell back: {fell_back}): page-index scan {all_scan_elapsed:?}, indexed path {all_elapsed:?}"
    );
    assert!(
        search_elapsed < scan_elapsed,
        "trigram lookup ({search_elapsed:?}) must beat the full page-index scan ({scan_elapsed:?})"
    );
}
