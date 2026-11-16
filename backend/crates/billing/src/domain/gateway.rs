use std::error::Error;
use std::fmt;

use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct CheckoutRequest {
    pub user_id: Uuid,
    pub plan_id: Uuid,
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

#[derive(Debug, Clone)]
pub struct PaymentEvent {
    pub gateway: String,
    pub event_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayError {
    Unsupported,
    Invalid(String),
}

impl fmt::Display for GatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => formatter.write_str("payment gateway operation is unsupported"),
            Self::Invalid(message) => write!(formatter, "payment gateway error: {message}"),
        }
    }
}

impl Error for GatewayError {}

pub trait PaymentGateway: Send + Sync {
    fn create_checkout(&self, request: CheckoutRequest) -> Result<CheckoutSession, GatewayError>;

    fn charge_recurring(&self, request: ChargeRequest) -> Result<ChargeResult, GatewayError>;

    fn refund(&self, request: RefundRequest) -> Result<RefundResult, GatewayError>;

    fn verify_webhook(&self, request: &WebhookRequest) -> Result<(), GatewayError>;

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

    fn verify_webhook(&self, _request: &WebhookRequest) -> Result<(), GatewayError> {
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
            gateway.verify_webhook(&webhook()).unwrap_err(),
            GatewayError::Unsupported
        );
        assert_eq!(
            gateway.parse_event(&webhook()).unwrap_err(),
            GatewayError::Unsupported
        );
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
    }
}
