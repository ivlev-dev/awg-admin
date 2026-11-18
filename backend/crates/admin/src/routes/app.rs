use std::sync::Arc;

use axum::Router;
use axum::routing::{get, patch, post};

use crate::controllers;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/app/bootstrap", get(controllers::app::bootstrap))
        .route("/app/devices", post(controllers::app::create_device))
        .route(
            "/app/devices/{id}",
            patch(controllers::app::update_device).delete(controllers::app::delete_device),
        )
        .route(
            "/app/devices/{id}/config",
            get(controllers::app::device_config),
        )
        .route(
            "/app/devices/{id}/configs",
            get(controllers::app::device_configs),
        )
}
