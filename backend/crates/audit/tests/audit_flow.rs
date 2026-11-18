use std::sync::{Arc, Mutex};

use chrono::{Duration, TimeZone, Utc};
use uuid::Uuid;

use awg_audit::{
    AuditEntry, AuditFilter, AuditPage, AuditRepository, AuditService, DEFAULT_AUDIT_LIMIT,
    MAX_AUDIT_LIMIT, NewAuditEntry, RedbAuditRepository,
};
use awg_shared::CoreResult;
use awg_storage::Store;

fn entry(at: chrono::DateTime<Utc>, action: &str) -> AuditEntry {
    AuditEntry {
        id: Uuid::new_v4(),
        at,
        actor_id: Some(Uuid::new_v4()),
        actor_login: "admin".into(),
        action: action.into(),
        entity: "devices".into(),
        entity_id: Some(Uuid::new_v4().to_string()),
        status: 200,
        ip: Some("203.0.113.7".into()),
        details: None,
    }
}

fn base() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap()
}

#[test]
fn repository_returns_entries_newest_first() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let repo = RedbAuditRepository::new(store);

    let first = entry(base(), "POST");
    let second = entry(base() + Duration::milliseconds(250), "PATCH");
    let third = entry(base() + Duration::seconds(30), "DELETE");

    repo.record(&first).unwrap();
    repo.record(&second).unwrap();
    repo.record(&third).unwrap();

    let listed = repo.list(10).unwrap();
    let ids: Vec<Uuid> = listed.iter().map(|item| item.id).collect();
    assert_eq!(ids, vec![third.id, second.id, first.id]);
}

#[test]
fn repository_respects_limit_and_zero() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let repo = RedbAuditRepository::new(store);

    for index in 0..5 {
        repo.record(&entry(base() + Duration::seconds(index), "POST"))
            .unwrap();
    }

    assert_eq!(repo.list(2).unwrap().len(), 2);
    assert!(repo.list(0).unwrap().is_empty());
    assert_eq!(repo.list(100).unwrap().len(), 5);
}

struct RecordingRepository {
    entries: Mutex<Vec<AuditEntry>>,
    requested_limit: Mutex<Option<usize>>,
    deleted_filters: Mutex<Vec<AuditFilter>>,
}

impl RecordingRepository {
    fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            requested_limit: Mutex::new(None),
            deleted_filters: Mutex::new(Vec::new()),
        }
    }
}

impl AuditRepository for RecordingRepository {
    fn record(&self, entry: &AuditEntry) -> CoreResult<()> {
        self.entries.lock().unwrap().push(entry.clone());
        Ok(())
    }

    fn list_page_filtered(
        &self,
        limit: usize,
        _before: Option<&str>,
        _filter: &AuditFilter,
    ) -> CoreResult<AuditPage> {
        *self.requested_limit.lock().unwrap() = Some(limit);
        let entries = self.entries.lock().unwrap();
        Ok(AuditPage {
            items: entries.iter().rev().take(limit).cloned().collect(),
            next_cursor: None,
        })
    }

    fn prune(&self, before: chrono::DateTime<chrono::Utc>) -> CoreResult<usize> {
        let mut entries = self.entries.lock().unwrap();
        let mut removed = 0;
        entries.retain(|entry| {
            if entry.at < before {
                removed += 1;
                false
            } else {
                true
            }
        });
        Ok(removed)
    }

    fn delete_filtered(&self, filter: &AuditFilter) -> CoreResult<usize> {
        self.deleted_filters.lock().unwrap().push(filter.clone());
        let mut entries = self.entries.lock().unwrap();
        let before = entries.len();
        entries.retain(|entry| !filter.matches(entry));
        Ok(before - entries.len())
    }
}

#[test]
fn service_clamps_limit() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());

    service.list(0).unwrap();
    assert_eq!(
        *repo.requested_limit.lock().unwrap(),
        Some(DEFAULT_AUDIT_LIMIT)
    );

    service.list(MAX_AUDIT_LIMIT * 10).unwrap();
    assert_eq!(*repo.requested_limit.lock().unwrap(), Some(MAX_AUDIT_LIMIT));

    service.list(7).unwrap();
    assert_eq!(*repo.requested_limit.lock().unwrap(), Some(7));
}

#[test]
fn service_records_valid_entry() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());

    let logged = service
        .log(NewAuditEntry {
            actor_id: None,
            actor_login: "anonymous".into(),
            action: "POST".into(),
            entity: "auth/login".into(),
            entity_id: None,
            status: 403,
            ip: Some("198.51.100.4".into()),
            details: Some("invalid credentials".into()),
        })
        .unwrap();

    assert_eq!(*repo.requested_limit.lock().unwrap(), None);
    let entries = repo.entries.lock().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, logged.id);
    assert_eq!(entries[0].status, 403);
}

#[test]
fn service_rejects_incomplete_entry() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());

    let mut invalid = entry(base(), "POST");
    invalid.actor_login = "  ".into();
    assert!(service.record(invalid).is_err());
    assert!(repo.entries.lock().unwrap().is_empty());

    let mut invalid = entry(base(), "POST");
    invalid.entity.clear();
    assert!(service.record(invalid).is_err());

    let mut invalid = entry(base(), "POST");
    invalid.action.clear();
    assert!(service.record(invalid).is_err());
}

#[test]
fn keys_sort_chronologically_within_a_second() {
    let early = entry(base() + Duration::microseconds(1), "POST");
    let late = entry(base() + Duration::microseconds(900), "POST");
    assert!(
        awg_audit::infrastructure::audit_key(&early) < awg_audit::infrastructure::audit_key(&late)
    );
}

fn custom(
    at: chrono::DateTime<Utc>,
    action: &str,
    entity: &str,
    actor: &str,
    status: u16,
) -> AuditEntry {
    AuditEntry {
        actor_login: actor.into(),
        entity: entity.into(),
        status,
        ..entry(at, action)
    }
}

fn seeded() -> (RedbAuditRepository, Vec<AuditEntry>) {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let repo = RedbAuditRepository::new(store);
    let entries = vec![
        custom(base(), "POST", "devices", "Admin", 201),
        custom(
            base() + Duration::seconds(10),
            "PATCH",
            "devices",
            "operator",
            200,
        ),
        custom(
            base() + Duration::seconds(20),
            "POST",
            "users",
            "superadmin",
            201,
        ),
        custom(
            base() + Duration::seconds(30),
            "DELETE",
            "tariffs",
            "admin-2",
            204,
        ),
    ];
    for entry in &entries {
        repo.record(entry).unwrap();
    }
    (repo, entries)
}

fn ids(page: &AuditPage) -> Vec<Uuid> {
    page.items.iter().map(|item| item.id).collect()
}

#[test]
fn repository_filters_by_action_entity_status() {
    let (repo, entries) = seeded();

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                action: Some("POST".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[2].id, entries[0].id]);
    assert!(page.next_cursor.is_none());

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                entity: Some("tariffs".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[3].id]);

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                status: Some(200),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[1].id]);

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                status: Some(201),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[2].id, entries[0].id]);
}

#[test]
fn repository_filters_actor_case_insensitively() {
    let (repo, entries) = seeded();

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                actor: Some("ADMIN".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        ids(&page),
        vec![entries[3].id, entries[2].id, entries[0].id]
    );

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                actor: Some("RATOR".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[1].id]);
}

#[test]
fn repository_filters_by_inclusive_time_range() {
    let (repo, entries) = seeded();

    let from = (base() + Duration::seconds(10)).timestamp();
    let to = (base() + Duration::seconds(20)).timestamp();
    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                from: Some(from),
                to: Some(to),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[2].id, entries[1].id]);

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                from: Some(from),
                to: Some(from),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(ids(&page), vec![entries[1].id]);

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                from: Some((base() + Duration::days(1)).timestamp()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                to: Some((base() - Duration::seconds(1)).timestamp()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(page.items.is_empty());
}

#[test]
fn repository_combines_filters_with_cursor() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let repo = RedbAuditRepository::new(store);

    let mut posts = Vec::new();
    for index in 0..5 {
        let entry = custom(
            base() + Duration::seconds(index),
            "POST",
            "devices",
            "admin",
            201,
        );
        repo.record(&entry).unwrap();
        posts.push(entry);
    }
    let other = custom(
        base() + Duration::seconds(2),
        "PATCH",
        "devices",
        "admin",
        200,
    );
    repo.record(&other).unwrap();

    let filter = AuditFilter {
        action: Some("POST".into()),
        entity: Some("devices".into()),
        ..Default::default()
    };

    let first = repo.list_page_filtered(2, None, &filter).unwrap();
    assert_eq!(ids(&first), vec![posts[4].id, posts[3].id]);
    assert_eq!(
        first.next_cursor.as_deref(),
        Some(awg_audit::infrastructure::audit_key(&posts[3]).as_str())
    );

    let second = repo
        .list_page_filtered(2, first.next_cursor.as_deref(), &filter)
        .unwrap();
    assert_eq!(ids(&second), vec![posts[2].id, posts[1].id]);
    assert!(second.next_cursor.is_some());

    let third = repo
        .list_page_filtered(2, second.next_cursor.as_deref(), &filter)
        .unwrap();
    assert_eq!(ids(&third), vec![posts[0].id]);
    assert!(third.next_cursor.is_none());
}

#[test]
fn repository_filter_without_matches_returns_empty_page() {
    let (repo, _) = seeded();

    let page = repo
        .list_page_filtered(
            10,
            None,
            &AuditFilter {
                action: Some("PUT".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(page.items.is_empty());
    assert!(page.next_cursor.is_none());
}

#[test]
fn repository_rejects_invalid_cursor_with_filter() {
    let (repo, _) = seeded();
    assert!(
        repo.list_page_filtered(10, Some("nope"), &AuditFilter::default())
            .is_err()
    );
}

#[test]
fn service_rejects_inverted_time_range() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());

    let filter = AuditFilter {
        from: Some(20),
        to: Some(10),
        ..Default::default()
    };
    assert!(service.list_page_filtered(10, None, &filter).is_err());
    assert!(repo.requested_limit.lock().unwrap().is_none());
}

#[test]
fn service_clamps_limit_with_filter() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());

    service
        .list_page_filtered(0, None, &AuditFilter::default())
        .unwrap();
    assert_eq!(
        *repo.requested_limit.lock().unwrap(),
        Some(DEFAULT_AUDIT_LIMIT)
    );

    service
        .list_page_filtered(MAX_AUDIT_LIMIT * 10, None, &AuditFilter::default())
        .unwrap();
    assert_eq!(*repo.requested_limit.lock().unwrap(), Some(MAX_AUDIT_LIMIT));
}

fn remaining_ids(repo: &RedbAuditRepository) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = repo.list(100).unwrap().iter().map(|item| item.id).collect();
    ids.sort();
    ids
}

fn sorted(entries: &[&AuditEntry]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = entries.iter().map(|entry| entry.id).collect();
    ids.sort();
    ids
}

#[test]
fn repository_delete_filtered_by_action() {
    let (repo, entries) = seeded();

    let deleted = repo
        .delete_filtered(&AuditFilter {
            action: Some("POST".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(deleted, 2);
    assert_eq!(remaining_ids(&repo), sorted(&[&entries[1], &entries[3]]));
}

#[test]
fn repository_delete_filtered_by_entity() {
    let (repo, entries) = seeded();

    let deleted = repo
        .delete_filtered(&AuditFilter {
            entity: Some("devices".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(deleted, 2);
    assert_eq!(remaining_ids(&repo), sorted(&[&entries[2], &entries[3]]));
}

#[test]
fn repository_delete_filtered_by_actor_case_insensitively() {
    let (repo, entries) = seeded();

    let deleted = repo
        .delete_filtered(&AuditFilter {
            actor: Some("ADMIN".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(deleted, 3);
    assert_eq!(remaining_ids(&repo), sorted(&[&entries[1]]));
}

#[test]
fn repository_delete_filtered_by_status() {
    let (repo, entries) = seeded();

    let deleted = repo
        .delete_filtered(&AuditFilter {
            status: Some(200),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(deleted, 1);
    assert_eq!(
        remaining_ids(&repo),
        sorted(&[&entries[0], &entries[2], &entries[3]])
    );
}

#[test]
fn repository_delete_filtered_by_time_range() {
    let (repo, entries) = seeded();

    let from = (base() + Duration::seconds(10)).timestamp();
    let to = (base() + Duration::seconds(20)).timestamp();
    let deleted = repo
        .delete_filtered(&AuditFilter {
            from: Some(from),
            to: Some(to),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(deleted, 2);
    assert_eq!(remaining_ids(&repo), sorted(&[&entries[0], &entries[3]]));
}

#[test]
fn repository_delete_filtered_empty_filter_removes_everything() {
    let (repo, _) = seeded();

    let deleted = repo.delete_filtered(&AuditFilter::default()).unwrap();

    assert_eq!(deleted, 4);
    assert!(repo.list(10).unwrap().is_empty());
    assert_eq!(
        repo.list_page_filtered(10, None, &AuditFilter::default())
            .unwrap()
            .items
            .len(),
        0
    );
}

#[test]
fn repository_delete_filtered_without_matches_keeps_entries() {
    let (repo, entries) = seeded();

    let deleted = repo
        .delete_filtered(&AuditFilter {
            action: Some("PUT".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(deleted, 0);
    assert_eq!(
        remaining_ids(&repo),
        sorted(&[&entries[0], &entries[1], &entries[2], &entries[3]])
    );
}

#[test]
fn service_delete_filtered_delegates_validated_filter() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());
    let entry = entry(base(), "POST");
    repo.record(&entry).unwrap();

    let filter = AuditFilter {
        action: Some("POST".into()),
        ..Default::default()
    };
    let deleted = service.delete_filtered(&filter).unwrap();

    assert_eq!(deleted, 1);
    assert_eq!(*repo.deleted_filters.lock().unwrap(), vec![filter]);
    assert!(repo.entries.lock().unwrap().is_empty());
}

#[test]
fn service_delete_filtered_rejects_inverted_range() {
    let repo = Arc::new(RecordingRepository::new());
    let service = AuditService::new(repo.clone());

    let filter = AuditFilter {
        from: Some(20),
        to: Some(10),
        ..Default::default()
    };

    assert!(service.delete_filtered(&filter).is_err());
    assert!(repo.deleted_filters.lock().unwrap().is_empty());
}
