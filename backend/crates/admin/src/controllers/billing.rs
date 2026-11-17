use std::sync::Arc;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use uuid::Uuid;

use awg_billing::{
    BillingService, Invoice, NewPlan, Plan, PlanChanges, Subscription, SubscriptionStatus,
    TariffCatalog, WebhookError,
};
use awg_shared::CoreResult;
use awg_tariffs::TariffService;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{
    AdminSubscriptionQuery, CreatePlanRequest, InvoiceQuery, StartCheckoutRequest,
    UpdatePlanRequest,
};
use crate::state::AppState;
use crate::views::{CheckoutView, PaymentMethodView, SubscriptionPageView, WebhookView};

const DEFAULT_INVOICE_LIMIT: usize = 50;
const MAX_PAGE_SIZE: usize = 200;

pub struct TariffCatalogAdapter {
    tariffs: Arc<TariffService>,
}

impl TariffCatalogAdapter {
    pub fn new(tariffs: Arc<TariffService>) -> Self {
        Self { tariffs }
    }
}

impl TariffCatalog for TariffCatalogAdapter {
    fn exists(&self, tariff_id: Uuid) -> CoreResult<bool> {
        Ok(self
            .tariffs
            .list()?
            .iter()
            .any(|tariff| tariff.id == tariff_id))
    }
}

pub async fn require_enabled(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    match ensure_billing_enabled(state.config.billing.enabled) {
        Ok(()) => next.run(request).await,
        Err(error) => error.into_response(),
    }
}

fn ensure_billing_enabled(enabled: bool) -> ApiResult<()> {
    if enabled {
        Ok(())
    } else {
        Err(ApiError::BillingDisabled)
    }
}

pub async fn list_plans(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<Plan>>> {
    Ok(Json(list_plans_for(&state.billing, &user)?))
}

pub async fn create_plan(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreatePlanRequest>,
) -> ApiResult<Json<Plan>> {
    Ok(Json(create_plan_for(
        &state.billing,
        &user,
        request.into(),
    )?))
}

pub async fn update_plan(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdatePlanRequest>,
) -> ApiResult<Json<Plan>> {
    Ok(Json(update_plan_for(
        &state.billing,
        &user,
        id,
        request.into(),
    )?))
}

pub async fn subscription(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Option<Subscription>>> {
    Ok(Json(subscription_for(&state.billing, &user)?))
}

pub async fn invoices(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<InvoiceQuery>,
) -> ApiResult<Json<Vec<Invoice>>> {
    Ok(Json(invoices_for(
        &state.billing,
        &user,
        query.user_id,
        query.limit,
    )?))
}

pub async fn checkout(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<StartCheckoutRequest>,
) -> ApiResult<Json<CheckoutView>> {
    let outcome = state
        .billing
        .start_checkout(user.id(), request.plan_id, Utc::now())
        .map_err(ApiError::from)?;
    Ok(Json(CheckoutView {
        invoice: outcome.invoice,
        checkout_url: outcome.checkout_url,
    }))
}

pub async fn payment_methods(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<PaymentMethodView>>> {
    let methods = state
        .billing
        .payment_methods_for_user(user.id())
        .map_err(ApiError::from)?;
    Ok(Json(
        methods.into_iter().map(PaymentMethodView::from).collect(),
    ))
}

pub async fn webhook(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<WebhookView>> {
    let headers: Vec<(String, String)> = headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect();
    let outcome = state
        .billing
        .handle_webhook(&provider, &headers, body.as_ref(), Utc::now())
        .map_err(webhook_error)?;
    Ok(Json(WebhookView {
        status: outcome.status().to_string(),
        event_id: Some(outcome.event_id().to_string()),
    }))
}

fn webhook_error(error: WebhookError) -> ApiError {
    match error {
        WebhookError::UnknownProvider(message) => {
            ApiError::NotFound(format!("unknown payment provider {message:?}"))
        }
        WebhookError::Invalid(message) => ApiError::BadRequest(message),
        WebhookError::Internal(message) => ApiError::Internal(message),
    }
}

pub async fn admin_subscriptions(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<AdminSubscriptionQuery>,
) -> ApiResult<Json<SubscriptionPageView>> {
    Ok(Json(admin_subscriptions_for(&state.billing, &user, query)?))
}

fn list_plans_for(billing: &BillingService, user: &AuthUser) -> ApiResult<Vec<Plan>> {
    user.require_admin()?;
    billing.list_plans().map_err(ApiError::from)
}

fn create_plan_for(billing: &BillingService, user: &AuthUser, input: NewPlan) -> ApiResult<Plan> {
    user.require_admin()?;
    billing.create_plan(input).map_err(ApiError::from)
}

fn update_plan_for(
    billing: &BillingService,
    user: &AuthUser,
    id: Uuid,
    changes: PlanChanges,
) -> ApiResult<Plan> {
    user.require_admin()?;
    billing.update_plan(id, changes).map_err(ApiError::from)
}

fn subscription_for(billing: &BillingService, user: &AuthUser) -> ApiResult<Option<Subscription>> {
    billing
        .current_subscription(user.id())
        .map_err(ApiError::from)
}

fn invoices_for(
    billing: &BillingService,
    user: &AuthUser,
    user_id: Option<Uuid>,
    limit: Option<usize>,
) -> ApiResult<Vec<Invoice>> {
    let limit = validate_limit(limit)?;
    match invoice_scope(user, user_id)? {
        InvoiceScope::All => billing
            .invoices_for_admin(None, limit)
            .map_err(ApiError::from),
        InvoiceScope::User(id) if user.is_admin() => billing
            .invoices_for_admin(Some(id), limit)
            .map_err(ApiError::from),
        InvoiceScope::User(id) => billing.invoices_for_user(id, limit).map_err(ApiError::from),
    }
}

fn admin_subscriptions_for(
    billing: &BillingService,
    user: &AuthUser,
    query: AdminSubscriptionQuery,
) -> ApiResult<SubscriptionPageView> {
    user.require_admin()?;
    let status = match query.status.as_deref().map(str::trim) {
        Some("") | None => None,
        Some(raw) => Some(SubscriptionStatus::parse(raw).map_err(ApiError::from)?),
    };
    let (page, per_page) = validate_pagination(query.page, query.per_page)?;
    let offset = page
        .checked_sub(1)
        .and_then(|value| value.checked_mul(per_page))
        .ok_or_else(|| ApiError::BadRequest("pagination offset is too large".into()))?;
    let items = billing
        .list_subscriptions(status, offset, per_page)
        .map_err(ApiError::from)?;
    let total = billing
        .count_subscriptions(status)
        .map_err(ApiError::from)?;
    Ok(SubscriptionPageView {
        items,
        total,
        page,
        per_page,
    })
}

enum InvoiceScope {
    All,
    User(Uuid),
}

fn invoice_scope(user: &AuthUser, requested: Option<Uuid>) -> ApiResult<InvoiceScope> {
    match requested {
        Some(id) if user.is_admin() || user.id() == id => Ok(InvoiceScope::User(id)),
        Some(_) => Err(ApiError::Forbidden(
            "access to another user is denied".into(),
        )),
        None if user.is_admin() => Ok(InvoiceScope::All),
        None => Ok(InvoiceScope::User(user.id())),
    }
}

fn validate_limit(raw: Option<usize>) -> ApiResult<usize> {
    let limit = raw.unwrap_or(DEFAULT_INVOICE_LIMIT);
    if !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(ApiError::BadRequest(format!(
            "limit must be between 1 and {MAX_PAGE_SIZE}"
        )));
    }
    Ok(limit)
}

fn validate_pagination(page: Option<usize>, per_page: Option<usize>) -> ApiResult<(usize, usize)> {
    let page = page.unwrap_or(1);
    let per_page = per_page.unwrap_or(DEFAULT_INVOICE_LIMIT);
    if page == 0 {
        return Err(ApiError::BadRequest("page must be at least 1".into()));
    }
    if !(1..=MAX_PAGE_SIZE).contains(&per_page) {
        return Err(ApiError::BadRequest(format!(
            "per_page must be between 1 and {MAX_PAGE_SIZE}"
        )));
    }
    Ok((page, per_page))
}

impl From<CreatePlanRequest> for NewPlan {
    fn from(request: CreatePlanRequest) -> Self {
        Self {
            name: request.name,
            description: request.description,
            price_cents: request.price_cents,
            currency: request.currency,
            period: request.period,
            tariff_id: request.tariff_id,
            active: request.active,
        }
    }
}

impl From<UpdatePlanRequest> for PlanChanges {
    fn from(request: UpdatePlanRequest) -> Self {
        Self {
            name: request.name,
            description: request.description,
            price_cents: request.price_cents,
            currency: request.currency,
            period: request.period,
            tariff_id: request.tariff_id,
            active: request.active,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::http::StatusCode;
    use chrono::{Duration, Utc};

    use awg_billing::{
        BillingPeriod, BillingSettings, InvoiceRepository, InvoiceStatus, MockGateway,
        PaymentEventRepository, PaymentMethodRepository, PlanRepository, RedbInvoiceRepository,
        RedbPaymentEventRepository, RedbPaymentMethodRepository, RedbPlanRepository,
        RedbSubscriptionRepository, Subscription, SubscriptionRepository,
    };
    use awg_identity::{AuthPrincipal, Role};
    use awg_storage::Store;

    use super::*;

    struct StubTariffs {
        known: Vec<Uuid>,
    }

    impl TariffCatalog for StubTariffs {
        fn exists(&self, tariff_id: Uuid) -> CoreResult<bool> {
            Ok(self.known.contains(&tariff_id))
        }
    }

    fn test_gateway() -> Arc<dyn awg_billing::PaymentGateway> {
        Arc::new(
            MockGateway::from_config(
                "test-secret-with-at-least-32-characters",
                "http://localhost",
                300,
            )
            .unwrap(),
        )
    }

    fn service(tariff_id: Uuid) -> BillingService {
        let store = Arc::new(Store::open_in_memory().unwrap());
        BillingService::new(
            Arc::new(RedbPlanRepository::new(store.clone())),
            Arc::new(RedbSubscriptionRepository::new(store.clone())),
            Arc::new(RedbInvoiceRepository::new(store.clone())),
            Arc::new(RedbPaymentMethodRepository::new(store.clone())),
            Arc::new(RedbPaymentEventRepository::new(store)),
            Arc::new(StubTariffs {
                known: vec![tariff_id],
            }),
            test_gateway(),
            BillingSettings::new("RUB", 0, "http://localhost"),
        )
    }

    struct TestBilling {
        service: BillingService,
        plans: Arc<dyn PlanRepository>,
        subscriptions: Arc<dyn SubscriptionRepository>,
        invoices: Arc<dyn InvoiceRepository>,
    }

    fn service_with_repos(tariff_id: Uuid) -> TestBilling {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let plans: Arc<dyn PlanRepository> = Arc::new(RedbPlanRepository::new(store.clone()));
        let subscriptions: Arc<dyn SubscriptionRepository> =
            Arc::new(RedbSubscriptionRepository::new(store.clone()));
        let invoices: Arc<dyn InvoiceRepository> =
            Arc::new(RedbInvoiceRepository::new(store.clone()));
        let payment_methods: Arc<dyn PaymentMethodRepository> =
            Arc::new(RedbPaymentMethodRepository::new(store.clone()));
        let payment_events: Arc<dyn PaymentEventRepository> =
            Arc::new(RedbPaymentEventRepository::new(store));
        let service = BillingService::new(
            plans.clone(),
            subscriptions.clone(),
            invoices.clone(),
            payment_methods,
            payment_events,
            Arc::new(StubTariffs {
                known: vec![tariff_id],
            }),
            test_gateway(),
            BillingSettings::new("RUB", 0, "http://localhost"),
        );
        TestBilling {
            service,
            plans,
            subscriptions,
            invoices,
        }
    }

    fn auth(role: Role) -> AuthUser {
        AuthUser(AuthPrincipal {
            user_id: Uuid::new_v4(),
            role,
        })
    }

    fn auth_as(user_id: Uuid, role: Role) -> AuthUser {
        AuthUser(AuthPrincipal { user_id, role })
    }

    fn new_plan(tariff_id: Uuid) -> NewPlan {
        NewPlan {
            name: "Pro".into(),
            description: "Pro plan".into(),
            price_cents: 99_000,
            currency: "RUB".into(),
            period: BillingPeriod::Month,
            tariff_id,
            active: true,
        }
    }

    fn subscription_for_user(user_id: Uuid) -> Subscription {
        let now = Utc::now();
        Subscription {
            id: Uuid::new_v4(),
            user_id,
            plan_id: Uuid::new_v4(),
            status: SubscriptionStatus::Active,
            current_period_start: now,
            current_period_end: now + Duration::days(30),
            auto_renew: true,
            cancel_at_period_end: false,
            trial_ends_at: None,
            gateway: None,
            gateway_ref: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn admin_can_list_create_and_update_plans() {
        let tariff_id = Uuid::new_v4();
        let billing = service(tariff_id);
        let admin = auth(Role::Admin);

        let plan = create_plan_for(&billing, &admin, new_plan(tariff_id)).unwrap();
        assert_eq!(list_plans_for(&billing, &admin).unwrap().len(), 1);

        let updated = update_plan_for(
            &billing,
            &admin,
            plan.id,
            PlanChanges {
                price_cents: Some(120_000),
                active: Some(false),
                ..PlanChanges::default()
            },
        )
        .unwrap();
        assert_eq!(updated.price_cents, 120_000);
        assert!(!updated.active);
    }

    #[test]
    fn non_admin_cannot_manage_plans() {
        let tariff_id = Uuid::new_v4();
        let billing = service(tariff_id);
        let user = auth(Role::User);

        assert!(matches!(
            list_plans_for(&billing, &user).unwrap_err(),
            ApiError::Forbidden(_)
        ));
        assert!(matches!(
            create_plan_for(&billing, &user, new_plan(tariff_id)).unwrap_err(),
            ApiError::Forbidden(_)
        ));
        assert!(matches!(
            update_plan_for(&billing, &user, Uuid::new_v4(), PlanChanges::default()).unwrap_err(),
            ApiError::Forbidden(_)
        ));
        assert!(matches!(
            admin_subscriptions_for(&billing, &user, AdminSubscriptionQuery::default())
                .unwrap_err(),
            ApiError::Forbidden(_)
        ));
    }

    #[test]
    fn subscription_is_scoped_to_the_authenticated_user() {
        let tariff_id = Uuid::new_v4();
        let TestBilling {
            service: billing,
            subscriptions,
            ..
        } = service_with_repos(tariff_id);
        let user_id = Uuid::new_v4();
        subscriptions.save(&subscription_for_user(user_id)).unwrap();

        let user = auth_as(user_id, Role::User);
        let found = subscription_for(&billing, &user).unwrap().unwrap();
        assert_eq!(found.user_id, user_id);
        assert_eq!(
            subscription_for(&billing, &auth_as(Uuid::new_v4(), Role::User)).unwrap(),
            None
        );
    }

    #[test]
    fn invoices_are_scoped_by_role_and_query() {
        let tariff_id = Uuid::new_v4();
        let TestBilling {
            service: billing,
            invoices,
            ..
        } = service_with_repos(tariff_id);
        let alice = Uuid::new_v4();
        let bob = Uuid::new_v4();
        let now = Utc::now();
        for (user_id, amount) in [(alice, 100), (bob, 200)] {
            invoices
                .save(&Invoice {
                    id: Uuid::new_v4(),
                    user_id,
                    subscription_id: Uuid::new_v4(),
                    amount_cents: amount,
                    currency: "RUB".into(),
                    status: InvoiceStatus::Open,
                    period_start: now,
                    period_end: now + Duration::days(30),
                    due_at: now,
                    paid_at: None,
                    attempts: 0,
                    gateway: None,
                    gateway_ref: None,
                    checkout_url: None,
                })
                .unwrap();
        }

        let alice_user = auth_as(alice, Role::User);
        let own = invoices_for(&billing, &alice_user, None, None).unwrap();
        assert_eq!(own.len(), 1);
        assert_eq!(own[0].user_id, alice);
        assert!(matches!(
            invoices_for(&billing, &alice_user, Some(bob), None).unwrap_err(),
            ApiError::Forbidden(_)
        ));

        let admin = auth_as(Uuid::new_v4(), Role::Admin);
        assert_eq!(invoices_for(&billing, &admin, None, None).unwrap().len(), 2);
        let filtered = invoices_for(&billing, &admin, Some(bob), None).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].user_id, bob);
    }

    #[test]
    fn admin_subscriptions_respect_status_and_pagination() {
        let tariff_id = Uuid::new_v4();
        let TestBilling {
            service: billing,
            plans,
            subscriptions,
            ..
        } = service_with_repos(tariff_id);
        let admin = auth(Role::Admin);
        let plan = create_plan_for(&billing, &admin, new_plan(tariff_id)).unwrap();
        let user_id = Uuid::new_v4();

        for (status, days) in [
            (SubscriptionStatus::Active, 0),
            (SubscriptionStatus::PastDue, 1),
            (SubscriptionStatus::Active, 2),
        ] {
            let mut value = subscription_for_user(user_id);
            value.plan_id = plan.id;
            value.status = status;
            value.created_at = Utc::now() + Duration::days(days);
            subscriptions.save(&value).unwrap();
        }
        assert!(plans.find(plan.id).unwrap().is_some());

        let page = admin_subscriptions_for(
            &billing,
            &admin,
            AdminSubscriptionQuery {
                status: Some("active".into()),
                page: Some(1),
                per_page: Some(1),
            },
        )
        .unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.page, 1);
        assert_eq!(page.per_page, 1);

        let all = admin_subscriptions_for(
            &billing,
            &admin,
            AdminSubscriptionQuery {
                status: None,
                page: Some(2),
                per_page: Some(2),
            },
        )
        .unwrap();
        assert_eq!(all.total, 3);
        assert_eq!(all.items.len(), 1);

        assert!(matches!(
            admin_subscriptions_for(
                &billing,
                &admin,
                AdminSubscriptionQuery {
                    status: Some("unknown".into()),
                    ..AdminSubscriptionQuery::default()
                },
            )
            .unwrap_err(),
            ApiError::BadRequest(_)
        ));
    }

    #[test]
    fn invoice_limit_is_validated() {
        assert_eq!(validate_limit(None).unwrap(), DEFAULT_INVOICE_LIMIT);
        assert_eq!(validate_limit(Some(1)).unwrap(), 1);
        assert_eq!(validate_limit(Some(200)).unwrap(), 200);
        assert!(matches!(
            validate_limit(Some(0)).unwrap_err(),
            ApiError::BadRequest(_)
        ));
        assert!(matches!(
            validate_limit(Some(201)).unwrap_err(),
            ApiError::BadRequest(_)
        ));
    }

    #[test]
    fn pagination_is_validated() {
        assert_eq!(validate_pagination(None, None).unwrap(), (1, 50));
        assert_eq!(validate_pagination(Some(3), Some(10)).unwrap(), (3, 10));
        assert!(matches!(
            validate_pagination(Some(0), None).unwrap_err(),
            ApiError::BadRequest(_)
        ));
        assert!(matches!(
            validate_pagination(None, Some(0)).unwrap_err(),
            ApiError::BadRequest(_)
        ));
        assert!(matches!(
            validate_pagination(None, Some(201)).unwrap_err(),
            ApiError::BadRequest(_)
        ));
    }

    #[test]
    fn disabled_flag_returns_billing_disabled() {
        let error = ensure_billing_enabled(false).unwrap_err();
        assert_eq!(error.status_code(), StatusCode::NOT_FOUND);
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(ensure_billing_enabled(true).is_ok());
    }
}
