use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{Duration, TimeZone, Utc};
use uuid::Uuid;

use awg_clients::domain::DeviceRepository;
use awg_clients::{
    Device, DevicePageOrder, DevicePageQuery, DevicePageSort, DevicePageStatus, Forwarding,
    RedbDeviceRepository,
};
use awg_storage::Store;

fn repo() -> RedbDeviceRepository {
    RedbDeviceRepository::new(Arc::new(Store::open_in_memory().unwrap()))
}

fn device(
    user_id: Uuid,
    group_id: Uuid,
    interface_id: Uuid,
    name: &str,
    created_offset: i64,
    revoked: bool,
) -> Device {
    let created =
        Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap() + Duration::seconds(created_offset);
    Device {
        id: Uuid::new_v4(),
        user_id,
        group_id,
        interface_id,
        name: name.into(),
        down_kbps: 0,
        up_kbps: 0,
        forwarding: Forwarding::default(),
        revoked,
        external: false,
        created_at: created,
        updated_at: created,
    }
}

fn query() -> DevicePageQuery {
    DevicePageQuery {
        limit: 50,
        offset: 0,
        q: None,
        status: DevicePageStatus::All,
        interface_id: None,
        user_id: None,
        sort: DevicePageSort::Name,
        order: DevicePageOrder::Asc,
        owner_emails: HashMap::new(),
    }
}

fn seed(repo: &RedbDeviceRepository, items: &[Device]) {
    for item in items {
        repo.save(item).unwrap();
    }
}

fn names(page: &awg_clients::DevicePage) -> Vec<&str> {
    page.items.iter().map(|item| item.name.as_str()).collect()
}

#[test]
fn page_sorts_by_name_and_reports_total() {
    let repo = repo();
    let user = Uuid::new_v4();
    let group = Uuid::new_v4();
    let interface = Uuid::new_v4();
    let items = [
        device(user, group, interface, "banana", 4, false),
        device(user, group, interface, "Apple", 1, false),
        device(user, group, interface, "cherry", 5, false),
        device(user, group, interface, "delta", 2, false),
        device(user, group, interface, "Echo", 3, false),
    ];
    seed(&repo, &items);

    let page = repo.page(&query()).unwrap();
    assert_eq!(page.total, 5);
    assert_eq!(page.limit, 50);
    assert_eq!(page.offset, 0);
    assert_eq!(
        names(&page),
        vec!["Apple", "banana", "cherry", "delta", "Echo"]
    );

    let mut descending = query();
    descending.order = DevicePageOrder::Desc;
    let page = repo.page(&descending).unwrap();
    assert_eq!(
        names(&page),
        vec!["Echo", "delta", "cherry", "banana", "Apple"]
    );
}

#[test]
fn page_sorts_by_created_at() {
    let repo = repo();
    let user = Uuid::new_v4();
    let group = Uuid::new_v4();
    let interface = Uuid::new_v4();
    let items = [
        device(user, group, interface, "third", 30, false),
        device(user, group, interface, "first", 10, false),
        device(user, group, interface, "second", 20, false),
    ];
    seed(&repo, &items);

    let mut created = query();
    created.sort = DevicePageSort::Created;
    let page = repo.page(&created).unwrap();
    assert_eq!(names(&page), vec!["first", "second", "third"]);

    created.order = DevicePageOrder::Desc;
    let page = repo.page(&created).unwrap();
    assert_eq!(names(&page), vec!["third", "second", "first"]);
}

#[test]
fn page_windows_do_not_overlap_and_empty_pages_are_reported() {
    let repo = repo();
    let user = Uuid::new_v4();
    let group = Uuid::new_v4();
    let interface = Uuid::new_v4();
    let items: Vec<Device> = (0..10)
        .map(|index| {
            device(
                user,
                group,
                interface,
                &format!("dev-{index:02}"),
                index,
                false,
            )
        })
        .collect();
    seed(&repo, &items);

    let mut seen = HashSet::new();
    for offset in [0usize, 3, 6, 9] {
        let mut query = query();
        query.limit = 3;
        query.offset = offset;
        let page = repo.page(&query).unwrap();
        assert_eq!(page.total, 10);
        for item in &page.items {
            assert!(seen.insert(item.id), "page {offset} repeated an item");
        }
    }
    assert_eq!(seen.len(), 10);

    let mut beyond = query();
    beyond.offset = 100;
    let page = repo.page(&beyond).unwrap();
    assert!(page.items.is_empty());
    assert_eq!(page.total, 10);
}

#[test]
fn page_filters_by_status_interface_user_and_query() {
    let repo = repo();
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();
    let group = Uuid::new_v4();
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    seed(
        &repo,
        &[
            device(alice, group, first, "Phone", 1, false),
            device(alice, group, second, "Laptop", 2, true),
            device(bob, group, second, "Tablet", 3, false),
        ],
    );

    let mut revoked = query();
    revoked.status = DevicePageStatus::Revoked;
    let page = repo.page(&revoked).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(names(&page), vec!["Laptop"]);

    let mut active = query();
    active.status = DevicePageStatus::Active;
    assert_eq!(repo.page(&active).unwrap().total, 2);

    let mut by_interface = query();
    by_interface.interface_id = Some(second);
    assert_eq!(repo.page(&by_interface).unwrap().total, 2);

    let mut by_user = query();
    by_user.user_id = Some(alice);
    assert_eq!(repo.page(&by_user).unwrap().total, 2);

    let mut search = query();
    search.q = DevicePageQuery::normalize_q(Some("PHO"));
    assert_eq!(repo.page(&search).unwrap().total, 1);

    let mut by_email = query();
    by_email.q = Some("bob".into());
    by_email.owner_emails = HashMap::from([(bob, "bob@example.com".into())]);
    let page = repo.page(&by_email).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(names(&page), vec!["Tablet"]);
}

#[test]
fn index_tracks_rename_revoke_and_delete() {
    let repo = repo();
    let user = Uuid::new_v4();
    let group = Uuid::new_v4();
    let interface = Uuid::new_v4();
    let mut item = device(user, group, interface, "Old", 7, false);
    repo.save(&item).unwrap();

    let mut search_old = query();
    search_old.q = DevicePageQuery::normalize_q(Some("old"));
    assert_eq!(repo.page(&search_old).unwrap().total, 1);

    item.name = "New".into();
    repo.save(&item).unwrap();

    let page = repo.page(&search_old).unwrap();
    assert_eq!(page.total, 0, "the old name must disappear from the index");
    assert!(page.items.is_empty());
    let mut search_new = query();
    search_new.q = DevicePageQuery::normalize_q(Some("new"));
    assert_eq!(repo.page(&search_new).unwrap().total, 1);

    let mut created = query();
    created.sort = DevicePageSort::Created;
    let page = repo.page(&created).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, item.id);

    item.revoked = true;
    repo.save(&item).unwrap();
    let mut active = query();
    active.status = DevicePageStatus::Active;
    assert_eq!(repo.page(&active).unwrap().total, 0);
    let mut revoked = query();
    revoked.status = DevicePageStatus::Revoked;
    assert_eq!(repo.page(&revoked).unwrap().total, 1);

    repo.delete(item.id).unwrap();
    assert_eq!(repo.page(&query()).unwrap().total, 0);
    assert_eq!(repo.page(&created).unwrap().total, 0);
    assert_eq!(repo.page(&search_new).unwrap().total, 0);
}

#[test]
#[ignore = "manual performance measurement"]
fn measure_paging_over_1k_and_10k() {
    use std::time::Instant;

    for total in [1_000usize, 10_000] {
        let repo = repo();
        let user = Uuid::new_v4();
        let group = Uuid::new_v4();
        let interface = Uuid::new_v4();
        let items: Vec<Device> = (0..total)
            .map(|index| {
                device(
                    user,
                    group,
                    interface,
                    &format!("client-{index:05}"),
                    index as i64,
                    index % 10 == 0,
                )
            })
            .collect();
        let seeded = Instant::now();
        for item in &items {
            repo.save(item).unwrap();
        }
        let seed_elapsed = seeded.elapsed();

        let mut timings = Vec::new();
        for offset in [0usize, total / 2, total - 50] {
            let mut search = query();
            search.limit = 50;
            search.offset = offset;
            let started = Instant::now();
            let page = repo.page(&search).unwrap();
            timings.push((offset, started.elapsed(), page.total));
            assert_eq!(page.items.len(), 50);
        }
        let mut filtered = query();
        filtered.limit = 50;
        filtered.status = DevicePageStatus::Active;
        filtered.q = DevicePageQuery::normalize_q(Some("client-0001"));
        let started = Instant::now();
        let page = repo.page(&filtered).unwrap();
        let filtered_elapsed = started.elapsed();
        println!(
            "devices={total} seed={seed_elapsed:?} pages={timings:?} filtered={filtered_elapsed:?} total={}",
            page.total
        );
    }
}

#[test]
fn pages_over_250_devices_are_disjoint_and_complete() {
    let repo = repo();
    let user = Uuid::new_v4();
    let group = Uuid::new_v4();
    let interface = Uuid::new_v4();
    let items: Vec<Device> = (0..250)
        .map(|index| {
            device(
                user,
                group,
                interface,
                &format!("client-{index:03}"),
                index,
                index % 10 == 0,
            )
        })
        .collect();
    seed(&repo, &items);

    let mut seen = HashSet::new();
    let mut total_pages = 0;
    for page_index in 0..5 {
        let mut query = query();
        query.limit = 50;
        query.offset = page_index * 50;
        let page = repo.page(&query).unwrap();
        assert_eq!(page.total, 250);
        assert_eq!(page.items.len(), 50);
        for item in &page.items {
            assert!(seen.insert(item.id));
        }
        total_pages += 1;
    }
    assert_eq!(total_pages, 5);
    assert_eq!(seen.len(), 250);

    let mut active = query();
    active.limit = 200;
    active.status = DevicePageStatus::Active;
    let page = repo.page(&active).unwrap();
    assert_eq!(page.total, 225);
    assert_eq!(page.items.len(), 200);
}
