use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};

mod gateway;

pub use gateway::{
    ChargeRequest, ChargeResult, CheckoutRequest, CheckoutSession, GatewayError, NoopGateway,
    PaymentEvent, PaymentGateway, RefundRequest, RefundResult, WebhookRequest,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Trialing,
    Active,
    PastDue,
    Suspended,
    Canceled,
}

impl SubscriptionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Trialing => "trialing",
            Self::Active => "active",
            Self::PastDue => "past_due",
            Self::Suspended => "suspended",
            Self::Canceled => "canceled",
        }
    }

    pub fn parse(raw: &str) -> CoreResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
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
    Void,
    Uncollectible,
}

impl InvoiceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Open => "open",
            Self::Paid => "paid",
            Self::Void => "void",
            Self::Uncollectible => "uncollectible",
        }
    }

    pub fn parse(raw: &str) -> CoreResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "draft" => Ok(Self::Draft),
            "open" => Ok(Self::Open),
            "paid" => Ok(Self::Paid),
            "void" => Ok(Self::Void),
            "uncollectible" => Ok(Self::Uncollectible),
            other => Err(CoreError::Invalid(format!(
                "unknown invoice status {other:?}"
            ))),
        }
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
    }

    #[test]
    fn subscription_status_parsing_and_access() {
        assert_eq!(
            SubscriptionStatus::parse("past_due").unwrap(),
            SubscriptionStatus::PastDue
        );
        assert!(SubscriptionStatus::parse("incomplete").is_err());
        assert!(SubscriptionStatus::Trialing.grants_access());
        assert!(SubscriptionStatus::Active.grants_access());
        assert!(!SubscriptionStatus::PastDue.grants_access());
        assert!(!SubscriptionStatus::Suspended.grants_access());
        assert!(!SubscriptionStatus::Canceled.grants_access());
        assert!(SubscriptionStatus::Suspended.is_current());
        assert!(!SubscriptionStatus::Canceled.is_current());
    }

    #[test]
    fn invoice_status_parsing() {
        assert_eq!(InvoiceStatus::parse("OPEN").unwrap(), InvoiceStatus::Open);
        assert_eq!(InvoiceStatus::Paid.as_str(), "paid");
        assert!(InvoiceStatus::parse("unknown").is_err());
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
}
