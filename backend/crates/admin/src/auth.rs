use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use uuid::Uuid;

use awg_identity::AuthPrincipal;

use crate::error::ApiError;
use crate::state::AppState;

pub struct AuthUser(pub AuthPrincipal);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| ApiError::Unauthorized("authorization header is missing".into()))?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::Unauthorized("expected a Bearer token".into()))?;
        let principal = state.identity.authenticate(token).map_err(ApiError::from)?;
        Ok(AuthUser(principal))
    }
}

impl AuthUser {
    pub fn id(&self) -> Uuid {
        self.0.user_id
    }

    pub fn is_admin(&self) -> bool {
        self.0.role.is_admin()
    }

    pub fn require_admin(&self) -> Result<(), ApiError> {
        if self.is_admin() {
            Ok(())
        } else {
            Err(ApiError::Forbidden("admin role required".into()))
        }
    }

    pub fn require_self_or_admin(&self, user_id: Uuid) -> Result<(), ApiError> {
        if self.is_admin() || self.0.user_id == user_id {
            Ok(())
        } else {
            Err(ApiError::Forbidden(
                "access to another user is denied".into(),
            ))
        }
    }
}
