use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use awg_statistics::{
    AggregateBucket, Aggregator, CounterSample, DailyBucket, DeviceDirectory, MonthlyBucket, Rate,
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

struct BatchDirectory {
    group_id: Uuid,
    user_id: Uuid,
    batch_calls: AtomicUsize,
    single_calls: AtomicUsize,
}

impl DeviceDirectory for BatchDirectory {
    fn group_and_user(&self, _device_id: Uuid) -> awg_shared::CoreResult<Option<(Uuid, Uuid)>> {
        self.single_calls.fetch_add(1, Ordering::SeqCst);
        Ok(Some((self.group_id, self.user_id)))
    }

    fn group_and_user_many(
        &self,
        device_ids: &[Uuid],
    ) -> awg_shared::CoreResult<std::collections::HashMap<Uuid, (Uuid, Uuid)>> {
        self.batch_calls.fetch_add(1, Ordering::SeqCst);
        Ok(device_ids
            .iter()
            .map(|id| (*id, (self.group_id, self.user_id)))
            .collect())
    }
}

struct Fixture {
    service: StatsService,
    repo: Arc<RedbStatsRepository>,
    group_id: Uuid,
    user_id: Uuid,
    interface_id: Uuid,
    device_id: Uuid,
    peer_id: Uuid,
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
        peer_id: Uuid::new_v4(),
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
                    peer_id: fixture.peer_id,
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
                    peer_id: fixture.peer_id,
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
                    peer_id: fixture.peer_id,
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
fn multiple_peers_per_device_keep_independent_deltas() {
    let fixture = fixture();
    let directory = directory(&fixture);
    let node_id = Uuid::new_v4();
    let peer_a = Uuid::new_v4();
    let peer_b = Uuid::new_v4();
    let at = Utc::now();

    let sample = |peer_id, rx_total, tx_total| CounterSample {
        peer_id,
        rx_total,
        tx_total,
    };

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[
                (fixture.device_id, sample(peer_a, 100, 200)),
                (fixture.device_id, sample(peer_b, 50, 60)),
            ],
            &directory,
            at,
        )
        .unwrap();

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[
                (fixture.device_id, sample(peer_b, 70, 80)),
                (fixture.device_id, sample(peer_a, 130, 240)),
            ],
            &directory,
            at + Duration::seconds(10),
        )
        .unwrap();

    assert_eq!(
        fixture
            .service
            .today(StatsScope::Device(fixture.device_id))
            .unwrap(),
        (200, 320)
    );
    assert_eq!(
        fixture
            .service
            .today(StatsScope::User(fixture.user_id))
            .unwrap(),
        (200, 320)
    );
    assert_eq!(
        fixture
            .service
            .today(StatsScope::Interface(fixture.interface_id))
            .unwrap(),
        (200, 320)
    );

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[(fixture.device_id, sample(peer_a, 140, 250))],
            &directory,
            at + Duration::seconds(20),
        )
        .unwrap();
    assert_eq!(
        fixture
            .service
            .today(StatsScope::Device(fixture.device_id))
            .unwrap(),
        (210, 330)
    );

    assert_eq!(fixture.repo.write_transaction_count(), 3);
}

#[test]
fn snapshot_write_transactions_do_not_grow_with_the_number_of_peers() {
    let fixture = fixture();
    let directory = directory(&fixture);
    let node_id = Uuid::new_v4();
    let at = Utc::now();

    let small = [(
        fixture.device_id,
        CounterSample {
            peer_id: Uuid::new_v4(),
            rx_total: 10,
            tx_total: 20,
        },
    )];
    fixture
        .service
        .record_snapshot_at(node_id, fixture.interface_id, &small, &directory, at)
        .unwrap();
    assert_eq!(fixture.repo.write_transaction_count(), 1);

    let mut many = Vec::new();
    for index in 0..32u64 {
        many.push((
            fixture.device_id,
            CounterSample {
                peer_id: Uuid::new_v4(),
                rx_total: 100 + index,
                tx_total: 200 + index,
            },
        ));
    }
    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &many,
            &directory,
            at + Duration::seconds(1),
        )
        .unwrap();

    assert_eq!(
        fixture.repo.write_transaction_count(),
        2,
        "one write transaction per snapshot regardless of peer count"
    );
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
                    peer_id: fixture.peer_id,
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
                    peer_id: fixture.peer_id,
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

#[test]
fn rate_uses_two_latest_snapshots() {
    let fixture = fixture();
    let directory = directory(&fixture);
    let node_id = Uuid::new_v4();
    let start = utc("2026-04-01T00:00:00Z");

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    peer_id: fixture.peer_id,
                    rx_total: 1_000,
                    tx_total: 2_000,
                },
            )],
            &directory,
            start,
        )
        .unwrap();

    assert_eq!(
        fixture
            .service
            .current_rate(&StatsScope::Device(fixture.device_id)),
        None
    );

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    peer_id: fixture.peer_id,
                    rx_total: 3_000,
                    tx_total: 4_000,
                },
            )],
            &directory,
            start + Duration::seconds(10),
        )
        .unwrap();

    let rate = fixture
        .service
        .current_rate(&StatsScope::Device(fixture.device_id))
        .unwrap();
    assert_eq!(
        rate,
        Rate {
            rx_bps: 200.0,
            tx_bps: 200.0,
        }
    );

    let global = fixture.service.current_rate(&StatsScope::Global).unwrap();
    assert_eq!(
        global,
        Rate {
            rx_bps: 200.0,
            tx_bps: 200.0,
        }
    );
}

#[test]
fn rate_is_none_for_zero_interval() {
    let fixture = fixture();
    let directory = directory(&fixture);
    let node_id = Uuid::new_v4();
    let at = utc("2026-04-01T00:00:00Z");

    for totals in [1_000u64, 2_000] {
        fixture
            .service
            .record_snapshot_at(
                node_id,
                fixture.interface_id,
                &[(
                    fixture.device_id,
                    CounterSample {
                        peer_id: fixture.peer_id,
                        rx_total: totals,
                        tx_total: totals,
                    },
                )],
                &directory,
                at,
            )
            .unwrap();
    }

    assert_eq!(
        fixture
            .service
            .current_rate(&StatsScope::Device(fixture.device_id)),
        None
    );
}

#[test]
fn rate_is_zero_when_counters_decrease() {
    let fixture = fixture();
    let directory = directory(&fixture);
    let node_id = Uuid::new_v4();
    let start = utc("2026-04-01T00:00:00Z");

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    peer_id: fixture.peer_id,
                    rx_total: 10_000,
                    tx_total: 20_000,
                },
            )],
            &directory,
            start,
        )
        .unwrap();

    fixture
        .service
        .record_snapshot_at(
            node_id,
            fixture.interface_id,
            &[(
                fixture.device_id,
                CounterSample {
                    peer_id: fixture.peer_id,
                    rx_total: 100,
                    tx_total: 200,
                },
            )],
            &directory,
            start + Duration::seconds(60),
        )
        .unwrap();

    assert_eq!(
        fixture
            .service
            .current_rate(&StatsScope::Device(fixture.device_id)),
        Some(Rate::ZERO)
    );
}

#[test]
fn rate_is_none_without_snapshots() {
    let fixture = fixture();
    assert_eq!(fixture.service.current_rate(&StatsScope::Global), None);
    assert_eq!(
        fixture
            .service
            .current_rate(&StatsScope::Device(fixture.device_id)),
        None
    );
}

#[test]
fn series_reports_rates_for_sorted_adjacent_buckets() {
    let fixture = fixture();
    let scope = StatsScope::User(fixture.user_id);
    add(&fixture, scope, "2026-06-01T03:00:00Z", 10_800, 3_600);
    add(&fixture, scope, "2026-06-01T01:00:00Z", 3_600, 7_200);
    add(&fixture, scope, "2026-06-01T02:00:00Z", 7_200, 0);

    let points = fixture
        .service
        .series_with_rates(
            scope,
            utc("2026-06-01T00:30:00Z"),
            utc("2026-06-01T03:30:00Z"),
        )
        .unwrap();

    assert_eq!(points.len(), 3);
    assert_eq!(
        points
            .iter()
            .map(|point| point.bucket.hour)
            .collect::<Vec<_>>(),
        vec![
            Aggregator::hour_of(utc("2026-06-01T01:00:00Z")),
            Aggregator::hour_of(utc("2026-06-01T02:00:00Z")),
            Aggregator::hour_of(utc("2026-06-01T03:00:00Z")),
        ]
    );
    assert_eq!(points[0].rate, Rate::ZERO);
    assert_eq!(
        points[1].rate,
        Rate {
            rx_bps: 2.0,
            tx_bps: 0.0,
        }
    );
    assert_eq!(
        points[2].rate,
        Rate {
            rx_bps: 3.0,
            tx_bps: 1.0,
        }
    );
}

#[test]
fn device_totals_are_collected_in_a_single_scan() {
    let fixture = fixture();
    let other_device = Uuid::new_v4();
    let hour = Aggregator::hour_of(Utc::now());
    fixture
        .repo
        .add_bucket(StatsScope::Device(fixture.device_id), hour, 10, 20)
        .unwrap();
    fixture
        .repo
        .add_bucket(StatsScope::Device(other_device), hour, 3, 4)
        .unwrap();
    fixture
        .repo
        .add_bucket(StatsScope::Global, hour, 99, 99)
        .unwrap();
    fixture
        .repo
        .add_bucket(StatsScope::Device(fixture.device_id), hour - 86_400, 50, 50)
        .unwrap();

    let totals = fixture.service.today_device_totals().unwrap();

    assert_eq!(totals.get(&fixture.device_id).copied(), Some((10, 20)));
    assert_eq!(totals.get(&other_device).copied(), Some((3, 4)));
    assert_eq!(totals.len(), 2);
    assert_eq!(fixture.repo.device_scan_count(), 1);
}

#[test]
fn snapshot_directory_resolves_all_devices_in_one_batch() {
    let fixture = fixture();
    let directory = BatchDirectory {
        group_id: fixture.group_id,
        user_id: fixture.user_id,
        batch_calls: AtomicUsize::new(0),
        single_calls: AtomicUsize::new(0),
    };
    let second_device = Uuid::new_v4();
    let node_id = Uuid::new_v4();
    let samples = [
        (
            fixture.interface_id,
            fixture.device_id,
            CounterSample {
                peer_id: fixture.peer_id,
                rx_total: 10,
                tx_total: 20,
            },
        ),
        (
            fixture.interface_id,
            second_device,
            CounterSample {
                peer_id: Uuid::new_v4(),
                rx_total: 5,
                tx_total: 6,
            },
        ),
    ];

    fixture
        .service
        .record_node_snapshot(node_id, &samples, &directory)
        .unwrap();

    assert_eq!(directory.batch_calls.load(Ordering::SeqCst), 1);
    assert_eq!(directory.single_calls.load(Ordering::SeqCst), 0);
    let (rx, tx) = fixture
        .service
        .today(StatsScope::Device(second_device))
        .unwrap();
    assert_eq!((rx, tx), (5, 6));
}
