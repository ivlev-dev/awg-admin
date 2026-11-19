use std::sync::Arc;

use axum::Router;
use axum::routing::get;

use crate::controllers;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stats/overview", get(controllers::stats::overview))
        .route("/stats/devices", get(controllers::stats::devices))
        .route("/stats/series", get(controllers::stats::series))
        .route("/stats/aggregate", get(controllers::stats::aggregate))
        .route("/quota", get(controllers::quota::current))
        .route("/quota/users", get(controllers::quota::users))
}
