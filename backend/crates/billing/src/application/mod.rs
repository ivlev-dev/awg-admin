use std::sync::Arc;

use chrono::{DateTime, Months, Utc};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    BillingPeriod, CheckoutRequest, GatewayError, Invoice, InvoiceRepository, InvoiceStatus,
    PaymentEvent, PaymentEventKind, PaymentEventRecord, PaymentEventRepository, PaymentGateway,
    PaymentMethod, PaymentMethodInfo, PaymentMethodRepository, Plan, PlanRepository, Subscription,
    SubscriptionRepository, SubscriptionStatus, WebhookRequest, normalize_currency, payload_sha256,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingSettings {
    pub currency: String,
    pub trial_days: u32,
    pub success_url: String,
    pub cancel_url: String,
}

impl BillingSettings {
    pub fn new(currency: impl Into<String>, trial_days: u32, public_url: &str) -> Self {
        let base = public_url.trim().trim_end_matches('/');
        let base = if base.is_empty() {
            "http://localhost"
        } else {
            base
        };
        Self {
            currency: currency.into(),
            trial_days,
            success_url: format!("{base}/billing?status=success"),
            cancel_url: format!("{base}/billing?status=cancel"),
        }
    }
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

#[derive(Debug, Clone, PartialEq)]
pub struct CheckoutOutcome {
    pub invoice: Invoice,
    pub checkout_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookOutcome {
    Processed { event_id: String },
    Duplicate { event_id: String },
    Ignored { event_id: String },
}

impl WebhookOutcome {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Processed { .. } => "processed",
            Self::Duplicate { .. } => "duplicate",
            Self::Ignored { .. } => "ignored",
        }
    }

    pub fn event_id(&self) -> &str {
        match self {
            Self::Processed { event_id }
            | Self::Duplicate { event_id }
            | Self::Ignored { event_id } => event_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookError {
    UnknownProvider(String),
    Invalid(String),
    Internal(String),
}

impl From<CoreError> for WebhookError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Invalid(message) | CoreError::NotFound(message) => Self::Invalid(message),
            CoreError::Conflict(message) | CoreError::Forbidden(message) => Self::Invalid(message),
            other => Self::Internal(other.to_string()),
        }
    }
}

pub trait TariffCatalog: Send + Sync {
    fn exists(&self, tariff_id: Uuid) -> CoreResult<bool>;
}

pub struct BillingService {
    plans: Arc<dyn PlanRepository>,
    subscriptions: Arc<dyn SubscriptionRepository>,
    invoices: Arc<dyn InvoiceRepository>,
    payment_methods: Arc<dyn PaymentMethodRepository>,
    payment_events: Arc<dyn PaymentEventRepository>,
    tariffs: Arc<dyn TariffCatalog>,
    gateway: Arc<dyn PaymentGateway>,
    settings: BillingSettings,
}

impl BillingService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        plans: Arc<dyn PlanRepository>,
        subscriptions: Arc<dyn SubscriptionRepository>,
        invoices: Arc<dyn InvoiceRepository>,
        payment_methods: Arc<dyn PaymentMethodRepository>,
        payment_events: Arc<dyn PaymentEventRepository>,
        tariffs: Arc<dyn TariffCatalog>,
        gateway: Arc<dyn PaymentGateway>,
        settings: BillingSettings,
    ) -> Self {
        Self {
            plans,
            subscriptions,
            invoices,
            payment_methods,
            payment_events,
            tariffs,
            gateway,
            settings,
        }
    }

    pub fn settings(&self) -> &BillingSettings {
        &self.settings
    }

    pub fn provider_name(&self) -> &'static str {
        self.gateway.provider_name()
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

    pub fn payment_methods_for_user(&self, user_id: Uuid) -> CoreResult<Vec<PaymentMethod>> {
        self.payment_methods.list_for_user(user_id)
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

    pub fn start_checkout(
        &self,
        user_id: Uuid,
        plan_id: Uuid,
        now: DateTime<Utc>,
    ) -> CoreResult<CheckoutOutcome> {
        let plan = self.get_plan(plan_id)?;
        if !plan.active {
            return Err(CoreError::Conflict("plan is not active".into()));
        }

        let mut subscription = match self.current_subscription(user_id)? {
            Some(existing) if existing.plan_id != plan.id => {
                return Err(CoreError::Conflict(
                    "user already has a subscription for another plan".into(),
                ));
            }
            Some(existing) if existing.grants_access() => {
                return Err(CoreError::Conflict(
                    "subscription already grants access".into(),
                ));
            }
            Some(existing) => existing,
            None => {
                let subscription = Subscription {
                    id: Uuid::new_v4(),
                    user_id,
                    plan_id: plan.id,
                    status: SubscriptionStatus::Incomplete,
                    current_period_start: now,
                    current_period_end: advance_period(plan.period, now)?,
                    auto_renew: true,
                    cancel_at_period_end: false,
                    trial_ends_at: None,
                    gateway: Some(self.provider_name().to_string()),
                    gateway_ref: None,
                    created_at: now,
                    updated_at: now,
                };
                self.subscriptions.save(&subscription)?;
                subscription
            }
        };

        let mut invoice = match self.reusable_invoice(subscription.id, now)? {
            Some(invoice) => invoice,
            None => {
                let invoice = Invoice {
                    id: Uuid::new_v4(),
                    user_id,
                    subscription_id: subscription.id,
                    amount_cents: plan.price_cents,
                    currency: plan.currency.clone(),
                    status: InvoiceStatus::Open,
                    period_start: subscription.current_period_start,
                    period_end: subscription.current_period_end,
                    due_at: now,
                    paid_at: None,
                    attempts: 0,
                    gateway: Some(self.provider_name().to_string()),
                    gateway_ref: None,
                    checkout_url: None,
                };
                self.invoices.save(&invoice)?;
                invoice
            }
        };

        if let Some(url) = invoice.checkout_url.clone() {
            return Ok(CheckoutOutcome {
                invoice,
                checkout_url: url,
            });
        }

        let session = self
            .gateway
            .create_checkout(CheckoutRequest {
                user_id,
                plan_id: plan.id,
                invoice_id: invoice.id,
                amount_cents: invoice.amount_cents,
                currency: invoice.currency.clone(),
                success_url: self.settings.success_url.clone(),
                cancel_url: self.settings.cancel_url.clone(),
            })
            .map_err(gateway_error)?;

        invoice.gateway = Some(self.provider_name().to_string());
        invoice.gateway_ref = Some(session.gateway_ref);
        invoice.checkout_url = Some(session.url.clone());
        self.invoices.save(&invoice)?;

        subscription.updated_at = now;
        self.subscriptions.save(&subscription)?;

        Ok(CheckoutOutcome {
            invoice,
            checkout_url: session.url,
        })
    }

    pub fn handle_webhook(
        &self,
        provider: &str,
        headers: &[(String, String)],
        body: &[u8],
        now: DateTime<Utc>,
    ) -> Result<WebhookOutcome, WebhookError> {
        if provider.trim() != self.gateway.provider_name() {
            return Err(WebhookError::UnknownProvider(provider.to_string()));
        }
        let request = WebhookRequest {
            headers: headers.to_vec(),
            body: body.to_vec(),
        };
        self.gateway
            .verify_webhook(&request, now)
            .map_err(webhook_gateway_error)?;
        let event = self
            .gateway
            .parse_event(&request)
            .map_err(webhook_gateway_error)?;
        let hash = payload_sha256(body);

        if let Some(existing) = self
            .payment_events
            .find(&event.gateway, &event.event_id)
            .map_err(WebhookError::from)?
        {
            if existing.payload_hash == hash {
                return Ok(WebhookOutcome::Duplicate {
                    event_id: event.event_id,
                });
            }
            return Err(WebhookError::Invalid(
                "duplicate event id with a different payload".into(),
            ));
        }

        let outcome = match &event.kind {
            PaymentEventKind::PaymentSucceeded => {
                self.apply_payment_succeeded(&event, now)?;
                WebhookOutcome::Processed {
                    event_id: event.event_id.clone(),
                }
            }
            PaymentEventKind::PaymentFailed => {
                self.apply_payment_failed(&event)?;
                WebhookOutcome::Processed {
                    event_id: event.event_id.clone(),
                }
            }
            PaymentEventKind::RefundSucceeded => WebhookOutcome::Processed {
                event_id: event.event_id.clone(),
            },
            PaymentEventKind::Other(_) => WebhookOutcome::Ignored {
                event_id: event.event_id.clone(),
            },
        };

        self.payment_events
            .save(&PaymentEventRecord {
                event_id: event.event_id,
                gateway: event.gateway,
                kind: event.kind.as_str().to_string(),
                invoice_id: event.invoice_id,
                received_at: now,
                payload_hash: hash,
            })
            .map_err(WebhookError::from)?;

        Ok(outcome)
    }

    fn reusable_invoice(
        &self,
        subscription_id: Uuid,
        now: DateTime<Utc>,
    ) -> CoreResult<Option<Invoice>> {
        let mut found: Option<Invoice> = None;
        for invoice in self.invoices.list()? {
            if invoice.subscription_id != subscription_id || !invoice.is_reusable_open(now) {
                continue;
            }
            let replace = found.as_ref().is_none_or(|existing| {
                (invoice.period_start, invoice.id) > (existing.period_start, existing.id)
            });
            if replace {
                found = Some(invoice);
            }
        }
        Ok(found)
    }

    fn apply_payment_succeeded(
        &self,
        event: &PaymentEvent,
        now: DateTime<Utc>,
    ) -> Result<(), WebhookError> {
        let invoice_id = event
            .invoice_id
            .ok_or_else(|| WebhookError::Invalid("invoice_id is required".into()))?;
        let mut invoice = self
            .invoices
            .find(invoice_id)
            .map_err(WebhookError::from)?
            .ok_or_else(|| WebhookError::Invalid("invoice not found".into()))?;

        if invoice.status == InvoiceStatus::Paid {
            return Ok(());
        }
        if invoice.status != InvoiceStatus::Open {
            return Err(WebhookError::Invalid(
                "invoice is not payable in its current state".into(),
            ));
        }

        let amount_cents = event
            .amount_cents
            .ok_or_else(|| WebhookError::Invalid("amount_cents is required".into()))?;
        if amount_cents != invoice.amount_cents {
            return Err(WebhookError::Invalid(
                "payment amount does not match the invoice".into(),
            ));
        }
        let currency = event
            .currency
            .as_deref()
            .ok_or_else(|| WebhookError::Invalid("currency is required".into()))?;
        let currency = normalize_currency(currency).map_err(WebhookError::from)?;
        if currency != invoice.currency {
            return Err(WebhookError::Invalid(
                "payment currency does not match the invoice".into(),
            ));
        }

        let gateway_ref = event
            .gateway_ref
            .clone()
            .or_else(|| invoice.gateway_ref.clone());

        invoice.status = InvoiceStatus::Paid;
        invoice.paid_at = Some(now);
        invoice.gateway = Some(event.gateway.clone());
        invoice.gateway_ref = gateway_ref.clone();
        self.invoices.save(&invoice).map_err(WebhookError::from)?;

        if let Some(method) = &event.payment_method {
            self.upsert_payment_method(invoice.user_id, &event.gateway, method, now)?;
        }

        let mut subscription = self
            .subscriptions
            .find(invoice.subscription_id)
            .map_err(WebhookError::from)?
            .ok_or_else(|| WebhookError::Invalid("subscription not found".into()))?;
        subscription.status = SubscriptionStatus::Active;
        subscription.gateway = Some(event.gateway.clone());
        if gateway_ref.is_some() {
            subscription.gateway_ref = gateway_ref;
        }
        subscription.current_period_start = invoice.period_start;
        subscription.current_period_end = invoice.period_end;
        subscription.updated_at = now;
        self.subscriptions
            .save(&subscription)
            .map_err(WebhookError::from)?;
        Ok(())
    }

    fn apply_payment_failed(&self, event: &PaymentEvent) -> Result<(), WebhookError> {
        let invoice_id = event
            .invoice_id
            .ok_or_else(|| WebhookError::Invalid("invoice_id is required".into()))?;
        let mut invoice = self
            .invoices
            .find(invoice_id)
            .map_err(WebhookError::from)?
            .ok_or_else(|| WebhookError::Invalid("invoice not found".into()))?;
        if invoice.status == InvoiceStatus::Paid {
            return Ok(());
        }
        if invoice.status != InvoiceStatus::Open {
            return Err(WebhookError::Invalid(
                "invoice is not payable in its current state".into(),
            ));
        }
        invoice.attempts = invoice.attempts.saturating_add(1);
        self.invoices.save(&invoice).map_err(WebhookError::from)
    }

    fn upsert_payment_method(
        &self,
        user_id: Uuid,
        gateway: &str,
        method: &PaymentMethodInfo,
        now: DateTime<Utc>,
    ) -> Result<(), WebhookError> {
        let existing = self
            .payment_methods
            .list_for_user(user_id)
            .map_err(WebhookError::from)?;
        let matched = existing
            .iter()
            .find(|item| item.gateway == gateway && item.gateway_ref == method.gateway_ref);
        let record = match matched {
            Some(item) => PaymentMethod {
                brand: method.brand.clone(),
                last4: method.last4.clone(),
                ..item.clone()
            },
            None => PaymentMethod {
                id: Uuid::new_v4(),
                user_id,
                gateway: gateway.to_string(),
                gateway_ref: method.gateway_ref.clone(),
                brand: method.brand.clone(),
                last4: method.last4.clone(),
                is_default: existing.is_empty(),
                created_at: now,
            },
        };
        self.payment_methods
            .save(&record)
            .map_err(WebhookError::from)
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

fn advance_period(period: BillingPeriod, from: DateTime<Utc>) -> CoreResult<DateTime<Utc>> {
    from.checked_add_months(Months::new(period.months()))
        .ok_or_else(|| CoreError::Invalid("billing period is out of range".into()))
}

fn gateway_error(error: GatewayError) -> CoreError {
    match error {
        GatewayError::Unsupported => {
            CoreError::Conflict("payment gateway does not support checkout".into())
        }
        other => CoreError::Invalid(other.to_string()),
    }
}

fn webhook_gateway_error(error: GatewayError) -> WebhookError {
    match error {
        GatewayError::Unsupported => {
            WebhookError::Invalid("payment gateway does not support webhooks".into())
        }
        other => WebhookError::Invalid(other.to_string()),
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
    use chrono::TimeZone;

    use super::*;
    use crate::domain::{MockGateway, NoopGateway, sign_webhook};
    use crate::infrastructure::{
        RedbInvoiceRepository, RedbPaymentEventRepository, RedbPaymentMethodRepository,
        RedbPlanRepository, RedbSubscriptionRepository,
    };

    const SECRET: &str = "test-secret-that-is-at-least-32-chars-long";
    const TOLERANCE: i64 = 300;

    struct Tariffs {
        known: Vec<Uuid>,
    }

    impl TariffCatalog for Tariffs {
        fn exists(&self, tariff_id: Uuid) -> CoreResult<bool> {
            Ok(self.known.contains(&tariff_id))
        }
    }

    struct Harness {
        service: BillingService,
        subscriptions: Arc<dyn SubscriptionRepository>,
        invoices: Arc<dyn InvoiceRepository>,
        events: Arc<dyn PaymentEventRepository>,
        tariff_id: Uuid,
    }

    impl Harness {
        fn new(gateway: Arc<dyn PaymentGateway>) -> Self {
            let store = Arc::new(Store::open_in_memory().unwrap());
            let plans: Arc<dyn PlanRepository> = Arc::new(RedbPlanRepository::new(store.clone()));
            let subscriptions: Arc<dyn SubscriptionRepository> =
                Arc::new(RedbSubscriptionRepository::new(store.clone()));
            let invoices: Arc<dyn InvoiceRepository> =
                Arc::new(RedbInvoiceRepository::new(store.clone()));
            let methods: Arc<dyn PaymentMethodRepository> =
                Arc::new(RedbPaymentMethodRepository::new(store.clone()));
            let events: Arc<dyn PaymentEventRepository> =
                Arc::new(RedbPaymentEventRepository::new(store.clone()));
            let tariff_id = Uuid::new_v4();
            let service = BillingService::new(
                plans.clone(),
                subscriptions.clone(),
                invoices.clone(),
                methods.clone(),
                events.clone(),
                Arc::new(Tariffs {
                    known: vec![tariff_id],
                }),
                gateway,
                BillingSettings::new("RUB", 0, "https://panel.test"),
            );
            Self {
                service,
                subscriptions,
                invoices,
                events,
                tariff_id,
            }
        }

        fn mock() -> Self {
            Self::new(Arc::new(MockGateway::new(
                SECRET,
                "https://panel.test",
                TOLERANCE,
            )))
        }

        fn plan(&self, price_cents: i64) -> Plan {
            self.service
                .create_plan(NewPlan {
                    name: "Pro".into(),
                    description: String::new(),
                    price_cents,
                    currency: "RUB".into(),
                    period: BillingPeriod::Month,
                    tariff_id: self.tariff_id,
                    active: true,
                })
                .unwrap()
        }
    }

    fn at(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, day, 12, 0, 0).unwrap()
    }

    fn event_body(
        event_id: &str,
        kind: &str,
        invoice_id: Uuid,
        amount_cents: i64,
        currency: &str,
    ) -> String {
        format!(
            r#"{{"event_id":"{event_id}","kind":"{kind}","invoice_id":"{invoice_id}","amount_cents":{amount_cents},"currency":"{currency}","gateway_ref":"gw-{event_id}"}}"#
        )
    }

    fn signed(headers_body: String, timestamp: i64) -> (Vec<(String, String)>, Vec<u8>) {
        let body = headers_body.into_bytes();
        let headers = vec![
            ("X-Mock-Timestamp".to_string(), timestamp.to_string()),
            (
                "X-Mock-Signature".to_string(),
                sign_webhook(SECRET, timestamp, &body),
            ),
        ];
        (headers, body)
    }

    #[test]
    fn plan_crud() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let service = &harness.service;
        let tariff_id = harness.tariff_id;

        let plan = service
            .create_plan(NewPlan {
                name: "Pro".into(),
                description: "Pro plan".into(),
                price_cents: 99_000,
                currency: "rub".into(),
                period: BillingPeriod::Month,
                tariff_id,
                active: true,
            })
            .unwrap();
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
        let harness = Harness::new(Arc::new(NoopGateway));
        let service = &harness.service;
        let tariff_id = harness.tariff_id;
        let mut invalid = NewPlan {
            name: "Pro".into(),
            description: String::new(),
            price_cents: -1,
            currency: "RUB".into(),
            period: BillingPeriod::Month,
            tariff_id,
            active: true,
        };
        assert!(service.create_plan(invalid.clone()).is_err());

        invalid.price_cents = 1000;
        invalid.tariff_id = Uuid::new_v4();
        assert!(service.create_plan(invalid).is_err());
    }

    #[test]
    fn plan_currency_must_match_configuration() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let mut plan = NewPlan {
            name: "Pro".into(),
            description: String::new(),
            price_cents: 1000,
            currency: "USD".into(),
            period: BillingPeriod::Month,
            tariff_id: harness.tariff_id,
            active: true,
        };
        assert!(harness.service.create_plan(plan.clone()).is_err());
        plan.currency = "RU".into();
        assert!(harness.service.create_plan(plan).is_err());
    }

    #[test]
    fn update_unknown_plan_is_not_found() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let error = harness
            .service
            .update_plan(Uuid::new_v4(), PlanChanges::default())
            .unwrap_err();
        assert!(matches!(error, CoreError::NotFound(_)));
    }

    #[test]
    fn current_subscription_prefers_latest_non_canceled() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let user_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        let now = at(16);
        harness
            .subscriptions
            .save(&subscription(
                user_id,
                plan_id,
                SubscriptionStatus::Canceled,
                now,
            ))
            .unwrap();
        let active = subscription(user_id, plan_id, SubscriptionStatus::Active, now);
        harness.subscriptions.save(&active).unwrap();

        assert_eq!(
            harness
                .service
                .current_subscription(user_id)
                .unwrap()
                .unwrap()
                .id,
            active.id
        );
    }

    #[test]
    fn plan_for_user_requires_access_granting_status() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let plan = harness.plan(1000);
        let user_id = Uuid::new_v4();

        assert_eq!(harness.service.plan_for_user(user_id).unwrap(), None);

        let active = subscription(user_id, plan.id, SubscriptionStatus::Active, Utc::now());
        harness.subscriptions.save(&active).unwrap();
        assert_eq!(
            harness.service.plan_for_user(user_id).unwrap(),
            Some(harness.tariff_id)
        );

        let mut canceled = active.clone();
        canceled.id = Uuid::new_v4();
        canceled.status = SubscriptionStatus::Canceled;
        canceled.created_at += chrono::Duration::days(1);
        harness.subscriptions.save(&canceled).unwrap();
        assert_eq!(
            harness.service.plan_for_user(user_id).unwrap(),
            Some(harness.tariff_id)
        );

        let incomplete = subscription(
            Uuid::new_v4(),
            plan.id,
            SubscriptionStatus::Incomplete,
            Utc::now(),
        );
        harness.subscriptions.save(&incomplete).unwrap();
        assert_eq!(
            harness.service.plan_for_user(incomplete.user_id).unwrap(),
            None
        );
    }

    #[test]
    fn invoices_are_filtered_and_sorted() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let user_id = Uuid::new_v4();
        let other = Uuid::new_v4();
        let now = at(16);

        let recent = invoice(user_id, now + chrono::Duration::days(30));
        let old = invoice(user_id, now);
        let foreign = invoice(other, now + chrono::Duration::days(60));
        for value in [&recent, &old, &foreign] {
            harness.invoices.save(value).unwrap();
        }

        let invoices = harness.service.invoices_for_user(user_id, 10).unwrap();
        assert_eq!(invoices.len(), 2);
        assert_eq!(invoices[0].id, recent.id);
        assert_eq!(invoices[1].id, old.id);
        assert_eq!(
            harness.service.invoices_for_user(user_id, 1).unwrap().len(),
            1
        );

        let all = harness.service.invoices_for_admin(None, 10).unwrap();
        assert_eq!(all.len(), 3);
        let filtered = harness.service.invoices_for_admin(Some(other), 10).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, foreign.id);
    }

    #[test]
    fn admin_subscription_listing_is_paginated_and_filtered() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let user_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        let now = at(16);

        for (status, days) in [
            (SubscriptionStatus::Active, 0),
            (SubscriptionStatus::Active, 1),
            (SubscriptionStatus::PastDue, 2),
        ] {
            harness
                .subscriptions
                .save(&subscription(
                    user_id,
                    plan_id,
                    status,
                    now + chrono::Duration::days(days),
                ))
                .unwrap();
        }

        assert_eq!(harness.service.count_subscriptions(None).unwrap(), 3);
        assert_eq!(
            harness
                .service
                .count_subscriptions(Some(SubscriptionStatus::Active))
                .unwrap(),
            2
        );

        let page = harness.service.list_subscriptions(None, 0, 2).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].status, SubscriptionStatus::PastDue);

        let filtered = harness
            .service
            .list_subscriptions(Some(SubscriptionStatus::Active), 1, 2)
            .unwrap();
        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn checkout_creates_exactly_one_invoice() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let user_id = Uuid::new_v4();
        let now = at(17);

        let first = harness
            .service
            .start_checkout(user_id, plan.id, now)
            .unwrap();
        let second = harness
            .service
            .start_checkout(user_id, plan.id, now)
            .unwrap();

        assert_eq!(first.invoice.id, second.invoice.id);
        assert_eq!(first.checkout_url, second.checkout_url);
        assert_eq!(harness.invoices.list().unwrap().len(), 1);
        assert!(first.checkout_url.contains("/pay/mock/"));
        assert_eq!(
            first.invoice.checkout_url.as_deref(),
            Some(first.checkout_url.as_str())
        );
        assert_eq!(first.invoice.amount_cents, 99_000);
        assert_eq!(first.invoice.status, InvoiceStatus::Open);

        let subscription = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();
        assert_eq!(subscription.status, SubscriptionStatus::Incomplete);
        assert_eq!(subscription.current_period_start, now);
        assert_eq!(
            subscription.current_period_end,
            Utc.with_ymd_and_hms(2026, 12, 17, 12, 0, 0).unwrap()
        );
        assert!(!subscription.grants_access());
    }

    #[test]
    fn checkout_rejects_inactive_plan() {
        let harness = Harness::mock();
        let plan = harness.plan(1000);
        harness
            .service
            .update_plan(
                plan.id,
                PlanChanges {
                    active: Some(false),
                    ..PlanChanges::default()
                },
            )
            .unwrap();
        let error = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, at(17))
            .unwrap_err();
        assert!(matches!(error, CoreError::Conflict(_)));
        assert!(harness.invoices.list().unwrap().is_empty());
    }

    #[test]
    fn checkout_for_year_plan_uses_calendar_year() {
        let harness = Harness::mock();
        let plan = harness
            .service
            .create_plan(NewPlan {
                name: "Annual".into(),
                description: String::new(),
                price_cents: 900_000,
                currency: "RUB".into(),
                period: BillingPeriod::Year,
                tariff_id: harness.tariff_id,
                active: true,
            })
            .unwrap();
        let user_id = Uuid::new_v4();
        harness
            .service
            .start_checkout(user_id, plan.id, at(17))
            .unwrap();
        let subscription = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            subscription.current_period_end,
            Utc.with_ymd_and_hms(2027, 11, 17, 12, 0, 0).unwrap()
        );
    }

    #[test]
    fn checkout_with_noop_gateway_is_rejected() {
        let harness = Harness::new(Arc::new(NoopGateway));
        let plan = harness.plan(1000);
        let error = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, at(17))
            .unwrap_err();
        assert!(matches!(error, CoreError::Conflict(_)));
    }

    #[test]
    fn successful_webhook_activates_subscription() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let user_id = Uuid::new_v4();
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(user_id, plan.id, now)
            .unwrap();

        let body = format!(
            r#"{{"event_id":"evt-1","kind":"payment.succeeded","invoice_id":"{}","amount_cents":99000,"currency":"RUB","gateway_ref":"gw-1","payment_method":{{"gateway_ref":"pm-1","brand":"visa","last4":"4242"}}}}"#,
            checkout.invoice.id
        );
        let (headers, body) = signed(body, now.timestamp());
        let outcome = harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap();
        assert_eq!(
            outcome,
            WebhookOutcome::Processed {
                event_id: "evt-1".into()
            }
        );

        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Paid);
        assert_eq!(invoice.paid_at, Some(now));
        assert_eq!(invoice.gateway_ref.as_deref(), Some("gw-1"));

        let subscription = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();
        assert_eq!(subscription.status, SubscriptionStatus::Active);
        assert!(subscription.grants_access());
        assert_eq!(subscription.current_period_start, invoice.period_start);
        assert_eq!(subscription.current_period_end, invoice.period_end);
        assert_eq!(subscription.gateway.as_deref(), Some("mock"));
        assert_eq!(subscription.gateway_ref.as_deref(), Some("gw-1"));

        let methods = harness.service.payment_methods_for_user(user_id).unwrap();
        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].brand, "visa");
        assert_eq!(methods[0].last4, "4242");
        assert!(methods[0].is_default);
    }

    #[test]
    fn repeated_webhook_is_deduplicated_and_does_not_extend_period() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let user_id = Uuid::new_v4();
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(user_id, plan.id, now)
            .unwrap();

        let body = event_body(
            "evt-1",
            "payment.succeeded",
            checkout.invoice.id,
            99_000,
            "RUB",
        );
        let (headers, body) = signed(body, now.timestamp());
        harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap();
        let first = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();

        let later = now + chrono::Duration::hours(1);
        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            later.timestamp(),
        );
        let outcome = harness
            .service
            .handle_webhook("mock", &headers, &body, later)
            .unwrap();
        assert_eq!(outcome.status(), "duplicate");
        assert_eq!(harness.events.list().unwrap().len(), 1);

        let second = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();
        assert_eq!(second.current_period_end, first.current_period_end);
        assert_eq!(second.updated_at, first.updated_at);
        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.paid_at, Some(now));
    }

    #[test]
    fn webhook_with_invalid_signature_is_rejected() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        let mut headers = headers;
        headers[1].1 = "0".repeat(64);
        let error = harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap_err();
        assert!(matches!(error, WebhookError::Invalid(_)));
        assert_eq!(harness.events.list().unwrap().len(), 0);
        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Open);
    }

    #[test]
    fn webhook_with_old_timestamp_is_rejected() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp() - TOLERANCE - 1,
        );
        let error = harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap_err();
        assert!(matches!(error, WebhookError::Invalid(_)));
        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Open);
    }

    #[test]
    fn webhook_with_amount_mismatch_changes_nothing() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let user_id = Uuid::new_v4();
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(user_id, plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body("evt-1", "payment.succeeded", checkout.invoice.id, 1, "RUB"),
            now.timestamp(),
        );
        let error = harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap_err();
        assert!(matches!(error, WebhookError::Invalid(_)));

        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Open);
        assert_eq!(invoice.paid_at, None);
        let subscription = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();
        assert_eq!(subscription.status, SubscriptionStatus::Incomplete);
        assert_eq!(harness.events.list().unwrap().len(), 0);
    }

    #[test]
    fn webhook_with_currency_mismatch_changes_nothing() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "USD",
            ),
            now.timestamp(),
        );
        assert!(matches!(
            harness
                .service
                .handle_webhook("mock", &headers, &body, now)
                .unwrap_err(),
            WebhookError::Invalid(_)
        ));
        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Open);
    }

    #[test]
    fn payment_failed_increments_attempts() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-2",
                "payment.failed",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap();
        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.attempts, 1);
        assert_eq!(invoice.status, InvoiceStatus::Open);
        assert_eq!(invoice.paid_at, None);
    }

    #[test]
    fn refund_and_unknown_events_are_recorded_without_changes() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-r",
                "refund.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        assert_eq!(
            harness
                .service
                .handle_webhook("mock", &headers, &body, now)
                .unwrap()
                .status(),
            "processed"
        );

        let (headers, body) = signed(
            event_body(
                "evt-u",
                "payment.requires_action",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        assert_eq!(
            harness
                .service
                .handle_webhook("mock", &headers, &body, now)
                .unwrap()
                .status(),
            "ignored"
        );

        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Open);
        assert_eq!(harness.events.list().unwrap().len(), 2);
    }

    #[test]
    fn webhook_for_unknown_provider_is_rejected() {
        let harness = Harness::mock();
        let (headers, body) = signed(
            event_body("evt-1", "payment.succeeded", Uuid::new_v4(), 1000, "RUB"),
            at(17).timestamp(),
        );
        let error = harness
            .service
            .handle_webhook("stripe", &headers, &body, at(17))
            .unwrap_err();
        assert!(matches!(error, WebhookError::UnknownProvider(_)));
    }

    #[test]
    fn duplicate_event_id_with_different_payload_is_rejected() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(Uuid::new_v4(), plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.failed",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        assert!(matches!(
            harness
                .service
                .handle_webhook("mock", &headers, &body, now)
                .unwrap_err(),
            WebhookError::Invalid(_)
        ));
        let invoice = harness.invoices.find(checkout.invoice.id).unwrap().unwrap();
        assert_eq!(invoice.status, InvoiceStatus::Open);
    }

    #[test]
    fn paid_invoice_is_not_extended_twice_by_a_new_event() {
        let harness = Harness::mock();
        let plan = harness.plan(99_000);
        let user_id = Uuid::new_v4();
        let now = at(17);
        let checkout = harness
            .service
            .start_checkout(user_id, plan.id, now)
            .unwrap();

        let (headers, body) = signed(
            event_body(
                "evt-1",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            now.timestamp(),
        );
        harness
            .service
            .handle_webhook("mock", &headers, &body, now)
            .unwrap();
        let first = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();

        let later = now + chrono::Duration::days(1);
        let (headers, body) = signed(
            event_body(
                "evt-2",
                "payment.succeeded",
                checkout.invoice.id,
                99_000,
                "RUB",
            ),
            later.timestamp(),
        );
        assert_eq!(
            harness
                .service
                .handle_webhook("mock", &headers, &body, later)
                .unwrap()
                .status(),
            "processed"
        );
        let second = harness
            .service
            .current_subscription(user_id)
            .unwrap()
            .unwrap();
        assert_eq!(second.current_period_end, first.current_period_end);
    }

    fn subscription(
        user_id: Uuid,
        plan_id: Uuid,
        status: SubscriptionStatus,
        created_at: DateTime<Utc>,
    ) -> Subscription {
        Subscription {
            id: Uuid::new_v4(),
            user_id,
            plan_id,
            status,
            current_period_start: created_at,
            current_period_end: created_at + chrono::Duration::days(30),
            auto_renew: true,
            cancel_at_period_end: false,
            trial_ends_at: None,
            gateway: None,
            gateway_ref: None,
            created_at,
            updated_at: created_at,
        }
    }

    fn invoice(user_id: Uuid, period_start: DateTime<Utc>) -> Invoice {
        Invoice {
            id: Uuid::new_v4(),
            user_id,
            subscription_id: Uuid::new_v4(),
            amount_cents: 99_000,
            currency: "RUB".into(),
            status: InvoiceStatus::Open,
            period_start,
            period_end: period_start + chrono::Duration::days(30),
            due_at: period_start,
            paid_at: None,
            attempts: 0,
            gateway: None,
            gateway_ref: None,
            checkout_url: None,
        }
    }
}
