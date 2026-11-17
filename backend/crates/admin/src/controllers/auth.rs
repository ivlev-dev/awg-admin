use std::net::SocketAddr;
use std::sync::Arc;

use axum::Json;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use uuid::Uuid;

use awg_identity::{RegisterInput, SessionMetadata};

use crate::audit::{client_ip, record_login};
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{
    ChangePasswordRequest, DisableTotpRequest, EnableTotpRequest, ForgotPasswordRequest,
    LoginRequest, LogoutRequest, RefreshRequest, RegisterRequest, ResendVerificationRequest,
    ResetPasswordRequest, VerifyEmailRequest,
};
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
        crate::metrics::record_rate_limited("login");
        crate::metrics::record_login("rate_limited");
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
    let session = match state.identity.login_with_totp(
        &request.login,
        &request.password,
        request.totp_code.as_deref(),
        &session_metadata(&headers, Some(peer)),
    ) {
        Ok(session) => session,
        Err(error) => {
            let api_error = ApiError::from(error);
            crate::metrics::record_login("failure");
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
    crate::metrics::record_login("success");
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
        crate::metrics::record_rate_limited("refresh");
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

pub async fn register(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<RegisterRequest>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    let ip = client_ip(&headers, Some(peer));
    let key = ip_key("register", ip.as_deref());
    if let Err(retry_after) = state.register_limiter.check(&key) {
        crate::metrics::record_rate_limited("register");
        return Err(ApiError::TooManyRequests {
            message: "too many registration attempts, try again later".into(),
            retry_after,
        });
    }
    state
        .identity
        .register(RegisterInput {
            email: request.email,
            login: request.login,
            password: request.password,
        })
        .await
        .map_err(ApiError::from)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "status": "pending_email" })),
    ))
}

pub async fn verify_email(
    State(state): State<Arc<AppState>>,
    Json(request): Json<VerifyEmailRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .verify_email(&request.token)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "status": "pending_approval" })))
}

pub async fn resend_verification(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<ResendVerificationRequest>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    let ip = client_ip(&headers, Some(peer));
    let key = ip_key("resend", ip.as_deref());
    if let Err(retry_after) = state.resend_limiter.check(&key) {
        crate::metrics::record_rate_limited("resend_verification");
        return Err(ApiError::TooManyRequests {
            message: "too many verification requests, try again later".into(),
            retry_after,
        });
    }
    state.identity.resend_verification(&request.email).await;
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "status": "sent" })),
    ))
}

pub async fn forgot_password(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<ForgotPasswordRequest>,
) -> ApiResult<(StatusCode, Json<serde_json::Value>)> {
    let ip = client_ip(&headers, Some(peer));
    let key = rate_key(ip.as_deref(), &request.email);
    if let Err(retry_after) = state.forgot_limiter.check(&key) {
        crate::metrics::record_rate_limited("forgot_password");
        return Err(ApiError::TooManyRequests {
            message: "too many password reset requests, try again later".into(),
            retry_after,
        });
    }
    state
        .identity
        .request_password_reset(&request.email)
        .await
        .map_err(ApiError::from)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "status": "sent" })),
    ))
}

pub async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ResetPasswordRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .reset_password(&request.token, &request.password)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "status": "reset" })))
}

pub async fn totp_setup(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<serde_json::Value>> {
    let setup = state
        .identity
        .setup_totp(user.id())
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({
        "secret": setup.secret,
        "otpauth_url": setup.otpauth_url,
        "recovery_codes": setup.recovery_codes,
    })))
}

pub async fn totp_enable(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<EnableTotpRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .enable_totp(user.id(), &request.code)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "enabled": true })))
}

pub async fn totp_disable(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<DisableTotpRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .identity
        .disable_totp(user.id(), &request.password, &request.code)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "enabled": false })))
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

fn ip_key(prefix: &str, ip: Option<&str>) -> String {
    format!("{prefix}:{}", ip.unwrap_or("unknown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rate_limit::{MemoryRateLimiter, RateLimitScope};
    use std::time::Duration;

    #[test]
    fn login_rate_key_combines_ip_and_normalized_login() {
        assert_eq!(
            rate_key(Some("203.0.113.9"), "  Admin "),
            "203.0.113.9:admin"
        );
        assert_eq!(rate_key(None, "user"), "unknown:user");
    }

    #[test]
    fn forgot_scope_limits_each_ip_and_email_pair() {
        let backend = Arc::new(MemoryRateLimiter::new());
        let scope = RateLimitScope::new(backend, "forgot", 2, Duration::from_secs(60));
        let key = rate_key(Some("203.0.113.9"), " User@Example.COM ");
        assert_eq!(key, "203.0.113.9:user@example.com");

        assert!(scope.check(&key).is_ok());
        assert!(scope.check(&key).is_ok());
        assert!(scope.check(&key).is_err());
        assert!(
            scope
                .check(&rate_key(Some("203.0.113.9"), "other@example.com"))
                .is_ok()
        );
        assert!(
            scope
                .check(&rate_key(Some("198.51.100.1"), "user@example.com"))
                .is_ok()
        );
    }
}
