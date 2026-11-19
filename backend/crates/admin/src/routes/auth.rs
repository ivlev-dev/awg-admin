use std::sync::Arc;

use axum::Router;
use axum::routing::{delete, get, post};

use crate::controllers;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/login", post(controllers::auth::login))
        .route("/auth/register", post(controllers::auth::register))
        .route("/auth/verify-email", post(controllers::auth::verify_email))
        .route(
            "/auth/resend-verification",
            post(controllers::auth::resend_verification),
        )
        .route(
            "/auth/forgot-password",
            post(controllers::auth::forgot_password),
        )
        .route(
            "/auth/reset-password",
            post(controllers::auth::reset_password),
        )
        .route("/auth/refresh", post(controllers::auth::refresh))
        .route("/auth/logout", post(controllers::auth::logout))
        .route(
            "/auth/me",
            get(controllers::auth::me).patch(controllers::auth::update_me),
        )
        .route("/auth/password", post(controllers::auth::change_password))
        .route("/auth/sessions", get(controllers::auth::sessions))
        .route(
            "/auth/sessions/{jti}",
            delete(controllers::auth::revoke_session),
        )
        .route("/auth/logout-all", post(controllers::auth::logout_all))
        .route("/auth/totp/setup", post(controllers::auth::totp_setup))
        .route("/auth/totp/enable", post(controllers::auth::totp_enable))
        .route("/auth/totp/disable", post(controllers::auth::totp_disable))
        .route("/users/pending", get(controllers::users::pending))
        .route(
            "/users",
            get(controllers::users::list).post(controllers::users::create),
        )
        .route("/users/page", get(controllers::users::page))
        .route("/users/bulk", post(controllers::bulk::users))
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
        .route("/users/{id}/approve", post(controllers::users::approve))
        .route("/users/{id}/reject", post(controllers::users::reject))
}
