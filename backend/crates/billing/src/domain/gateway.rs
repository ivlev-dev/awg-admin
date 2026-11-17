use chrono::{DateTime, Utc};
use std::error::Error;
use std::fmt;

use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct CheckoutRequest {
    pub user_id: Uuid,
    pub plan_id: Uuid,
    pub invoice_id: Uuid,
    pub amount_cents: i64,
    pub currency: String,
    pub success_url: String,
    pub cancel_url: String,
}

#[derive(Debug, Clone)]
pub struct CheckoutSession {
    pub gateway_ref: String,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct ChargeRequest {
    pub subscription_id: Uuid,
    pub invoice_id: Uuid,
    pub amount_cents: i64,
    pub currency: String,
    pub gateway_ref: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ChargeResult {
    pub gateway_ref: String,
    pub paid: bool,
}

#[derive(Debug, Clone)]
pub struct RefundRequest {
    pub gateway_ref: String,
    pub amount_cents: i64,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct RefundResult {
    pub refund_ref: String,
    pub amount_cents: i64,
}

#[derive(Debug, Clone)]
pub struct WebhookRequest {
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl WebhookRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaymentEventKind {
    PaymentSucceeded,
    PaymentFailed,
    RefundSucceeded,
    Other(String),
}

impl PaymentEventKind {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "payment.succeeded" => Self::PaymentSucceeded,
            "payment.failed" => Self::PaymentFailed,
            "refund.succeeded" => Self::RefundSucceeded,
            other => Self::Other(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::PaymentSucceeded => "payment.succeeded",
            Self::PaymentFailed => "payment.failed",
            Self::RefundSucceeded => "refund.succeeded",
            Self::Other(value) => value.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentMethodInfo {
    pub gateway_ref: String,
    pub brand: String,
    pub last4: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentEvent {
    pub gateway: String,
    pub event_id: String,
    pub kind: PaymentEventKind,
    pub invoice_id: Option<Uuid>,
    pub amount_cents: Option<i64>,
    pub currency: Option<String>,
    pub gateway_ref: Option<String>,
    pub payment_method: Option<PaymentMethodInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayError {
    Unsupported,
    Signature,
    Invalid(String),
}

impl fmt::Display for GatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => formatter.write_str("payment gateway operation is unsupported"),
            Self::Signature => formatter.write_str("payment gateway webhook signature is invalid"),
            Self::Invalid(message) => write!(formatter, "payment gateway error: {message}"),
        }
    }
}

impl Error for GatewayError {}

pub trait PaymentGateway: Send + Sync {
    fn provider_name(&self) -> &'static str {
        "noop"
    }

    fn create_checkout(&self, request: CheckoutRequest) -> Result<CheckoutSession, GatewayError>;

    fn charge_recurring(&self, request: ChargeRequest) -> Result<ChargeResult, GatewayError>;

    fn refund(&self, request: RefundRequest) -> Result<RefundResult, GatewayError>;

    fn verify_webhook(
        &self,
        request: &WebhookRequest,
        now: DateTime<Utc>,
    ) -> Result<(), GatewayError>;

    fn parse_event(&self, request: &WebhookRequest) -> Result<PaymentEvent, GatewayError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NoopGateway;

impl PaymentGateway for NoopGateway {
    fn create_checkout(&self, _request: CheckoutRequest) -> Result<CheckoutSession, GatewayError> {
        Err(GatewayError::Unsupported)
    }

    fn charge_recurring(&self, _request: ChargeRequest) -> Result<ChargeResult, GatewayError> {
        Err(GatewayError::Unsupported)
    }

    fn refund(&self, _request: RefundRequest) -> Result<RefundResult, GatewayError> {
        Err(GatewayError::Unsupported)
    }

    fn verify_webhook(
        &self,
        _request: &WebhookRequest,
        _now: DateTime<Utc>,
    ) -> Result<(), GatewayError> {
        Err(GatewayError::Unsupported)
    }

    fn parse_event(&self, _request: &WebhookRequest) -> Result<PaymentEvent, GatewayError> {
        Err(GatewayError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn webhook() -> WebhookRequest {
        WebhookRequest {
            headers: Vec::new(),
            body: b"{}".to_vec(),
        }
    }

    #[test]
    fn noop_gateway_reports_unsupported() {
        let gateway = NoopGateway;
        let user_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();

        assert_eq!(
            gateway
                .create_checkout(CheckoutRequest {
                    user_id,
                    plan_id,
                    invoice_id: Uuid::new_v4(),
                    amount_cents: 1000,
                    currency: "RUB".into(),
                    success_url: "https://example.test/ok".into(),
                    cancel_url: "https://example.test/cancel".into(),
                })
                .unwrap_err(),
            GatewayError::Unsupported
        );
        assert_eq!(
            gateway
                .charge_recurring(ChargeRequest {
                    subscription_id: Uuid::new_v4(),
                    invoice_id: Uuid::new_v4(),
                    amount_cents: 1000,
                    currency: "RUB".into(),
                    gateway_ref: None,
                })
                .unwrap_err(),
            GatewayError::Unsupported
        );
        assert_eq!(
            gateway
                .refund(RefundRequest {
                    gateway_ref: "ref".into(),
                    amount_cents: 1000,
                    reason: "test".into(),
                })
                .unwrap_err(),
            GatewayError::Unsupported
        );
        assert_eq!(
            gateway.verify_webhook(&webhook(), Utc::now()).unwrap_err(),
            GatewayError::Unsupported
        );
        assert_eq!(
            gateway.parse_event(&webhook()).unwrap_err(),
            GatewayError::Unsupported
        );
        assert_eq!(gateway.provider_name(), "noop");
    }

    #[test]
    fn gateway_error_display() {
        assert!(
            GatewayError::Unsupported
                .to_string()
                .contains("unsupported")
        );
        assert!(
            GatewayError::Invalid("boom".into())
                .to_string()
                .contains("boom")
        );
        assert!(GatewayError::Signature.to_string().contains("signature"));
    }

    #[test]
    fn event_kind_parsing() {
        assert_eq!(
            PaymentEventKind::parse("payment.succeeded"),
            PaymentEventKind::PaymentSucceeded
        );
        assert_eq!(
            PaymentEventKind::parse(" PAYMENT.FAILED "),
            PaymentEventKind::PaymentFailed
        );
        assert_eq!(
            PaymentEventKind::parse("refund.succeeded"),
            PaymentEventKind::RefundSucceeded
        );
        assert_eq!(
            PaymentEventKind::parse("charge.disputed"),
            PaymentEventKind::Other("charge.disputed".into())
        );
        assert_eq!(
            PaymentEventKind::PaymentSucceeded.as_str(),
            "payment.succeeded"
        );
        assert_eq!(PaymentEventKind::Other("x".into()).as_str(), "x");
    }

    #[test]
    fn webhook_headers_are_case_insensitive() {
        let request = WebhookRequest {
            headers: vec![("X-Mock-Timestamp".into(), "42".into())],
            body: Vec::new(),
        };
        assert_eq!(request.header("x-mock-timestamp"), Some("42"));
        assert_eq!(request.header("x-mock-signature"), None);
    }
}
