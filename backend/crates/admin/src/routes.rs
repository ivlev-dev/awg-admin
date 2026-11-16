use std::sync::Arc;

use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderValue, Method, header};
use axum::routing::{delete, get, patch, post};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::controllers;
use crate::state::AppState;
use crate::ws;

pub fn router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(controllers::auth::login))
        .route("/auth/refresh", post(controllers::auth::refresh))
        .route("/auth/logout", post(controllers::auth::logout))
        .route("/auth/me", get(controllers::auth::me))
        .route("/auth/password", post(controllers::auth::change_password))
        .route(
            "/users",
            get(controllers::users::list).post(controllers::users::create),
        )
        .route(
            "/users/{id}",
            get(controllers::users::get)
                .patch(controllers::users::update)
                .delete(controllers::users::delete),
        )
        .route(
            "/users/{id}/password",
            post(controllers::users::reset_password),
        )
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
        .route(
            "/devices",
            get(controllers::devices::list).post(controllers::devices::create),
        )
        .route(
            "/devices/{id}",
            get(controllers::devices::get)
                .patch(controllers::devices::update)
                .delete(controllers::devices::delete),
        )
        .route(
            "/devices/{id}/profiles",
            get(controllers::devices::profiles),
        )
        .route(
            "/devices/{id}/profiles/{interface_id}",
            get(controllers::devices::profile),
        )
        .route(
            "/devices/{id}/shares",
            get(controllers::devices::list_shares).post(controllers::devices::create_share),
        )
        .route("/devices/{id}/stats", get(controllers::stats::device_stats))
        .route(
            "/shares/{token}",
            delete(controllers::devices::revoke_share),
        )
        .route("/stats/overview", get(controllers::stats::overview))
        .route("/stats/series", get(controllers::stats::series))
        .route(
            "/settings",
            get(controllers::settings::get).put(controllers::settings::update),
        )
        .route("/import", post(controllers::import::run))
        .route("/ws/stats", get(ws::stats_ws))
        .route("/share/{token}", get(controllers::share::download))
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .with_state(state.clone());

    let cors = build_cors(&state.config.cors_origins);

    Router::new()
        .nest("/api/v1", api)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

async fn health(State(_): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "service": "awg-admin",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

fn build_cors(origins: &[String]) -> CorsLayer {
    let layer = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::ACCEPT]);
    if origins.is_empty() {
        return layer.allow_origin(Any);
    }
    let list: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    layer.allow_origin(list)
}
