use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    BillingPeriod, Invoice, InvoiceRepository, Plan, PlanRepository, Subscription,
    SubscriptionRepository, SubscriptionStatus, normalize_currency,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingSettings {
    pub currency: String,
    pub trial_days: u32,
}

#[derive(Debug, Clone)]
pub struct NewPlan {
    pub name: String,
    pub description: String,
    pub price_cents: i64,
    pub currency: String,
    pub period: BillingPeriod,
    pub tariff_id: Uuid,
    pub active: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PlanChanges {
    pub name: Option<String>,
    pub description: Option<String>,
    pub price_cents: Option<i64>,
    pub currency: Option<String>,
    pub period: Option<BillingPeriod>,
    pub tariff_id: Option<Uuid>,
    pub active: Option<bool>,
}

pub trait TariffCatalog: Send + Sync {
    fn exists(&self, tariff_id: Uuid) -> CoreResult<bool>;
}

pub struct BillingService {
    plans: Arc<dyn PlanRepository>,
    subscriptions: Arc<dyn SubscriptionRepository>,
    invoices: Arc<dyn InvoiceRepository>,
    tariffs: Arc<dyn TariffCatalog>,
    settings: BillingSettings,
}

impl BillingService {
    pub fn new(
        plans: Arc<dyn PlanRepository>,
        subscriptions: Arc<dyn SubscriptionRepository>,
        invoices: Arc<dyn InvoiceRepository>,
        tariffs: Arc<dyn TariffCatalog>,
        settings: BillingSettings,
    ) -> Self {
        Self {
            plans,
            subscriptions,
            invoices,
            tariffs,
            settings,
        }
    }

    pub fn settings(&self) -> &BillingSettings {
        &self.settings
    }

    pub fn list_plans(&self) -> CoreResult<Vec<Plan>> {
        let mut plans = self.plans.list()?;
        plans.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(plans)
    }

    pub fn active_plans(&self) -> CoreResult<Vec<Plan>> {
        let mut plans = self
            .list_plans()?
            .into_iter()
            .filter(|plan| plan.active)
            .collect::<Vec<_>>();
        plans.sort_by(|left, right| {
            left.price_cents
                .cmp(&right.price_cents)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(plans)
    }

    pub fn get_plan(&self, id: Uuid) -> CoreResult<Plan> {
        self.plans
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("plan".into()))
    }

    pub fn create_plan(&self, input: NewPlan) -> CoreResult<Plan> {
        let now = Utc::now();
        let currency = self.validate_currency(&input.currency)?;
        self.require_tariff(input.tariff_id)?;
        let plan = Plan {
            id: Uuid::new_v4(),
            name: input.name.trim().to_string(),
            description: input.description,
            price_cents: input.price_cents,
            currency,
            period: input.period,
            tariff_id: input.tariff_id,
            active: input.active,
            created_at: now,
            updated_at: now,
        };
        plan.validate()?;
        self.plans.save(&plan)?;
        Ok(plan)
    }

    pub fn update_plan(&self, id: Uuid, changes: PlanChanges) -> CoreResult<Plan> {
        let mut plan = self.get_plan(id)?;
        if let Some(name) = changes.name {
            plan.name = name.trim().to_string();
        }
        if let Some(description) = changes.description {
            plan.description = description;
        }
        if let Some(price_cents) = changes.price_cents {
            plan.price_cents = price_cents;
        }
        if let Some(currency) = changes.currency {
            plan.currency = self.validate_currency(&currency)?;
        }
        if let Some(period) = changes.period {
            plan.period = period;
        }
        if let Some(tariff_id) = changes.tariff_id {
            self.require_tariff(tariff_id)?;
            plan.tariff_id = tariff_id;
        }
        if let Some(active) = changes.active {
            plan.active = active;
        }
        plan.updated_at = Utc::now();
        plan.validate()?;
        self.plans.save(&plan)?;
        Ok(plan)
    }

    pub fn current_subscription(&self, user_id: Uuid) -> CoreResult<Option<Subscription>> {
        let mut current: Option<Subscription> = None;
        for subscription in self.subscriptions.list()? {
            if subscription.user_id != user_id || !subscription.status.is_current() {
                continue;
            }
            let replace = current.as_ref().is_none_or(|existing| {
                (subscription.created_at, subscription.id) > (existing.created_at, existing.id)
            });
            if replace {
                current = Some(subscription);
            }
        }
        Ok(current)
    }

    pub fn current_plan(&self, user_id: Uuid) -> CoreResult<Option<Plan>> {
        let Some(subscription) = self.current_subscription(user_id)? else {
            return Ok(None);
        };
        self.plans.find(subscription.plan_id)
    }

    pub fn plan_for_user(&self, user_id: Uuid) -> CoreResult<Option<Uuid>> {
        let Some(subscription) = self.current_subscription(user_id)? else {
            return Ok(None);
        };
        if !subscription.grants_access() {
            return Ok(None);
        }
        Ok(self
            .plans
            .find(subscription.plan_id)?
            .map(|plan| plan.tariff_id))
    }

    pub fn invoices_for_user(&self, user_id: Uuid, limit: usize) -> CoreResult<Vec<Invoice>> {
        let mut invoices = self
            .invoices
            .list()?
            .into_iter()
            .filter(|invoice| invoice.user_id == user_id)
            .collect::<Vec<_>>();
        sort_invoices(&mut invoices);
        invoices.truncate(limit);
        Ok(invoices)
    }

    pub fn invoices_for_admin(
        &self,
        user_id: Option<Uuid>,
        limit: usize,
    ) -> CoreResult<Vec<Invoice>> {
        let mut invoices = self
            .invoices
            .list()?
            .into_iter()
            .filter(|invoice| user_id.is_none_or(|wanted| invoice.user_id == wanted))
            .collect::<Vec<_>>();
        sort_invoices(&mut invoices);
        invoices.truncate(limit);
        Ok(invoices)
    }

    pub fn list_subscriptions(
        &self,
        status: Option<SubscriptionStatus>,
        offset: usize,
        limit: usize,
    ) -> CoreResult<Vec<Subscription>> {
        let mut subscriptions = self
            .subscriptions
            .list()?
            .into_iter()
            .filter(|subscription| status.is_none_or(|wanted| subscription.status == wanted))
            .collect::<Vec<_>>();
        subscriptions.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(subscriptions.into_iter().skip(offset).take(limit).collect())
    }

    pub fn count_subscriptions(&self, status: Option<SubscriptionStatus>) -> CoreResult<usize> {
        Ok(self
            .subscriptions
            .list()?
            .into_iter()
            .filter(|subscription| status.is_none_or(|wanted| subscription.status == wanted))
            .count())
    }

    fn validate_currency(&self, currency: &str) -> CoreResult<String> {
        let currency = normalize_currency(currency)?;
        if currency != self.settings.currency {
            return Err(CoreError::Invalid(format!(
                "plan currency must match the configured currency {}",
                self.settings.currency
            )));
        }
        Ok(currency)
    }

    fn require_tariff(&self, tariff_id: Uuid) -> CoreResult<()> {
        if !self.tariffs.exists(tariff_id)? {
            return Err(CoreError::Invalid("tariff does not exist".into()));
        }
        Ok(())
    }
}

fn sort_invoices(invoices: &mut [Invoice]) {
    invoices.sort_by(|left, right| {
        right
            .period_start
            .cmp(&left.period_start)
            .then_with(|| right.id.cmp(&left.id))
    });
}

#[cfg(test)]
mod tests {
    use awg_storage::Store;
    use chrono::{Duration, TimeZone};

    use super::*;
    use crate::domain::InvoiceStatus;
    use crate::infrastructure::{
        RedbInvoiceRepository, RedbPlanRepository, RedbSubscriptionRepository,
    };

    struct Tariffs {
        known: Vec<Uuid>,
    }

    impl TariffCatalog for Tariffs {
        fn exists(&self, tariff_id: Uuid) -> CoreResult<bool> {
            Ok(self.known.contains(&tariff_id))
        }
    }

    fn store() -> Arc<Store> {
        Arc::new(Store::open_in_memory().unwrap())
    }

    fn service(tariff_id: Uuid) -> BillingService {
        let store = store();
        BillingService::new(
            Arc::new(RedbPlanRepository::new(store.clone())),
            Arc::new(RedbSubscriptionRepository::new(store.clone())),
            Arc::new(RedbInvoiceRepository::new(store)),
            Arc::new(Tariffs {
                known: vec![tariff_id],
            }),
            BillingSettings {
                currency: "RUB".into(),
                trial_days: 0,
            },
        )
    }

    fn new_plan(tariff_id: Uuid, price_cents: i64) -> NewPlan {
        NewPlan {
            name: "Pro".into(),
            description: "Pro plan".into(),
            price_cents,
            currency: "rub".into(),
            period: BillingPeriod::Month,
            tariff_id,
            active: true,
        }
    }

    #[test]
    fn plan_crud() {
        let tariff_id = Uuid::new_v4();
        let service = service(tariff_id);

        let plan = service.create_plan(new_plan(tariff_id, 99_000)).unwrap();
        assert_eq!(plan.currency, "RUB");
        assert_eq!(plan.price_cents, 99_000);

        let listed = service.list_plans().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, plan.id);

        let updated = service
            .update_plan(
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
        assert_eq!(service.active_plans().unwrap().len(), 0);
        assert!(updated.updated_at >= plan.updated_at);
    }

    #[test]
    fn plan_validation_rejects_negative_price_and_unknown_tariff() {
        let tariff_id = Uuid::new_v4();
        let service = service(tariff_id);
        assert!(service.create_plan(new_plan(tariff_id, -1)).is_err());

        let mut foreign = new_plan(tariff_id, 1000);
        foreign.tariff_id = Uuid::new_v4();
        assert!(service.create_plan(foreign).is_err());
    }

    #[test]
    fn plan_currency_must_match_configuration() {
        let tariff_id = Uuid::new_v4();
        let service = service(tariff_id);
        let mut plan = new_plan(tariff_id, 1000);
        plan.currency = "USD".into();
        assert!(service.create_plan(plan).is_err());

        let mut plan = new_plan(tariff_id, 1000);
        plan.currency = "RU".into();
        assert!(service.create_plan(plan).is_err());
    }

    #[test]
    fn update_unknown_plan_is_not_found() {
        let service = service(Uuid::new_v4());
        let error = service
            .update_plan(Uuid::new_v4(), PlanChanges::default())
            .unwrap_err();
        assert!(matches!(error, CoreError::NotFound(_)));
    }

    #[test]
    fn current_subscription_prefers_latest_non_canceled() {
        let service = service(Uuid::new_v4());
        let user_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        let now = Utc.with_ymd_and_hms(2026, 11, 16, 12, 0, 0).unwrap();
        let repo = service;
        repo.subscriptions
            .save(&subscription(
                user_id,
                plan_id,
                SubscriptionStatus::Canceled,
                now,
            ))
            .unwrap();
        let active = subscription(user_id, plan_id, SubscriptionStatus::Active, now);
        repo.subscriptions.save(&active).unwrap();

        assert_eq!(
            repo.current_subscription(user_id).unwrap().unwrap().id,
            active.id
        );
    }

    #[test]
    fn plan_for_user_requires_access_granting_status() {
        let tariff_id = Uuid::new_v4();
        let service = service(tariff_id);
        let plan = service.create_plan(new_plan(tariff_id, 1000)).unwrap();
        let user_id = Uuid::new_v4();

        assert_eq!(service.plan_for_user(user_id).unwrap(), None);

        let active = subscription(user_id, plan.id, SubscriptionStatus::Active, Utc::now());
        service.subscriptions.save(&active).unwrap();
        assert_eq!(service.plan_for_user(user_id).unwrap(), Some(tariff_id));

        let mut canceled = active.clone();
        canceled.id = Uuid::new_v4();
        canceled.status = SubscriptionStatus::Canceled;
        canceled.created_at += Duration::days(1);
        service.subscriptions.save(&canceled).unwrap();
        assert_eq!(service.plan_for_user(user_id).unwrap(), Some(tariff_id));
    }

    #[test]
    fn plan_for_user_ignores_suspended_subscription() {
        let tariff_id = Uuid::new_v4();
        let service = service(tariff_id);
        let plan = service.create_plan(new_plan(tariff_id, 1000)).unwrap();
        let user_id = Uuid::new_v4();
        service
            .subscriptions
            .save(&subscription(
                user_id,
                plan.id,
                SubscriptionStatus::Suspended,
                Utc::now(),
            ))
            .unwrap();
        assert_eq!(service.plan_for_user(user_id).unwrap(), None);
    }

    #[test]
    fn invoices_are_filtered_and_sorted() {
        let service = service(Uuid::new_v4());
        let user_id = Uuid::new_v4();
        let other = Uuid::new_v4();
        let now = Utc.with_ymd_and_hms(2026, 11, 16, 12, 0, 0).unwrap();

        let recent = invoice(user_id, now + Duration::days(30));
        let old = invoice(user_id, now);
        let foreign = invoice(other, now + Duration::days(60));
        for value in [&recent, &old, &foreign] {
            service.invoices.save(value).unwrap();
        }

        let invoices = service.invoices_for_user(user_id, 10).unwrap();
        assert_eq!(invoices.len(), 2);
        assert_eq!(invoices[0].id, recent.id);
        assert_eq!(invoices[1].id, old.id);
        assert_eq!(service.invoices_for_user(user_id, 1).unwrap().len(), 1);

        let all = service.invoices_for_admin(None, 10).unwrap();
        assert_eq!(all.len(), 3);
        let filtered = service.invoices_for_admin(Some(other), 10).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, foreign.id);
    }

    #[test]
    fn admin_subscription_listing_is_paginated_and_filtered() {
        let service = service(Uuid::new_v4());
        let user_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        let now = Utc.with_ymd_and_hms(2026, 11, 16, 12, 0, 0).unwrap();

        for (status, days) in [
            (SubscriptionStatus::Active, 0),
            (SubscriptionStatus::Active, 1),
            (SubscriptionStatus::PastDue, 2),
        ] {
            service
                .subscriptions
                .save(&subscription(
                    user_id,
                    plan_id,
                    status,
                    now + Duration::days(days),
                ))
                .unwrap();
        }

        assert_eq!(service.count_subscriptions(None).unwrap(), 3);
        assert_eq!(
            service
                .count_subscriptions(Some(SubscriptionStatus::Active))
                .unwrap(),
            2
        );

        let page = service.list_subscriptions(None, 0, 2).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].status, SubscriptionStatus::PastDue);

        let filtered = service
            .list_subscriptions(Some(SubscriptionStatus::Active), 1, 2)
            .unwrap();
        assert_eq!(filtered.len(), 1);
    }

    fn subscription(
        user_id: Uuid,
        plan_id: Uuid,
        status: SubscriptionStatus,
        created_at: chrono::DateTime<Utc>,
    ) -> Subscription {
        Subscription {
            id: Uuid::new_v4(),
            user_id,
            plan_id,
            status,
            current_period_start: created_at,
            current_period_end: created_at + Duration::days(30),
            auto_renew: true,
            cancel_at_period_end: false,
            trial_ends_at: None,
            gateway: None,
            gateway_ref: None,
            created_at,
            updated_at: created_at,
        }
    }

    fn invoice(user_id: Uuid, period_start: chrono::DateTime<Utc>) -> Invoice {
        Invoice {
            id: Uuid::new_v4(),
            user_id,
            subscription_id: Uuid::new_v4(),
            amount_cents: 99_000,
            currency: "RUB".into(),
            status: InvoiceStatus::Open,
            period_start,
            period_end: period_start + Duration::days(30),
            due_at: period_start,
            paid_at: None,
            attempts: 0,
        }
    }
}
