use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::views::AuditEntryView;

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<AuditQuery>,
) -> ApiResult<Json<Vec<AuditEntryView>>> {
    user.require_admin()?;
    let entries = state
        .audit
        .list(query.limit.unwrap_or(0))
        .map_err(ApiError::from)?;
    Ok(Json(entries.iter().map(AuditEntryView::from).collect()))
}
