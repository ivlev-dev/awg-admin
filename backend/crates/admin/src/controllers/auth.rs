use std::net::SocketAddr;
use std::sync::Arc;

use axum::Json;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, header};
use uuid::Uuid;

use awg_identity::SessionMetadata;

use crate::audit::{client_ip, record_login};
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{ChangePasswordRequest, LoginRequest, LogoutRequest, RefreshRequest};
use crate::state::AppState;
use crate::views::{AuthView, SessionView, UserView};

pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> ApiResult<Json<AuthView>> {
    let ip = client_ip(&headers, Some(peer));
    let key = rate_key(ip.as_deref(), &request.login);
    if let Err(retry_after) = state.login_limiter.check(&key) {
        record_login(
            &state,
            ip,
            &request.login,
            None,
            429,
            Some("rate limited".into()),
        );
        return Err(ApiError::TooManyRequests {
            message: "too many login attempts, try again later".into(),
            retry_after,
        });
    }
    let session = match state.identity.login(
        &request.login,
        &request.password,
        &session_metadata(&headers, Some(peer)),
    ) {
        Ok(session) => session,
        Err(error) => {
            let api_error = ApiError::from(error);
            record_login(
                &state,
                ip,
                &request.login,
                None,
                api_error.status_code().as_u16(),
                Some("login failed".into()),
            );
            return Err(api_error);
        }
    };
    state.login_limiter.reset(&key);
    record_login(
        &state,
        ip,
        &session.user.login,
        Some(session.user.id),
        200,
        Some("success".into()),
    );
    Ok(Json(AuthView {
        token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        user: UserView::from(&session.user),
    }))
}

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<RefreshRequest>,
) -> ApiResult<Json<AuthView>> {
    let ip = client_ip(&headers, Some(peer));
    let key = format!("refresh:{}", ip.unwrap_or_else(|| "unknown".into()));
    if let Err(retry_after) = state.refresh_limiter.check(&key) {
        return Err(ApiError::TooManyRequests {
            message: "too many refresh attempts, try again later".into(),
            retry_after,
        });
    }
    let session = state
        .identity
        .refresh(
            &request.refresh_token,
            &session_metadata(&headers, Some(peer)),
        )
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

pub async fn sessions(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<SessionView>>> {
    let sessions = state.identity.sessions(user.id()).map_err(ApiError::from)?;
    Ok(Json(sessions.iter().map(SessionView::from).collect()))
}

pub async fn revoke_session(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(jti): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .revoke_session(user.id(), jti)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn logout_all(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<serde_json::Value>> {
    let revoked = state
        .identity
        .logout_all(user.id())
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true, "revoked": revoked })))
}

fn session_metadata(headers: &HeaderMap, peer: Option<SocketAddr>) -> SessionMetadata {
    SessionMetadata {
        user_agent: headers
            .get(header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.chars().take(256).collect()),
        ip: client_ip(headers, peer),
    }
}

fn rate_key(ip: Option<&str>, login: &str) -> String {
    format!(
        "{}:{}",
        ip.unwrap_or("unknown"),
        login.trim().to_ascii_lowercase()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_rate_key_combines_ip_and_normalized_login() {
        assert_eq!(
            rate_key(Some("203.0.113.9"), "  Admin "),
            "203.0.113.9:admin"
        );
        assert_eq!(rate_key(None, "user"), "unknown:user");
    }
}
