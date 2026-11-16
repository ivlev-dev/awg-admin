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
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::views::{QuotaUserView, QuotaView};

pub async fn current(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<QuotaView>> {
    let subject = quota_subject(&user);
    let account = state.identity.find(subject).map_err(ApiError::from)?;
    let used = state
        .stats
        .used_bytes(StatsScope::User(subject))
        .map_err(ApiError::from)?;
    let view = current_quota(&state.tariffs, &account, used, Utc::now()).map_err(ApiError::from)?;
    Ok(Json(view))
}

pub async fn users(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<QuotaUserView>>> {
    authorize_user_quotas(&user)?;
    let accounts = state.identity.list().map_err(ApiError::from)?;
    let mut items = Vec::new();
    for account in accounts
        .iter()
        .filter(|account| account.tariff_id.is_some())
    {
        let used = state
            .stats
            .used_bytes(StatsScope::User(account.id))
            .map_err(ApiError::from)?;
        items.push(user_quota(&state.tariffs, account, used).map_err(ApiError::from)?);
    }
    items.sort_by(|left, right| {
        left.login
            .cmp(&right.login)
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    Ok(Json(items))
}

fn authorize_user_quotas(user: &AuthUser) -> ApiResult<()> {
    user.require_admin()
}

fn quota_subject(user: &AuthUser) -> Uuid {
    user.id()
}

fn quota_state(tariffs: &TariffService, account: &User, used: u64) -> CoreResult<QuotaState> {
    tariffs.quota_state_for(account.tariff_id, used)
}

fn current_quota(
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
    Ok(QuotaUserView::build(account.id, &account.login, state))
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
                })
                .unwrap()
                .id
        });
        (service, tariff_id)
    }

    fn account(login: &str, tariff_id: Option<Uuid>) -> User {
        let now = Utc::now();
        User {
            id: Uuid::new_v4(),
            login: login.into(),
            password_hash: String::new(),
            role: Role::User,
            tariff_id,
            group_id: None,
            disabled: false,
            created_at: now,
            updated_at: now,
        }
    }

    fn auth(role: Role) -> AuthUser {
        AuthUser(AuthPrincipal {
            user_id: Uuid::new_v4(),
            role,
        })
    }

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 16, 12, 0, 0).unwrap()
    }

    #[test]
    fn current_quota_assembles_state_and_period() {
        let (tariffs, tariff_id) = tariff_service(Some(1000));
        let user = account("alice", tariff_id);
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
        let user = account("bob", None);
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
        let user = account("carol", tariff_id);
        let view = current_quota(&tariffs, &user, 2000, now()).unwrap();

        assert!(view.exceeded);
        assert_eq!(view.remaining_bytes, Some(0));
        assert_eq!(view.percent, Some(200.0));
    }

    #[test]
    fn user_quota_projects_required_fields() {
        let (tariffs, tariff_id) = tariff_service(Some(1000));
        let user = account("dave", tariff_id);
        let view = user_quota(&tariffs, &user, 250).unwrap();
        let json = serde_json::to_value(&view).unwrap();

        assert_eq!(
            json,
            json!({
                "user_id": user.id,
                "login": "dave",
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
        let user = account("erin", None);
        let view = user_quota(&tariffs, &user, 10).unwrap();

        assert_eq!(view.quota_bytes, None);
        assert_eq!(view.percent, None);
        assert!(!view.exceeded);
    }

    #[test]
    fn quota_list_is_admin_only() {
        assert!(authorize_user_quotas(&auth(Role::Admin)).is_ok());
        let error = authorize_user_quotas(&auth(Role::User)).unwrap_err();
        assert_eq!(error.status_code(), axum::http::StatusCode::FORBIDDEN);
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
