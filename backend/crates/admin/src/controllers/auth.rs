use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{ChangePasswordRequest, LoginRequest, LogoutRequest, RefreshRequest};
use crate::state::AppState;
use crate::views::{AuthView, UserView};

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LoginRequest>,
) -> ApiResult<Json<AuthView>> {
    let session = state
        .identity
        .login(&request.login, &request.password)
        .map_err(ApiError::from)?;
    Ok(Json(AuthView {
        token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        user: UserView::from(&session.user),
    }))
}

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RefreshRequest>,
) -> ApiResult<Json<AuthView>> {
    let session = state
        .identity
        .refresh(&request.refresh_token)
        .map_err(ApiError::from)?;
    Ok(Json(AuthView {
        token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        user: UserView::from(&session.user),
    }))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LogoutRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .logout(&request.refresh_token)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn me(State(state): State<Arc<AppState>>, user: AuthUser) -> ApiResult<Json<UserView>> {
    let user = state.identity.find(user.id()).map_err(ApiError::from)?;
    Ok(Json(UserView::from(&user)))
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<ChangePasswordRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .change_password(
            user.id(),
            request.current_password.as_deref(),
            &request.new_password,
        )
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
