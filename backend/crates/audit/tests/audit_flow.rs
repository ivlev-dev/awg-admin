use std::sync::{Arc, Mutex};

use chrono::{Duration, TimeZone, Utc};
use uuid::Uuid;

use awg_audit::{
    AuditEntry, AuditPage, AuditRepository, AuditService, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT,
    NewAuditEntry, RedbAuditRepository,
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
}

impl RecordingRepository {
    fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            requested_limit: Mutex::new(None),
        }
    }
}

impl AuditRepository for RecordingRepository {
    fn record(&self, entry: &AuditEntry) -> CoreResult<()> {
        self.entries.lock().unwrap().push(entry.clone());
        Ok(())
    }

    fn list_page(&self, limit: usize, _before: Option<&str>) -> CoreResult<AuditPage> {
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
