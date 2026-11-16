use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::views::AuditEntryView;

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
    pub before: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuditPageResponse {
    pub items: Vec<AuditEntryView>,
    pub next_cursor: Option<String>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<AuditQuery>,
) -> ApiResult<Json<AuditPageResponse>> {
    user.require_admin()?;
    let page = state
        .audit
        .list_page(query.limit.unwrap_or(0), query.before.as_deref())
        .map_err(ApiError::from)?;
    Ok(Json(AuditPageResponse {
        items: page.items.iter().map(AuditEntryView::from).collect(),
        next_cursor: page.next_cursor,
    }))
}
