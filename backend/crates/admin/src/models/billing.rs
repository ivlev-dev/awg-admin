use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreatePlanRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub price_cents: i64,
    pub currency: String,
    pub period: awg_billing::BillingPeriod,
    pub tariff_id: Uuid,
    #[serde(default = "default_plan_active")]
    pub active: bool,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdatePlanRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub price_cents: Option<i64>,
    pub currency: Option<String>,
    pub period: Option<awg_billing::BillingPeriod>,
    pub tariff_id: Option<Uuid>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct InvoiceQuery {
    pub user_id: Option<Uuid>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
pub struct AdminSubscriptionQuery {
    pub status: Option<String>,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
}

fn default_plan_active() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct StartCheckoutRequest {
    pub plan_id: Uuid,
}
