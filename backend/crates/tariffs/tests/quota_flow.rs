use std::sync::Arc;

use uuid::Uuid;

use awg_storage::Store;
use awg_tariffs::{NewTariff, QuotaState, RedbTariffRepository, TariffService};

fn service() -> TariffService {
    let store = Arc::new(Store::open_in_memory().unwrap());
    TariffService::new(Arc::new(RedbTariffRepository::new(store)))
}

fn tariff(service: &TariffService, quota: Option<u64>) -> Uuid {
    service
        .create(NewTariff {
            name: format!("plan-{}", Uuid::new_v4()),
            description: String::new(),
            max_devices: 5,
            device_down_kbps: 100_000,
            device_up_kbps: 50_000,
            group_down_kbps: 200_000,
            group_up_kbps: 100_000,
            traffic_quota_bytes: quota,
        })
        .unwrap()
        .id
}

#[test]
fn quota_state_without_tariff_is_unlimited() {
    let service = service();
    let state = service.quota_state_for(None, 42).unwrap();
    assert_eq!(
        state,
        QuotaState {
            used_bytes: 42,
            quota_bytes: None,
            exceeded: false,
            remaining_bytes: None,
            percent: None,
        }
    );
}

#[test]
fn quota_state_uses_tariff_quota() {
    let service = service();
    let id = tariff(&service, Some(1000));
    let state = service.quota_state_for(Some(id), 500).unwrap();
    assert_eq!(state.quota_bytes, Some(1000));
    assert_eq!(state.percent, Some(50.0));
    assert_eq!(state.remaining_bytes, Some(500));
    assert!(!state.exceeded);
}

#[test]
fn quota_state_for_missing_tariff_is_unlimited() {
    let service = service();
    let state = service.quota_state_for(Some(Uuid::new_v4()), 9000).unwrap();
    assert_eq!(state.quota_bytes, None);
    assert_eq!(state.used_bytes, 9000);
    assert!(!state.exceeded);
}

#[test]
fn quota_state_for_tariff_without_quota_is_unlimited() {
    let service = service();
    let id = tariff(&service, None);
    let state = service.quota_state_for(Some(id), 9000).unwrap();
    assert_eq!(state.quota_bytes, None);
    assert!(!state.exceeded);
}

#[test]
fn tariff_persists_quota_bytes() {
    let service = service();
    let id = tariff(&service, Some(5_000));
    let found = service.get(id).unwrap();
    assert_eq!(found.traffic_quota_bytes, Some(5_000));
}
