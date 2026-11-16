use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use awg_statistics::{
    CounterSample, DeviceDirectory, RedbStatsRepository, StatsHub, StatsScope, StatsService,
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
    group_id: Uuid,
    user_id: Uuid,
    interface_id: Uuid,
    device_id: Uuid,
}

fn fixture() -> Fixture {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let hub = Arc::new(StatsHub::new(64));
    let service = StatsService::new(Arc::new(RedbStatsRepository::new(store)), hub);
    Fixture {
        service,
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
