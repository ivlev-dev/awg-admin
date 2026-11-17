use std::sync::Arc;

use axum::Router;
use axum::routing::{delete, get, patch, post};

use crate::controllers;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/tariffs",
            get(controllers::tariffs::list).post(controllers::tariffs::create),
        )
        .route(
            "/tariffs/{id}",
            patch(controllers::tariffs::update).delete(controllers::tariffs::delete),
        )
        .route(
            "/groups",
            get(controllers::groups::list).post(controllers::groups::create),
        )
        .route(
            "/groups/{id}",
            patch(controllers::groups::update).delete(controllers::groups::delete),
        )
        .route(
            "/groups/{id}/pools",
            get(controllers::groups::list_pools).post(controllers::groups::create_pool),
        )
        .route(
            "/pools/{id}",
            patch(controllers::groups::update_pool).delete(controllers::groups::delete_pool),
        )
        .route(
            "/nodes",
            get(controllers::nodes::list).post(controllers::nodes::create),
        )
        .route("/nodes/{id}", delete(controllers::nodes::delete))
        .route("/nodes/{id}/rotate", post(controllers::nodes::rotate))
        .route(
            "/interfaces",
            get(controllers::interfaces::list).post(controllers::interfaces::create),
        )
        .route(
            "/interfaces/{id}",
            patch(controllers::interfaces::update).delete(controllers::interfaces::delete),
        )
        .route(
            "/interfaces/{id}/rotate",
            post(controllers::interfaces::rotate),
        )
}
