use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;

use awg_audit::AuditFilter;
use awg_shared::CoreError;

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::ApiError;
use crate::state::AppState;
use crate::views::AuditEntryView;

/// Always request a bounded page, even when the client omits `limit`, so a
/// single call cannot stream the whole journal.
const DEFAULT_AUDIT_LIMIT: usize = 200;
const MAX_AUDIT_LIMIT: usize = 1000;

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
    pub before: Option<String>,
    pub action: Option<String>,
    pub entity: Option<String>,
    pub actor: Option<String>,
    pub status: Option<u16>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

impl AuditQuery {
    fn filter(&self) -> AuditFilter {
        AuditFilter {
            action: non_empty(self.action.clone()),
            entity: non_empty(self.entity.clone()),
            actor: non_empty(self.actor.clone()),
            status: self.status,
            from: self.from,
            to: self.to,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AuditPageResponse {
    pub items: Vec<AuditEntryView>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuditClearResponse {
    pub deleted: usize,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<AuditQuery>,
) -> Result<Json<AuditPageResponse>, AuditError> {
    user.require_admin()?;
    let filter = query.filter();
    filter.validate().map_err(|error| match error {
        CoreError::Invalid(message) => AuditError::InvalidFilter(message),
        other => AuditError::Api(other.into()),
    })?;
    let limit = audit_limit(query.limit);
    let before = query.before.clone();
    let audit = state.audit.clone();
    let page = blocking::run_api(move || {
        audit
            .list_page_filtered(limit, before.as_deref(), &filter)
            .map_err(ApiError::from)
    })
    .await?;
    Ok(Json(AuditPageResponse {
        items: page.items.iter().map(AuditEntryView::from).collect(),
        next_cursor: page.next_cursor,
    }))
}

pub async fn clear(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<AuditQuery>,
) -> Result<Json<AuditClearResponse>, AuditError> {
    user.require_admin()?;
    let filter = query.filter();
    filter.validate().map_err(|error| match error {
        CoreError::Invalid(message) => AuditError::InvalidFilter(message),
        other => AuditError::Api(other.into()),
    })?;
    let audit = state.audit.clone();
    let deleted =
        blocking::run_api(move || audit.delete_filtered(&filter).map_err(ApiError::from)).await?;
    Ok(Json(AuditClearResponse { deleted }))
}

fn audit_limit(raw: Option<usize>) -> usize {
    raw.unwrap_or(DEFAULT_AUDIT_LIMIT).clamp(1, MAX_AUDIT_LIMIT)
}

pub enum AuditError {
    Api(ApiError),
    InvalidFilter(String),
}

impl From<ApiError> for AuditError {
    fn from(error: ApiError) -> Self {
        AuditError::Api(error)
    }
}

impl IntoResponse for AuditError {
    fn into_response(self) -> Response {
        match self {
            AuditError::Api(error) => error.into_response(),
            AuditError::InvalidFilter(message) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": { "code": "invalid_filter", "message": message } })),
            )
                .into_response(),
        }
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(value: serde_json::Value) -> AuditQuery {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn query_builds_filter() {
        let filter = query(json!({
            "limit": 25,
            "before": "0000000017670006450000:4f1f4f7a-1f0a-4c1a-9c4d-8b2a0d5b1c11",
            "action": "PATCH",
            "entity": "devices",
            "actor": "adm",
            "status": 200,
            "from": 1767000000,
            "to": 1767003600
        }))
        .filter();

        assert_eq!(filter.action.as_deref(), Some("PATCH"));
        assert_eq!(filter.entity.as_deref(), Some("devices"));
        assert_eq!(filter.actor.as_deref(), Some("adm"));
        assert_eq!(filter.status, Some(200));
        assert_eq!(filter.from, Some(1_767_000_000));
        assert_eq!(filter.to, Some(1_767_003_600));
    }

    #[test]
    fn query_drops_blank_strings() {
        let filter = query(json!({ "action": " ", "entity": "", "actor": null })).filter();
        assert!(filter.is_empty());
    }

    #[test]
    fn filter_with_inverted_range_is_invalid() {
        let filter = query(json!({ "from": 10, "to": 5 })).filter();
        assert!(filter.validate().is_err());
    }

    #[test]
    fn audit_limit_is_always_bounded() {
        assert_eq!(audit_limit(None), DEFAULT_AUDIT_LIMIT);
        assert_eq!(audit_limit(Some(0)), 1);
        assert_eq!(audit_limit(Some(25)), 25);
        assert_eq!(audit_limit(Some(10_000)), MAX_AUDIT_LIMIT);
    }
}
