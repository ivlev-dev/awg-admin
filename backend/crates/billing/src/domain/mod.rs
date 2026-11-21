use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

mod gateway;
mod mock;

pub use gateway::{
    ChargeRequest, ChargeResult, CheckoutRequest, CheckoutSession, GatewayError, NoopGateway,
    PaymentEvent, PaymentEventKind, PaymentGateway, PaymentMethodInfo, RefundRequest, RefundResult,
    WebhookRequest,
};
pub use mock::{
    DEFAULT_MOCK_TOLERANCE_SECS, MOCK_SIGNATURE_HEADER, MOCK_TIMESTAMP_HEADER, MockGateway,
    payload_sha256, sign_webhook, webhook_signature,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingPeriod {
    Month,
    Year,
}

impl BillingPeriod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Month => "month",
            Self::Year => "year",
        }
    }

    pub fn parse(raw: &str) -> CoreResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "month" | "monthly" => Ok(Self::Month),
            "year" | "yearly" | "annual" => Ok(Self::Year),
            other => Err(CoreError::Invalid(format!(
                "billing period must be month or year, got {other:?}"
            ))),
        }
    }

    pub fn months(self) -> u32 {
        match self {
            Self::Month => 1,
            Self::Year => 12,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Incomplete,
    Trialing,
    Active,
    PastDue,
    Suspended,
    Canceled,
}

impl SubscriptionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Incomplete => "incomplete",
            Self::Trialing => "trialing",
            Self::Active => "active",
            Self::PastDue => "past_due",
            Self::Suspended => "suspended",
            Self::Canceled => "canceled",
        }
    }

    pub fn parse(raw: &str) -> CoreResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "incomplete" => Ok(Self::Incomplete),
            "trialing" => Ok(Self::Trialing),
            "active" => Ok(Self::Active),
            "past_due" => Ok(Self::PastDue),
            "suspended" => Ok(Self::Suspended),
            "canceled" => Ok(Self::Canceled),
            other => Err(CoreError::Invalid(format!(
                "unknown subscription status {other:?}"
            ))),
        }
    }

    pub fn grants_access(self) -> bool {
        matches!(self, Self::Trialing | Self::Active)
    }

    pub fn is_current(self) -> bool {
        !matches!(self, Self::Canceled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    Draft,
    Open,
    Paid,
    Refunded,
    Void,
    Uncollectible,
}

impl InvoiceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Open => "open",
            Self::Paid => "paid",
            Self::Refunded => "refunded",
            Self::Void => "void",
            Self::Uncollectible => "uncollectible",
        }
    }

    pub fn parse(raw: &str) -> CoreResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "draft" => Ok(Self::Draft),
            "open" => Ok(Self::Open),
            "paid" => Ok(Self::Paid),
            "refunded" => Ok(Self::Refunded),
            "void" => Ok(Self::Void),
            "uncollectible" => Ok(Self::Uncollectible),
            other => Err(CoreError::Invalid(format!(
                "unknown invoice status {other:?}"
            ))),
        }
    }

    pub fn is_settled(self) -> bool {
        matches!(
            self,
            Self::Paid | Self::Refunded | Self::Void | Self::Uncollectible
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub price_cents: i64,
    pub currency: String,
    pub period: BillingPeriod,
    pub tariff_id: Uuid,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Plan {
    pub fn validate(&self) -> CoreResult<()> {
        if self.name.trim().is_empty() {
            return Err(CoreError::Invalid("plan name is required".into()));
        }
        if self.name.chars().count() > 120 {
            return Err(CoreError::Invalid(
                "plan name must not exceed 120 characters".into(),
            ));
        }
        if self.price_cents < 0 {
            return Err(CoreError::Invalid("plan price must not be negative".into()));
        }
        normalize_currency(&self.currency)?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subscription {
    pub id: Uuid,
    pub user_id: Uuid,
    pub plan_id: Uuid,
    pub status: SubscriptionStatus,
    pub current_period_start: DateTime<Utc>,
    pub current_period_end: DateTime<Utc>,
    pub auto_renew: bool,
    pub cancel_at_period_end: bool,
    pub trial_ends_at: Option<DateTime<Utc>>,
    pub gateway: Option<String>,
    pub gateway_ref: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Subscription {
    pub fn grants_access(&self) -> bool {
        self.status.grants_access()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Invoice {
    pub id: Uuid,
    pub user_id: Uuid,
    pub subscription_id: Uuid,
    pub amount_cents: i64,
    pub currency: String,
    pub status: InvoiceStatus,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub due_at: DateTime<Utc>,
    pub paid_at: Option<DateTime<Utc>>,
    pub attempts: u32,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub gateway_ref: Option<String>,
    #[serde(default)]
    pub checkout_url: Option<String>,
}

impl Invoice {
    pub fn is_reusable_open(&self, now: DateTime<Utc>) -> bool {
        self.status == InvoiceStatus::Open && now < self.period_end
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaymentMethod {
    pub id: Uuid,
    pub user_id: Uuid,
    pub gateway: String,
    pub gateway_ref: String,
    pub brand: String,
    pub last4: String,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

impl PaymentMethod {
    pub fn masked(&self) -> String {
        format!("**** {}", self.last4)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentEventStatus {
    /// The event was claimed by a handler and its side effects are in flight.
    Processing,
    /// Side effects were applied; a redelivery must not repeat them.
    #[default]
    Processed,
    /// Processing failed; the gateway may redeliver the same event id.
    Failed,
}

impl PaymentEventStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Processing => "processing",
            Self::Processed => "processed",
            Self::Failed => "failed",
        }
    }
}

/// Result of an atomic "insert if absent" claim on a payment event.
#[derive(Debug, Clone, PartialEq)]
pub enum EventClaim {
    /// The caller owns the event and must apply its side effects.
    Claimed,
    /// The event was already claimed or processed; the record is returned so
    /// the caller can compare payload hashes and decide about a retry.
    Held(PaymentEventRecord),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaymentEventRecord {
    pub event_id: String,
    pub gateway: String,
    pub kind: String,
    pub invoice_id: Option<Uuid>,
    pub received_at: DateTime<Utc>,
    pub payload_hash: String,
    /// Records written before deduplication carried no status and are treated
    /// as already processed.
    #[serde(default)]
    pub status: PaymentEventStatus,
}

pub trait PlanRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Plan>>;
    fn list(&self) -> CoreResult<Vec<Plan>>;
    fn save(&self, plan: &Plan) -> CoreResult<()>;
}

pub trait SubscriptionRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Subscription>>;
    fn list(&self) -> CoreResult<Vec<Subscription>>;
    fn save(&self, subscription: &Subscription) -> CoreResult<()>;
}

pub trait InvoiceRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Invoice>>;
    fn list(&self) -> CoreResult<Vec<Invoice>>;
    fn save(&self, invoice: &Invoice) -> CoreResult<()>;
}

pub trait PaymentMethodRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<PaymentMethod>>;
    fn list_for_user(&self, user_id: Uuid) -> CoreResult<Vec<PaymentMethod>>;
    fn save(&self, method: &PaymentMethod) -> CoreResult<()>;
}

pub trait PaymentEventRepository: Send + Sync {
    fn find(&self, gateway: &str, event_id: &str) -> CoreResult<Option<PaymentEventRecord>>;
    fn list(&self) -> CoreResult<Vec<PaymentEventRecord>>;
    fn save(&self, event: &PaymentEventRecord) -> CoreResult<()>;

    /// Atomically inserts the record when it is absent. Backends backed by a
    /// transactional store should override this with a single insert-if-absent
    /// so that two concurrent deliveries cannot both win the claim.
    fn claim(&self, event: &PaymentEventRecord) -> CoreResult<EventClaim> {
        if let Some(existing) = self.find(&event.gateway, &event.event_id)? {
            return Ok(EventClaim::Held(existing));
        }
        self.save(event)?;
        Ok(EventClaim::Claimed)
    }

    /// Flips a failed event back to processing so it can be retried. Returns
    /// `false` when another delivery already owns or finished the event.
    fn retry(&self, gateway: &str, event_id: &str) -> CoreResult<bool> {
        let Some(mut existing) = self.find(gateway, event_id)? else {
            return Ok(false);
        };
        if existing.status != PaymentEventStatus::Failed {
            return Ok(false);
        }
        existing.status = PaymentEventStatus::Processing;
        self.save(&existing)?;
        Ok(true)
    }

    /// Records the final status of an owned event.
    fn mark(&self, gateway: &str, event_id: &str, status: PaymentEventStatus) -> CoreResult<()> {
        let mut existing = self
            .find(gateway, event_id)?
            .ok_or_else(|| CoreError::NotFound("payment event".into()))?;
        existing.status = status;
        self.save(&existing)
    }
}

pub fn normalize_currency(raw: &str) -> CoreResult<String> {
    let currency = raw.trim();
    if currency.len() != 3 || !currency.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return Err(CoreError::Invalid(
            "currency must be a three-letter ISO 4217 code".into(),
        ));
    }
    Ok(currency.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(price_cents: i64, currency: &str) -> Plan {
        let now = Utc::now();
        Plan {
            id: Uuid::new_v4(),
            name: "Pro".into(),
            description: String::new(),
            price_cents,
            currency: currency.into(),
            period: BillingPeriod::Month,
            tariff_id: Uuid::new_v4(),
            active: true,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn period_parsing() {
        assert_eq!(BillingPeriod::parse("Month").unwrap(), BillingPeriod::Month);
        assert_eq!(
            BillingPeriod::parse(" annual ").unwrap(),
            BillingPeriod::Year
        );
        assert!(BillingPeriod::parse("week").is_err());
        assert_eq!(BillingPeriod::Year.as_str(), "year");
        assert_eq!(BillingPeriod::Month.months(), 1);
        assert_eq!(BillingPeriod::Year.months(), 12);
    }

    #[test]
    fn subscription_status_parsing_and_access() {
        assert_eq!(
            SubscriptionStatus::parse("past_due").unwrap(),
            SubscriptionStatus::PastDue
        );
        assert_eq!(
            SubscriptionStatus::parse("incomplete").unwrap(),
            SubscriptionStatus::Incomplete
        );
        assert_eq!(SubscriptionStatus::Incomplete.as_str(), "incomplete");
        assert!(SubscriptionStatus::parse("unknown").is_err());
        assert!(SubscriptionStatus::Trialing.grants_access());
        assert!(SubscriptionStatus::Active.grants_access());
        assert!(!SubscriptionStatus::Incomplete.grants_access());
        assert!(!SubscriptionStatus::PastDue.grants_access());
        assert!(!SubscriptionStatus::Suspended.grants_access());
        assert!(!SubscriptionStatus::Canceled.grants_access());
        assert!(SubscriptionStatus::Incomplete.is_current());
        assert!(SubscriptionStatus::Suspended.is_current());
        assert!(!SubscriptionStatus::Canceled.is_current());
    }

    #[test]
    fn invoice_status_parsing() {
        assert_eq!(InvoiceStatus::parse("OPEN").unwrap(), InvoiceStatus::Open);
        assert_eq!(InvoiceStatus::Paid.as_str(), "paid");
        assert!(InvoiceStatus::parse("unknown").is_err());
        assert_eq!(
            InvoiceStatus::parse("refunded").unwrap(),
            InvoiceStatus::Refunded
        );
        assert_eq!(InvoiceStatus::Refunded.as_str(), "refunded");
        assert!(InvoiceStatus::Paid.is_settled());
        assert!(InvoiceStatus::Refunded.is_settled());
        assert!(InvoiceStatus::Void.is_settled());
        assert!(InvoiceStatus::Uncollectible.is_settled());
        assert!(!InvoiceStatus::Open.is_settled());
        assert!(!InvoiceStatus::Draft.is_settled());
    }

    #[test]
    fn currency_is_normalized() {
        assert_eq!(normalize_currency(" rub ").unwrap(), "RUB");
        assert_eq!(normalize_currency("usd").unwrap(), "USD");
        assert!(normalize_currency("RU").is_err());
        assert!(normalize_currency("RUB1").is_err());
        assert!(normalize_currency("руб").is_err());
    }

    #[test]
    fn plan_validation_rejects_invalid_fields() {
        assert!(plan(1000, "RUB").validate().is_ok());
        assert!(plan(0, "RUB").validate().is_ok());
        assert!(plan(-1, "RUB").validate().is_err());
        assert!(plan(1000, "RUBB").validate().is_err());
    }

    #[test]
    fn plan_validation_requires_name() {
        let mut value = plan(1000, "RUB");
        value.name = "   ".into();
        assert!(value.validate().is_err());
        value.name = "x".repeat(121);
        assert!(value.validate().is_err());
    }

    #[test]
    fn invoice_reuse_requires_open_and_unexpired_period() {
        let now = Utc::now();
        let invoice = Invoice {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            subscription_id: Uuid::new_v4(),
            amount_cents: 1000,
            currency: "RUB".into(),
            status: InvoiceStatus::Open,
            period_start: now,
            period_end: now + chrono::Duration::days(30),
            due_at: now,
            paid_at: None,
            attempts: 0,
            gateway: None,
            gateway_ref: None,
            checkout_url: None,
        };
        assert!(invoice.is_reusable_open(now));

        let mut expired = invoice.clone();
        expired.period_end = now - chrono::Duration::seconds(1);
        assert!(!expired.is_reusable_open(now));

        let mut paid = invoice;
        paid.status = InvoiceStatus::Paid;
        assert!(!paid.is_reusable_open(now));
    }

    #[test]
    fn payment_method_is_masked() {
        let method = PaymentMethod {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            gateway: "mock".into(),
            gateway_ref: "pm-1".into(),
            brand: "visa".into(),
            last4: "4242".into(),
            is_default: true,
            created_at: Utc::now(),
        };
        assert_eq!(method.masked(), "**** 4242");
    }
}
