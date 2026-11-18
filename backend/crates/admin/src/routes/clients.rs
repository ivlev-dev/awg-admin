use std::sync::Arc;

use axum::Router;
use axum::routing::{delete, get, patch, post};

use crate::controllers;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/devices",
            get(controllers::devices::list).post(controllers::devices::create),
        )
        .route("/devices/bulk", post(controllers::bulk::devices))
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
            "/devices/{id}/profiles/by-peer/{peer_id}",
            get(controllers::devices::profile_by_peer),
        )
        .route(
            "/devices/{id}/tunnels",
            post(controllers::devices::create_tunnel),
        )
        .route(
            "/devices/{id}/tunnels/{peer_id}",
            patch(controllers::devices::update_tunnel).delete(controllers::devices::delete_tunnel),
        )
        .route(
            "/devices/{id}/shares",
            get(controllers::devices::list_shares)
                .post(controllers::devices::create_share)
                .delete(controllers::devices::revoke_all_shares),
        )
        .route("/devices/{id}/stats", get(controllers::stats::device_stats))
        .route(
            "/shares/{token}",
            delete(controllers::devices::revoke_share),
        )
        .route("/share/{token}", get(controllers::share::download))
        .route("/import", post(controllers::import::run))
        .route("/import/preview", post(controllers::import::preview))
        .route("/import/apply", post(controllers::import::apply))
        .route(
            "/import/clients/preview",
            post(controllers::import::clients_preview),
        )
        .route(
            "/import/clients/apply",
            post(controllers::import::clients_apply),
        )
}
