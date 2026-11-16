use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use awg_statistics::{
    AggregateBucket, Aggregator, CounterSample, DailyBucket, DeviceDirectory, MonthlyBucket,
    RedbStatsRepository, StatsHub, StatsRepository, StatsScope, StatsService,
};
use awg_storage::Store;

struct Directory {
    group_id: Uuid,
    user_id: Uuid,
}

impl DeviceDirectory for Directory {
    fn group_and_user(&self, _device_id: Uuid) -> awg_shared::CoreResult<Option<(Uuid, Uuid)>> {
        Ok(Some((self.group_id, self.user_id)))
    }
}

struct Fixture {
    service: StatsService,
    repo: Arc<RedbStatsRepository>,
    group_id: Uuid,
    user_id: Uuid,
    interface_id: Uuid,
    device_id: Uuid,
}

fn fixture() -> Fixture {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let hub = Arc::new(StatsHub::new(64));
    let repo = Arc::new(RedbStatsRepository::new(store));
    let service = StatsService::new(repo.clone(), hub);
    Fixture {
        service,
        repo,
        group_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        interface_id: Uuid::new_v4(),
        device_id: Uuid::new_v4(),
    }
}

fn directory(fixture: &Fixture) -> Directory {
    Directory {
        group_id: fixture.group_id,
        user_id: fixture.user_id,
    }
}

fn utc(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

fn add(fixture: &Fixture, scope: StatsScope, at: &str, rx: u64, tx: u64) {
    fixture
        .repo
        .add_bucket(scope, Aggregator::hour_of(utc(at)), rx, tx)
        .unwrap();
}

#[test]
fn accumulates_deltas_and_resets() {
    let fixture = fixture();
    let directory = directory(&fixture);
    let node_id = Uuid::new_v4();

    fixture
        .service
        .record_snapshot(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    rx_total: 100,
                    tx_total: 200,
                },
            )],
            &directory,
        )
        .unwrap();

    fixture
        .service
        .record_snapshot(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    rx_total: 150,
                    tx_total: 260,
                },
            )],
            &directory,
        )
        .unwrap();

    let (rx, tx) = fixture
        .service
        .today(StatsScope::Device(fixture.device_id))
        .unwrap();
    assert_eq!((rx, tx), (150, 260));

    fixture
        .service
        .record_snapshot(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    rx_total: 10,
                    tx_total: 20,
                },
            )],
            &directory,
        )
        .unwrap();

    let (rx, tx) = fixture
        .service
        .today(StatsScope::Device(fixture.device_id))
        .unwrap();
    assert_eq!((rx, tx), (160, 280));

    let (user_rx, user_tx) = fixture
        .service
        .today(StatsScope::User(fixture.user_id))
        .unwrap();
    assert_eq!((user_rx, user_tx), (160, 280));

    let (global_rx, _) = fixture.service.today(StatsScope::Global).unwrap();
    assert_eq!(global_rx, 160);
}

#[test]
fn series_returns_hourly_buckets() {
    let fixture = fixture();
    let directory = directory(&fixture);
    fixture
        .service
        .record_snapshot(
            Uuid::new_v4(),
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    rx_total: 1_000,
                    tx_total: 2_000,
                },
            )],
            &directory,
        )
        .unwrap();

    let now = Utc::now();
    let series = fixture
        .service
        .series(
            StatsScope::Device(fixture.device_id),
            now - chrono::Duration::hours(1),
            now + chrono::Duration::hours(1),
        )
        .unwrap();
    assert_eq!(series.len(), 1);
    assert_eq!(series[0].rx, 1_000);
    assert_eq!(series[0].tx, 2_000);
}

#[test]
fn daily_aggregates_across_day_boundaries() {
    let fixture = fixture();
    let scope = StatsScope::User(fixture.user_id);
    add(&fixture, scope, "2026-03-01T23:00:00Z", 10, 1);
    add(&fixture, scope, "2026-03-02T00:00:00Z", 20, 2);
    add(&fixture, scope, "2026-03-02T23:00:00Z", 5, 3);

    let buckets = fixture
        .service
        .daily(
            scope,
            utc("2026-03-01T00:00:00Z"),
            utc("2026-03-02T23:59:59Z"),
        )
        .unwrap();
    assert_eq!(
        buckets,
        vec![
            DailyBucket {
                day: utc("2026-03-01T00:00:00Z").timestamp(),
                rx: 10,
                tx: 1,
            },
            DailyBucket {
                day: utc("2026-03-02T00:00:00Z").timestamp(),
                rx: 25,
                tx: 5,
            },
        ]
    );
}

#[test]
fn monthly_aggregates_across_month_boundaries() {
    let fixture = fixture();
    let scope = StatsScope::Global;
    add(&fixture, scope, "2026-01-31T23:00:00Z", 7, 1);
    add(&fixture, scope, "2026-02-01T00:00:00Z", 11, 2);
    add(&fixture, scope, "2026-02-28T23:00:00Z", 13, 3);
    add(&fixture, scope, "2026-03-01T00:00:00Z", 1, 4);

    let buckets = fixture
        .service
        .monthly(
            scope,
            utc("2026-01-01T00:00:00Z"),
            utc("2026-03-01T00:00:00Z"),
        )
        .unwrap();
    assert_eq!(
        buckets,
        vec![
            MonthlyBucket {
                month: "2026-01".into(),
                rx: 7,
                tx: 1,
            },
            MonthlyBucket {
                month: "2026-02".into(),
                rx: 24,
                tx: 5,
            },
            MonthlyBucket {
                month: "2026-03".into(),
                rx: 1,
                tx: 4,
            },
        ]
    );
}

#[test]
fn aggregation_of_empty_range_is_empty() {
    let fixture = fixture();
    let from = utc("2026-05-01T00:00:00Z");
    let to = utc("2026-05-31T23:00:00Z");
    assert!(
        fixture
            .service
            .daily(StatsScope::Global, from, to)
            .unwrap()
            .is_empty()
    );
    assert!(
        fixture
            .service
            .monthly(StatsScope::Global, from, to)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn aggregation_rejects_inverted_and_too_long_ranges() {
    let fixture = fixture();
    let from = utc("2026-01-01T00:00:00Z");
    assert!(
        fixture
            .service
            .daily(StatsScope::Global, from, from - Duration::hours(1))
            .is_err()
    );
    assert!(
        fixture
            .service
            .daily(StatsScope::Global, from, from + Duration::days(367))
            .is_err()
    );
    assert!(
        fixture
            .service
            .daily(StatsScope::Global, from, from + Duration::days(366))
            .is_ok()
    );
    assert!(
        fixture
            .service
            .monthly(StatsScope::Global, from, from + Duration::days(3_661))
            .is_err()
    );
    assert!(
        fixture
            .service
            .monthly(StatsScope::Global, from, from + Duration::days(3_660))
            .is_ok()
    );
}

#[test]
fn parses_supported_aggregate_buckets_only() {
    assert_eq!(AggregateBucket::parse("day"), Some(AggregateBucket::Day));
    assert_eq!(
        AggregateBucket::parse("month"),
        Some(AggregateBucket::Month)
    );
    assert_eq!(AggregateBucket::parse("week"), None);
    assert_eq!(AggregateBucket::parse("DAY"), None);
}

#[test]
fn cleanup_removes_old_buckets() {
    let fixture = fixture();
    let directory = directory(&fixture);
    fixture
        .service
        .record_snapshot(
            Uuid::new_v4(),
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    rx_total: 10,
                    tx_total: 20,
                },
            )],
            &directory,
        )
        .unwrap();
    let removed = fixture.service.cleanup(-1).unwrap();
    assert!(removed > 0);
}

#[test]
fn cleanup_applies_given_retention_window() {
    let fixture = fixture();
    let scope = StatsScope::Global;
    let old = Utc::now() - Duration::days(10);
    fixture
        .repo
        .add_bucket(scope, Aggregator::hour_of(old), 5, 5)
        .unwrap();

    assert_eq!(fixture.service.cleanup(30).unwrap(), 0);
    assert_eq!(fixture.service.cleanup(7).unwrap(), 1);
    assert!(
        fixture
            .service
            .series(scope, old - Duration::hours(1), old + Duration::hours(1))
            .unwrap()
            .is_empty()
    );
}
