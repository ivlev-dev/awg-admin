use std::sync::Arc;

use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{delete, get, post};

use crate::controllers;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    let auth = Router::new()
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
        .route("/ws/ticket", post(controllers::auth::ws_ticket))
        .layer(middleware::from_fn(no_store));

    auth.merge(users())
}

fn users() -> Router<Arc<AppState>> {
    Router::new()
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

/// Auth responses carry credentials (access and refresh tokens), so they must
/// never be stored by browsers or intermediate caches.
async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .entry(header::PRAGMA)
        .or_insert(HeaderValue::from_static("no-cache"));
    response
}
