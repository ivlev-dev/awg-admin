use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SubscriptionPageView {
    pub items: Vec<awg_billing::Subscription>,
    pub total: usize,
    pub page: usize,
    pub per_page: usize,
}

#[derive(Debug, Serialize)]
pub struct CheckoutView {
    pub invoice: awg_billing::Invoice,
    pub checkout_url: String,
}

#[derive(Debug, Serialize)]
pub struct PaymentMethodView {
    pub id: uuid::Uuid,
    pub gateway: String,
    pub brand: String,
    pub last4: String,
    pub masked: String,
    pub is_default: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<awg_billing::PaymentMethod> for PaymentMethodView {
    fn from(method: awg_billing::PaymentMethod) -> Self {
        let masked = method.masked();
        Self {
            id: method.id,
            gateway: method.gateway,
            brand: method.brand,
            last4: method.last4,
            masked,
            is_default: method.is_default,
            created_at: method.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WebhookView {
    pub status: String,
    pub event_id: Option<String>,
}
