use std::collections::HashSet;
use std::future::Future;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_identity::AuthPrincipal;

use crate::auth::AuthUser;
use crate::controllers::{devices, groups, interfaces, nodes, tariffs, users};
use crate::error::{ApiError, ApiResult};
use crate::models::{UpdateInterfaceRequest, UpdateUserRequest};
use crate::state::AppState;

pub const MAX_BULK_IDS: usize = 500;

#[derive(Debug, Deserialize)]
pub struct BulkRequest {
    pub action: String,
    pub ids: Vec<Uuid>,
}

impl BulkRequest {
    pub fn validate(self) -> ApiResult<(String, Vec<Uuid>)> {
        if self.ids.is_empty() {
            return Err(ApiError::BadRequest("ids must not be empty".into()));
        }
        if self.ids.len() > MAX_BULK_IDS {
            return Err(ApiError::BadRequest(format!(
                "ids must contain at most {MAX_BULK_IDS} items"
            )));
        }
        let mut seen = HashSet::with_capacity(self.ids.len());
        let ids = self.ids.into_iter().filter(|id| seen.insert(*id)).collect();
        Ok((self.action.trim().to_string(), ids))
    }
}

#[derive(Debug, Serialize)]
pub struct BulkFailure {
    pub id: Uuid,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct BulkResult {
    pub done: usize,
    pub failed: Vec<BulkFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BulkAction {
    Disable,
    Enable,
    Delete,
    RevokeShares,
}

impl BulkAction {
    pub const fn as_str(self) -> &'static str {
        match self {
            BulkAction::Disable => "disable",
            BulkAction::Enable => "enable",
            BulkAction::Delete => "delete",
            BulkAction::RevokeShares => "revoke_shares",
        }
    }
}

pub fn parse_action(action: &str, allowed: &[BulkAction]) -> ApiResult<BulkAction> {
    allowed
        .iter()
        .copied()
        .find(|candidate| candidate.as_str() == action)
        .ok_or_else(|| ApiError::BadRequest(format!("unsupported bulk action: {action}")))
}

pub async fn run_bulk<F, Fut>(ids: Vec<Uuid>, mut action: F) -> BulkResult
where
    F: FnMut(Uuid) -> Fut,
    Fut: Future<Output = ApiResult<()>>,
{
    let mut done = 0;
    let mut failed = Vec::new();
    for id in ids {
        match action(id).await {
            Ok(()) => done += 1,
            Err(error) => failed.push(BulkFailure {
                id,
                error: error.message(),
            }),
        }
    }
    BulkResult { done, failed }
}

fn unsupported(action: BulkAction) -> ApiError {
    ApiError::BadRequest(format!("unsupported bulk action: {}", action.as_str()))
}

pub async fn users(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BulkRequest>,
) -> ApiResult<Json<BulkResult>> {
    user.require_admin()?;
    let (action, ids) = request.validate()?;
    let action = parse_action(
        &action,
        &[BulkAction::Disable, BulkAction::Enable, BulkAction::Delete],
    )?;
    let principal = user.0;
    let result = run_bulk(ids, |id| {
        let state = state.clone();
        async move {
            match action {
                BulkAction::Disable => set_user_disabled(state, principal, id, true).await,
                BulkAction::Enable => set_user_disabled(state, principal, id, false).await,
                BulkAction::Delete => users::delete(State(state), AuthUser(principal), Path(id))
                    .await
                    .map(|_| ()),
                other => Err(unsupported(other)),
            }
        }
    })
    .await;
    Ok(Json(result))
}

async fn set_user_disabled(
    state: Arc<AppState>,
    principal: AuthPrincipal,
    id: Uuid,
    disabled: bool,
) -> ApiResult<()> {
    users::update(
        State(state),
        AuthUser(principal),
        Path(id),
        Json(UpdateUserRequest {
            disabled: Some(disabled),
            ..Default::default()
        }),
    )
    .await
    .map(|_| ())
}

pub async fn devices(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BulkRequest>,
) -> ApiResult<Json<BulkResult>> {
    let (action, ids) = request.validate()?;
    let action = parse_action(&action, &[BulkAction::RevokeShares, BulkAction::Delete])?;
    let principal = user.0;
    let result = run_bulk(ids, |id| {
        let state = state.clone();
        async move {
            match action {
                BulkAction::RevokeShares => {
                    devices::revoke_all_shares(State(state), AuthUser(principal), Path(id))
                        .await
                        .map(|_| ())
                }
                BulkAction::Delete => devices::delete(State(state), AuthUser(principal), Path(id))
                    .await
                    .map(|_| ()),
                other => Err(unsupported(other)),
            }
        }
    })
    .await;
    Ok(Json(result))
}

pub async fn interfaces(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BulkRequest>,
) -> ApiResult<Json<BulkResult>> {
    user.require_admin()?;
    let (action, ids) = request.validate()?;
    let action = parse_action(
        &action,
        &[BulkAction::Enable, BulkAction::Disable, BulkAction::Delete],
    )?;
    let principal = user.0;
    let result = run_bulk(ids, |id| {
        let state = state.clone();
        async move {
            match action {
                BulkAction::Enable => set_interface_enabled(state, principal, id, true).await,
                BulkAction::Disable => set_interface_enabled(state, principal, id, false).await,
                BulkAction::Delete => {
                    interfaces::delete(State(state), AuthUser(principal), Path(id))
                        .await
                        .map(|_| ())
                }
                other => Err(unsupported(other)),
            }
        }
    })
    .await;
    Ok(Json(result))
}

async fn set_interface_enabled(
    state: Arc<AppState>,
    principal: AuthPrincipal,
    id: Uuid,
    enabled: bool,
) -> ApiResult<()> {
    interfaces::update(
        State(state),
        AuthUser(principal),
        Path(id),
        Json(UpdateInterfaceRequest {
            enabled: Some(enabled),
            ..Default::default()
        }),
    )
    .await
    .map(|_| ())
}

pub async fn nodes(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BulkRequest>,
) -> ApiResult<Json<BulkResult>> {
    user.require_admin()?;
    let (action, ids) = request.validate()?;
    let action = parse_action(&action, &[BulkAction::Delete])?;
    let principal = user.0;
    let result = run_bulk(ids, |id| {
        let state = state.clone();
        async move {
            match action {
                BulkAction::Delete => nodes::delete(State(state), AuthUser(principal), Path(id))
                    .await
                    .map(|_| ()),
                other => Err(unsupported(other)),
            }
        }
    })
    .await;
    Ok(Json(result))
}

pub async fn groups(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BulkRequest>,
) -> ApiResult<Json<BulkResult>> {
    user.require_admin()?;
    let (action, ids) = request.validate()?;
    let action = parse_action(&action, &[BulkAction::Delete])?;
    let principal = user.0;
    let result = run_bulk(ids, |id| {
        let state = state.clone();
        async move {
            match action {
                BulkAction::Delete => groups::delete(State(state), AuthUser(principal), Path(id))
                    .await
                    .map(|_| ()),
                other => Err(unsupported(other)),
            }
        }
    })
    .await;
    Ok(Json(result))
}

pub async fn tariffs(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BulkRequest>,
) -> ApiResult<Json<BulkResult>> {
    user.require_admin()?;
    let (action, ids) = request.validate()?;
    let action = parse_action(&action, &[BulkAction::Delete])?;
    let principal = user.0;
    let result = run_bulk(ids, |id| {
        let state = state.clone();
        async move {
            match action {
                BulkAction::Delete => tariffs::delete(State(state), AuthUser(principal), Path(id))
                    .await
                    .map(|_| ()),
                other => Err(unsupported(other)),
            }
        }
    })
    .await;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    fn request(action: &str, ids: Vec<Uuid>) -> BulkRequest {
        BulkRequest {
            action: action.into(),
            ids,
        }
    }

    #[test]
    fn rejects_empty_ids() {
        let error = request("disable", Vec::new()).validate().unwrap_err();
        assert_eq!(error.status_code(), StatusCode::BAD_REQUEST);
        assert_eq!(error.message(), "ids must not be empty");
    }

    #[test]
    fn rejects_too_many_ids() {
        let ids = (0..=MAX_BULK_IDS).map(|_| Uuid::new_v4()).collect();
        let error = request("disable", ids).validate().unwrap_err();
        assert_eq!(error.status_code(), StatusCode::BAD_REQUEST);
        assert_eq!(
            error.message(),
            format!("ids must contain at most {MAX_BULK_IDS} items")
        );
    }

    #[test]
    fn accepts_exactly_the_limit() {
        let ids = (0..MAX_BULK_IDS).map(|_| Uuid::new_v4()).collect();
        let (action, normalized) = request("disable", ids).validate().unwrap();
        assert_eq!(action, "disable");
        assert_eq!(normalized.len(), MAX_BULK_IDS);
    }

    #[test]
    fn collapses_duplicates_keeping_first_order() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let third = Uuid::new_v4();
        let (action, ids) = request("delete", vec![first, second, first, third, second])
            .validate()
            .unwrap();
        assert_eq!(action, "delete");
        assert_eq!(ids, vec![first, second, third]);
    }

    #[test]
    fn trims_action() {
        let id = Uuid::new_v4();
        let (action, ids) = request("  enable  ", vec![id]).validate().unwrap();
        assert_eq!(action, "enable");
        assert_eq!(ids, vec![id]);
    }

    #[test]
    fn rejects_unknown_action() {
        let error = parse_action(
            "explode",
            &[BulkAction::Disable, BulkAction::Enable, BulkAction::Delete],
        )
        .unwrap_err();
        assert_eq!(error.status_code(), StatusCode::BAD_REQUEST);
        assert_eq!(error.message(), "unsupported bulk action: explode");
    }

    #[test]
    fn rejects_action_outside_allowed_set() {
        let error = parse_action("delete", &[BulkAction::RevokeShares]).unwrap_err();
        assert_eq!(error.status_code(), StatusCode::BAD_REQUEST);
        assert_eq!(
            parse_action("revoke_shares", &[BulkAction::RevokeShares]).unwrap(),
            BulkAction::RevokeShares
        );
    }

    #[tokio::test]
    async fn run_bulk_counts_every_success() {
        let ids = vec![Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
        let result = run_bulk(ids, |_| async { Ok::<(), ApiError>(()) }).await;
        assert_eq!(result.done, 3);
        assert!(result.failed.is_empty());
    }

    #[tokio::test]
    async fn run_bulk_collects_partial_failures() {
        let ok = Uuid::new_v4();
        let missing = Uuid::new_v4();
        let denied = Uuid::new_v4();
        let result = run_bulk(vec![ok, missing, denied], |id| async move {
            if id == ok {
                Ok(())
            } else if id == missing {
                Err(ApiError::NotFound("device not found".into()))
            } else {
                Err(ApiError::Forbidden(
                    "access to another user is denied".into(),
                ))
            }
        })
        .await;
        assert_eq!(result.done, 1);
        assert_eq!(result.failed.len(), 2);
        assert_eq!(result.failed[0].id, missing);
        assert_eq!(result.failed[0].error, "device not found");
        assert_eq!(result.failed[1].id, denied);
        assert_eq!(result.failed[1].error, "access to another user is denied");
    }

    #[tokio::test]
    async fn run_bulk_keeps_going_after_failures() {
        let ids: Vec<Uuid> = (0..4).map(|_| Uuid::new_v4()).collect();
        let failing = ids[1];
        let result = run_bulk(ids, |id| async move {
            if id == failing {
                Err(ApiError::Conflict("cannot delete your own account".into()))
            } else {
                Ok(())
            }
        })
        .await;
        assert_eq!(result.done, 3);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.failed[0].id, failing);
        assert_eq!(result.failed[0].error, "cannot delete your own account");
    }

    #[tokio::test]
    async fn run_bulk_without_ids_does_nothing() {
        let result = run_bulk(Vec::new(), |_| async { Ok::<(), ApiError>(()) }).await;
        assert_eq!(result.done, 0);
        assert!(result.failed.is_empty());
    }

    #[test]
    fn result_serializes_contract() {
        let id = Uuid::new_v4();
        let value = serde_json::to_value(BulkResult {
            done: 1,
            failed: vec![BulkFailure {
                id,
                error: "boom".into(),
            }],
        })
        .unwrap();
        assert_eq!(value["done"], 1);
        assert_eq!(value["failed"][0]["id"], id.to_string());
        assert_eq!(value["failed"][0]["error"], "boom");
    }
}
