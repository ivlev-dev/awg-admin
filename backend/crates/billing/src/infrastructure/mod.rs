use std::sync::Arc;

use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{Store, Table};

use crate::domain::{
    Invoice, InvoiceRepository, Plan, PlanRepository, Subscription, SubscriptionRepository,
};

pub struct RedbPlanRepository {
    store: Arc<Store>,
}

impl RedbPlanRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl PlanRepository for RedbPlanRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Plan>> {
        self.store
            .get(Table::BillingPlans, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Plan>> {
        self.store.list(Table::BillingPlans).map_err(map_err)
    }

    fn save(&self, plan: &Plan) -> CoreResult<()> {
        self.store
            .put(Table::BillingPlans, &plan.id.to_string(), plan)
            .map_err(map_err)
    }
}

pub struct RedbSubscriptionRepository {
    store: Arc<Store>,
}

impl RedbSubscriptionRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl SubscriptionRepository for RedbSubscriptionRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Subscription>> {
        self.store
            .get(Table::BillingSubscriptions, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Subscription>> {
        self.store
            .list(Table::BillingSubscriptions)
            .map_err(map_err)
    }

    fn save(&self, subscription: &Subscription) -> CoreResult<()> {
        self.store
            .put(
                Table::BillingSubscriptions,
                &subscription.id.to_string(),
                subscription,
            )
            .map_err(map_err)
    }
}

pub struct RedbInvoiceRepository {
    store: Arc<Store>,
}

impl RedbInvoiceRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl InvoiceRepository for RedbInvoiceRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<Invoice>> {
        self.store
            .get(Table::BillingInvoices, &id.to_string())
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<Invoice>> {
        self.store.list(Table::BillingInvoices).map_err(map_err)
    }

    fn save(&self, invoice: &Invoice) -> CoreResult<()> {
        self.store
            .put(Table::BillingInvoices, &invoice.id.to_string(), invoice)
            .map_err(map_err)
    }
}

fn map_err(error: awg_storage::StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(error.to_string()))
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::*;
    use crate::domain::{BillingPeriod, InvoiceStatus, SubscriptionStatus};

    fn store() -> Arc<Store> {
        Arc::new(Store::open_in_memory().unwrap())
    }

    #[test]
    fn plan_repository_roundtrip() {
        let repo = RedbPlanRepository::new(store());
        let now = Utc::now();
        let plan = Plan {
            id: Uuid::new_v4(),
            name: "Pro".into(),
            description: String::new(),
            price_cents: 99_000,
            currency: "RUB".into(),
            period: BillingPeriod::Year,
            tariff_id: Uuid::new_v4(),
            active: true,
            created_at: now,
            updated_at: now,
        };
        repo.save(&plan).unwrap();

        assert_eq!(repo.find(plan.id).unwrap(), Some(plan.clone()));
        assert_eq!(repo.list().unwrap(), vec![plan.clone()]);

        let mut updated = plan.clone();
        updated.active = false;
        repo.save(&updated).unwrap();
        assert_eq!(repo.find(plan.id).unwrap(), Some(updated));
    }

    #[test]
    fn subscription_repository_roundtrip() {
        let repo = RedbSubscriptionRepository::new(store());
        let now = Utc::now();
        let subscription = Subscription {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            status: SubscriptionStatus::Trialing,
            current_period_start: now,
            current_period_end: now + Duration::days(14),
            auto_renew: true,
            cancel_at_period_end: false,
            trial_ends_at: Some(now + Duration::days(14)),
            gateway: None,
            gateway_ref: None,
            created_at: now,
            updated_at: now,
        };
        repo.save(&subscription).unwrap();

        assert_eq!(
            repo.find(subscription.id).unwrap(),
            Some(subscription.clone())
        );
        assert_eq!(repo.list().unwrap(), vec![subscription.clone()]);

        let mut updated = subscription.clone();
        updated.status = SubscriptionStatus::Canceled;
        repo.save(&updated).unwrap();
        assert_eq!(repo.find(subscription.id).unwrap(), Some(updated));
    }

    #[test]
    fn invoice_repository_roundtrip() {
        let repo = RedbInvoiceRepository::new(store());
        let now = Utc::now();
        let invoice = Invoice {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            subscription_id: Uuid::new_v4(),
            amount_cents: 99_000,
            currency: "RUB".into(),
            status: InvoiceStatus::Draft,
            period_start: now,
            period_end: now + Duration::days(30),
            due_at: now + Duration::days(3),
            paid_at: None,
            attempts: 0,
        };
        repo.save(&invoice).unwrap();

        assert_eq!(repo.find(invoice.id).unwrap(), Some(invoice.clone()));
        assert_eq!(repo.list().unwrap(), vec![invoice.clone()]);

        let mut paid = invoice.clone();
        paid.status = InvoiceStatus::Paid;
        paid.paid_at = Some(now);
        paid.attempts = 1;
        repo.save(&paid).unwrap();
        assert_eq!(repo.find(invoice.id).unwrap(), Some(paid));
    }

    #[test]
    fn repositories_share_one_store() {
        let store = store();
        let plans = RedbPlanRepository::new(store.clone());
        let invoices = RedbInvoiceRepository::new(store);
        let now = Utc::now();
        let plan = Plan {
            id: Uuid::new_v4(),
            name: "Pro".into(),
            description: String::new(),
            price_cents: 1000,
            currency: "RUB".into(),
            period: BillingPeriod::Month,
            tariff_id: Uuid::new_v4(),
            active: true,
            created_at: now,
            updated_at: now,
        };
        plans.save(&plan).unwrap();
        let invoice = Invoice {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            subscription_id: Uuid::new_v4(),
            amount_cents: 1000,
            currency: "RUB".into(),
            status: InvoiceStatus::Open,
            period_start: now,
            period_end: now + Duration::days(30),
            due_at: now,
            paid_at: None,
            attempts: 0,
        };
        invoices.save(&invoice).unwrap();

        assert_eq!(plans.list().unwrap().len(), 1);
        assert_eq!(invoices.list().unwrap().len(), 1);
    }
}
