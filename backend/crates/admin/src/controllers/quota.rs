use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use awg_identity::User;
use awg_shared::CoreResult;
use awg_statistics::StatsScope;
use awg_tariffs::{QuotaState, TariffService};

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::ApiResult;
use crate::state::AppState;
use crate::views::{QuotaUserView, QuotaView};

pub async fn current(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<QuotaView>> {
    let subject = quota_subject(&user);
    let identity = state.identity.clone();
    let stats = state.stats.clone();
    let tariffs = state.tariffs.clone();
    let view = blocking::run_api(move || {
        let account = identity.find(subject)?;
        let used = stats.used_bytes(StatsScope::User(subject))?;
        Ok(current_quota(&tariffs, &account, used, Utc::now())?)
    })
    .await?;
    Ok(Json(view))
}

pub async fn users(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<QuotaUserView>>> {
    let admin = user.is_admin();
    let caller_id = user.id();
    let identity = state.identity.clone();
    let stats = state.stats.clone();
    let tariffs = state.tariffs.clone();
    let items = blocking::run_api(move || {
        // A regular user only ever sees their own quota; the full list is
        // reserved for administrators.
        let accounts: Vec<User> = if admin {
            identity
                .list()?
                .into_iter()
                .filter(|account| account.tariff_id.is_some())
                .collect()
        } else {
            vec![identity.find(caller_id)?]
        };
        let scopes: Vec<StatsScope> = accounts
            .iter()
            .map(|account| StatsScope::User(account.id))
            .collect();
        let used = stats.used_bytes_many(&scopes)?;
        let mut items = Vec::with_capacity(accounts.len());
        for account in &accounts {
            let used = used
                .get(&StatsScope::User(account.id))
                .copied()
                .unwrap_or_default();
            items.push(user_quota(&tariffs, account, used)?);
        }
        items.sort_by(|left, right| {
            left.email
                .cmp(&right.email)
                .then_with(|| left.user_id.cmp(&right.user_id))
        });
        Ok(items)
    })
    .await?;
    Ok(Json(items))
}

fn quota_subject(user: &AuthUser) -> Uuid {
    user.id()
}

pub(crate) fn quota_state(
    tariffs: &TariffService,
    account: &User,
    used: u64,
) -> CoreResult<QuotaState> {
    tariffs.quota_state_for(account.tariff_id, used)
}

pub(crate) fn current_quota(
    tariffs: &TariffService,
    account: &User,
    used: u64,
    now: DateTime<Utc>,
) -> CoreResult<QuotaView> {
    let state = quota_state(tariffs, account, used)?;
    Ok(QuotaView::build(
        state,
        awg_tariffs::QuotaPeriod::for_month(now),
    ))
}

fn user_quota(tariffs: &TariffService, account: &User, used: u64) -> CoreResult<QuotaUserView> {
    let state = quota_state(tariffs, account, used)?;
    Ok(QuotaUserView::build(account.id, &account.email, state))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use chrono::TimeZone;
    use serde_json::json;

    use awg_identity::{AuthPrincipal, Role};
    use awg_storage::Store;
    use awg_tariffs::{NewTariff, RedbTariffRepository};

    use super::*;

    fn tariff_service(quota: Option<u64>) -> (TariffService, Option<Uuid>) {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let service = TariffService::new(Arc::new(RedbTariffRepository::new(store)));
        let tariff_id = quota.map(|quota| {
            service
                .create(NewTariff {
                    name: "plan".into(),
                    description: String::new(),
                    max_devices: 5,
                    device_down_kbps: 100_000,
                    device_up_kbps: 50_000,
                    group_down_kbps: 200_000,
                    group_up_kbps: 100_000,
                    traffic_quota_bytes: Some(quota),
                    interface_id: None,
                })
                .unwrap()
                .id
        });
        (service, tariff_id)
    }

    fn account(email: &str, tariff_id: Option<Uuid>) -> User {
        let now = Utc::now();
        User {
            id: Uuid::new_v4(),
            email: email.into(),
            full_name: None,
            password_hash: String::new(),
            role: Role::User,
            tariff_id,
            group_id: None,
            node_id: None,
            disabled: false,
            status: awg_identity::UserStatus::Active,
            totp_secret_sealed: None,
            totp_enabled: false,
            recovery_codes: Vec::new(),
            totp_pending_secret_sealed: None,
            totp_pending_recovery_codes: Vec::new(),
            last_totp_step: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 16, 12, 0, 0).unwrap()
    }

    #[test]
    fn current_quota_assembles_state_and_period() {
        let (tariffs, tariff_id) = tariff_service(Some(1000));
        let user = account("alice@example.com", tariff_id);
        let view = current_quota(&tariffs, &user, 500, now()).unwrap();

        assert_eq!(view.used_bytes, 500);
        assert_eq!(view.quota_bytes, Some(1000));
        assert!(!view.exceeded);
        assert_eq!(view.remaining_bytes, Some(500));
        assert_eq!(view.percent, Some(50.0));
        assert_eq!(
            view.period_start,
            Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap()
        );
        assert_eq!(
            view.period_end,
            Utc.with_ymd_and_hms(2026, 11, 30, 23, 59, 59).unwrap()
        );
        assert_eq!(
            view.reset_at,
            Utc.with_ymd_and_hms(2026, 12, 1, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn current_quota_without_tariff_has_null_quota_fields() {
        let (tariffs, _) = tariff_service(None);
        let user = account("bob@example.com", None);
        let view = current_quota(&tariffs, &user, 1234, now()).unwrap();
        let json = serde_json::to_value(&view).unwrap();

        assert_eq!(
            json,
            json!({
                "used_bytes": 1234,
                "quota_bytes": null,
                "exceeded": false,
                "remaining_bytes": null,
                "percent": null,
                "period_start": "2026-11-01T00:00:00Z",
                "period_end": "2026-11-30T23:59:59Z",
                "reset_at": "2026-12-01T00:00:00Z"
            })
        );
    }

    #[test]
    fn current_quota_over_usage_reports_exceeded() {
        let (tariffs, tariff_id) = tariff_service(Some(1000));
        let user = account("carol@example.com", tariff_id);
        let view = current_quota(&tariffs, &user, 2000, now()).unwrap();

        assert!(view.exceeded);
        assert_eq!(view.remaining_bytes, Some(0));
        assert_eq!(view.percent, Some(200.0));
    }

    #[test]
    fn user_quota_projects_required_fields() {
        let (tariffs, tariff_id) = tariff_service(Some(1000));
        let user = account("dave@example.com", tariff_id);
        let view = user_quota(&tariffs, &user, 250).unwrap();
        let json = serde_json::to_value(&view).unwrap();

        assert_eq!(
            json,
            json!({
                "user_id": user.id,
                "email": "dave@example.com",
                "used_bytes": 250,
                "quota_bytes": 1000,
                "exceeded": false,
                "percent": 25.0
            })
        );
    }

    #[test]
    fn user_quota_without_tariff_has_null_quota() {
        let (tariffs, _) = tariff_service(None);
        let user = account("erin@example.com", None);
        let view = user_quota(&tariffs, &user, 10).unwrap();

        assert_eq!(view.quota_bytes, None);
        assert_eq!(view.percent, None);
        assert!(!view.exceeded);
    }

    #[test]
    fn current_quota_targets_the_authenticated_user() {
        let own = Uuid::new_v4();
        let other = Uuid::new_v4();
        let principal = AuthPrincipal {
            user_id: own,
            role: Role::User,
        };
        assert_eq!(quota_subject(&AuthUser(principal)), own);
        assert_ne!(quota_subject(&AuthUser(principal)), other);
    }
}
