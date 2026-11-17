use std::sync::Arc;

use axum::Router;
use axum::middleware;
use axum::routing::{get, patch, post};

use crate::controllers;
use crate::state::AppState;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/billing/plans",
            get(controllers::billing::list_plans).post(controllers::billing::create_plan),
        )
        .route(
            "/billing/plans/{id}",
            patch(controllers::billing::update_plan),
        )
        .route(
            "/billing/subscription",
            get(controllers::billing::subscription),
        )
        .route("/billing/invoices", get(controllers::billing::invoices))
        .route(
            "/billing/admin/subscriptions",
            get(controllers::billing::admin_subscriptions),
        )
        .route("/billing/checkout", post(controllers::billing::checkout))
        .route(
            "/billing/payment-methods",
            get(controllers::billing::payment_methods),
        )
        .route(
            "/billing/webhook/{provider}",
            post(controllers::billing::webhook),
        )
        .route_layer(middleware::from_fn_with_state(
            state,
            controllers::billing::require_enabled,
        ))
}
