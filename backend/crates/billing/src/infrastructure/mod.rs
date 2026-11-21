use std::sync::Arc;

use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_storage::{Store, Table};

use crate::domain::{
    EventClaim, Invoice, InvoiceRepository, PaymentEventRecord, PaymentEventRepository,
    PaymentEventStatus, PaymentMethod, PaymentMethodRepository, Plan, PlanRepository, Subscription,
    SubscriptionRepository,
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

pub struct RedbPaymentMethodRepository {
    store: Arc<Store>,
}

impl RedbPaymentMethodRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

impl PaymentMethodRepository for RedbPaymentMethodRepository {
    fn find(&self, id: Uuid) -> CoreResult<Option<PaymentMethod>> {
        self.store
            .get(Table::BillingPaymentMethods, &id.to_string())
            .map_err(map_err)
    }

    fn list_for_user(&self, user_id: Uuid) -> CoreResult<Vec<PaymentMethod>> {
        let mut methods = self
            .store
            .list::<PaymentMethod>(Table::BillingPaymentMethods)
            .map_err(map_err)?
            .into_iter()
            .filter(|method| method.user_id == user_id)
            .collect::<Vec<_>>();
        methods.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(methods)
    }

    fn save(&self, method: &PaymentMethod) -> CoreResult<()> {
        self.store
            .put(Table::BillingPaymentMethods, &method.id.to_string(), method)
            .map_err(map_err)
    }
}

pub struct RedbPaymentEventRepository {
    store: Arc<Store>,
}

impl RedbPaymentEventRepository {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

fn event_key(gateway: &str, event_id: &str) -> String {
    format!("{gateway}:{event_id}")
}

impl PaymentEventRepository for RedbPaymentEventRepository {
    fn find(&self, gateway: &str, event_id: &str) -> CoreResult<Option<PaymentEventRecord>> {
        self.store
            .get(Table::BillingEvents, &event_key(gateway, event_id))
            .map_err(map_err)
    }

    fn list(&self) -> CoreResult<Vec<PaymentEventRecord>> {
        self.store.list(Table::BillingEvents).map_err(map_err)
    }

    fn save(&self, event: &PaymentEventRecord) -> CoreResult<()> {
        self.store
            .put(
                Table::BillingEvents,
                &event_key(&event.gateway, &event.event_id),
                event,
            )
            .map_err(map_err)
    }

    fn claim(&self, event: &PaymentEventRecord) -> CoreResult<EventClaim> {
        // `Store::update` runs the closure inside a single write transaction,
        // so the read-modify-write below is an atomic insert-if-absent.
        self.store
            .update::<PaymentEventRecord, _>(
                Table::BillingEvents,
                &event_key(&event.gateway, &event.event_id),
                |current| match current {
                    None => (Some(event.clone()), EventClaim::Claimed),
                    Some(existing) => (Some(existing.clone()), EventClaim::Held(existing)),
                },
            )
            .map_err(map_err)
    }

    fn retry(&self, gateway: &str, event_id: &str) -> CoreResult<bool> {
        self.store
            .update::<PaymentEventRecord, _>(
                Table::BillingEvents,
                &event_key(gateway, event_id),
                |current| match current {
                    Some(mut existing) if existing.status == PaymentEventStatus::Failed => {
                        existing.status = PaymentEventStatus::Processing;
                        (Some(existing), true)
                    }
                    Some(existing) => (Some(existing), false),
                    None => (None, false),
                },
            )
            .map_err(map_err)
    }

    fn mark(&self, gateway: &str, event_id: &str, status: PaymentEventStatus) -> CoreResult<()> {
        self.store
            .update::<PaymentEventRecord, _>(
                Table::BillingEvents,
                &event_key(gateway, event_id),
                |current| match current {
                    Some(mut existing) => {
                        existing.status = status;
                        (Some(existing), ())
                    }
                    None => (None, ()),
                },
            )
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
    use crate::domain::{
        BillingPeriod, EventClaim, InvoiceStatus, PaymentEventStatus, SubscriptionStatus,
    };

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
            gateway: None,
            gateway_ref: None,
            checkout_url: None,
        };
        repo.save(&invoice).unwrap();

        assert_eq!(repo.find(invoice.id).unwrap(), Some(invoice.clone()));
        assert_eq!(repo.list().unwrap(), vec![invoice.clone()]);

        let mut paid = invoice.clone();
        paid.status = InvoiceStatus::Paid;
        paid.paid_at = Some(now);
        paid.attempts = 1;
        paid.gateway = Some("mock".into());
        paid.gateway_ref = Some("gw-1".into());
        paid.checkout_url = Some("http://localhost/pay/mock/x".into());
        repo.save(&paid).unwrap();
        assert_eq!(repo.find(invoice.id).unwrap(), Some(paid));
    }

    #[test]
    fn invoice_without_gateway_fields_is_deserialized() {
        let store = store();
        let now = Utc::now();
        let id = Uuid::new_v4();
        let legacy = serde_json::json!({
            "id": id,
            "user_id": Uuid::new_v4(),
            "subscription_id": Uuid::new_v4(),
            "amount_cents": 1000,
            "currency": "RUB",
            "status": "open",
            "period_start": now,
            "period_end": now + Duration::days(30),
            "due_at": now,
            "paid_at": null,
            "attempts": 0
        });
        store
            .put(Table::BillingInvoices, &id.to_string(), &legacy)
            .unwrap();
        let repo = RedbInvoiceRepository::new(store);
        let invoice = repo.find(id).unwrap().unwrap();
        assert_eq!(invoice.gateway, None);
        assert_eq!(invoice.gateway_ref, None);
        assert_eq!(invoice.checkout_url, None);
    }

    #[test]
    fn payment_method_repository_filters_by_user() {
        let repo = RedbPaymentMethodRepository::new(store());
        let owner = Uuid::new_v4();
        let now = Utc::now();
        for (user_id, suffix) in [(owner, "a"), (owner, "b"), (Uuid::new_v4(), "c")] {
            repo.save(&PaymentMethod {
                id: Uuid::new_v4(),
                user_id,
                gateway: "mock".into(),
                gateway_ref: format!("pm-{suffix}"),
                brand: "visa".into(),
                last4: "4242".into(),
                is_default: suffix == "a",
                created_at: now,
            })
            .unwrap();
        }
        assert_eq!(repo.list_for_user(owner).unwrap().len(), 2);
    }

    #[test]
    fn payment_event_is_unique_per_gateway_and_event_id() {
        let repo = RedbPaymentEventRepository::new(store());
        let now = Utc::now();
        let event = PaymentEventRecord {
            event_id: "evt-1".into(),
            gateway: "mock".into(),
            kind: "payment.succeeded".into(),
            invoice_id: Some(Uuid::new_v4()),
            received_at: now,
            payload_hash: "hash".into(),
            status: PaymentEventStatus::Processed,
        };
        repo.save(&event).unwrap();

        let found = repo.find("mock", "evt-1").unwrap().unwrap();
        assert_eq!(found, event);
        assert!(repo.find("other", "evt-1").unwrap().is_none());
        assert_eq!(repo.list().unwrap().len(), 1);
    }

    fn event_record() -> PaymentEventRecord {
        PaymentEventRecord {
            event_id: "evt-claim".into(),
            gateway: "mock".into(),
            kind: "payment.succeeded".into(),
            invoice_id: Some(Uuid::new_v4()),
            received_at: Utc::now(),
            payload_hash: "hash".into(),
            status: PaymentEventStatus::Processing,
        }
    }

    #[test]
    fn payment_event_claim_is_atomic_and_retryable() {
        let repo = Arc::new(RedbPaymentEventRepository::new(store()));
        let event = event_record();

        assert_eq!(repo.claim(&event).unwrap(), EventClaim::Claimed);
        assert!(matches!(
            repo.claim(&event).unwrap(),
            EventClaim::Held(existing) if existing.status == PaymentEventStatus::Processing
        ));

        repo.mark("mock", "evt-claim", PaymentEventStatus::Failed)
            .unwrap();
        assert!(repo.retry("mock", "evt-claim").unwrap());
        assert!(!repo.retry("mock", "evt-claim").unwrap());
        assert_eq!(
            repo.find("mock", "evt-claim").unwrap().unwrap().status,
            PaymentEventStatus::Processing
        );

        repo.mark("mock", "evt-claim", PaymentEventStatus::Processed)
            .unwrap();
        assert!(!repo.retry("mock", "evt-claim").unwrap());
    }

    #[test]
    fn concurrent_claims_elect_exactly_one_owner() {
        let repo = Arc::new(RedbPaymentEventRepository::new(store()));
        let event = event_record();
        let mut handles = Vec::new();
        for _ in 0..8 {
            let repo = repo.clone();
            let event = event.clone();
            handles.push(std::thread::spawn(move || repo.claim(&event).unwrap()));
        }
        let claims: Vec<EventClaim> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(
            claims
                .iter()
                .filter(|claim| matches!(claim, EventClaim::Claimed))
                .count(),
            1
        );
        assert_eq!(repo.list().unwrap().len(), 1);
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
            gateway: None,
            gateway_ref: None,
            checkout_url: None,
        };
        invoices.save(&invoice).unwrap();

        assert_eq!(plans.list().unwrap().len(), 1);
        assert_eq!(invoices.list().unwrap().len(), 1);
    }
}
