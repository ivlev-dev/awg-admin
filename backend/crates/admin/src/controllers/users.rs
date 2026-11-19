use std::collections::HashSet;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use base64::Engine;
use uuid::Uuid;

use awg_identity::{NewUser, Role, UserChanges, UserStatus};
use awg_shared::crypto::random_bytes;

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::{ApiError, ApiResult};
use crate::models::{
    ApproveUserRequest, ChangePasswordRequest, CreateUserRequest, UpdateUserRequest, UserPageParams,
};
use crate::publish::{publish_group, publish_user_groups};
use crate::state::AppState;
use crate::views::{PageView, UserView};

const DEFAULT_PAGE_LIMIT: usize = 50;
const MAX_PAGE_LIMIT: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UserTab {
    Active,
    Pending,
}

impl UserTab {
    fn parse(raw: Option<&str>) -> ApiResult<Self> {
        match raw.map(str::trim).filter(|value| !value.is_empty()) {
            None => Ok(Self::Active),
            Some(value) if value.eq_ignore_ascii_case("active") => Ok(Self::Active),
            Some(value) if value.eq_ignore_ascii_case("pending") => Ok(Self::Pending),
            Some(value) => Err(ApiError::BadRequest(format!(
                "tab must be one of active, pending (got {value})"
            ))),
        }
    }

    fn matches(self, status: UserStatus) -> bool {
        match self {
            Self::Active => status != UserStatus::PendingApproval,
            Self::Pending => status == UserStatus::PendingApproval,
        }
    }
}

fn parse_role(raw: Option<&str>) -> ApiResult<Option<Role>> {
    match raw.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) if value.eq_ignore_ascii_case("all") => Ok(None),
        Some(value) if value.eq_ignore_ascii_case("admin") => Ok(Some(Role::Admin)),
        Some(value) if value.eq_ignore_ascii_case("user") => Ok(Some(Role::User)),
        Some(value) => Err(ApiError::BadRequest(format!(
            "role must be one of all, admin, user (got {value})"
        ))),
    }
}

fn parse_status(raw: Option<&str>) -> ApiResult<Option<bool>> {
    match raw.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) if value.eq_ignore_ascii_case("all") => Ok(None),
        Some(value) if value.eq_ignore_ascii_case("active") => Ok(Some(false)),
        Some(value) if value.eq_ignore_ascii_case("disabled") => Ok(Some(true)),
        Some(value) => Err(ApiError::BadRequest(format!(
            "status must be one of all, active, disabled (got {value})"
        ))),
    }
}

fn parse_limit(raw: Option<u32>) -> ApiResult<usize> {
    let limit = raw.unwrap_or(DEFAULT_PAGE_LIMIT as u32);
    if limit == 0 || limit as usize > MAX_PAGE_LIMIT {
        return Err(ApiError::BadRequest(format!(
            "limit must be between 1 and {MAX_PAGE_LIMIT}"
        )));
    }
    Ok(limit as usize)
}

fn ensure_node(state: &AppState, node_id: Option<Uuid>) -> ApiResult<()> {
    if let Some(node_id) = node_id {
        state.network.get_node(node_id).map_err(ApiError::from)?;
    }
    Ok(())
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<UserView>>> {
    user.require_admin()?;
    let users = {
        let identity = state.identity.clone();
        blocking::run_core(move || identity.list())
            .await
            .map_err(ApiError::from)?
    };
    Ok(Json(users.iter().map(UserView::from).collect()))
}

pub async fn page(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(params): Query<UserPageParams>,
) -> ApiResult<Json<PageView<UserView>>> {
    user.require_admin()?;
    let limit = parse_limit(params.limit)?;
    let offset = params.offset.unwrap_or(0) as usize;
    let role = parse_role(params.role.as_deref())?;
    let disabled = parse_status(params.status.as_deref())?;
    let tab = UserTab::parse(params.tab.as_deref())?;
    let q = params
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let page = {
        let identity = state.identity.clone();
        blocking::run_api(move || {
            let mut users = identity.list().map_err(ApiError::from)?;
            users.retain(|account| {
                if let Some(role) = role
                    && account.role != role
                {
                    return false;
                }
                if let Some(disabled) = disabled
                    && account.disabled != disabled
                {
                    return false;
                }
                if !tab.matches(account.status) {
                    return false;
                }
                if let Some(q) = q.as_deref() {
                    let email = account
                        .email
                        .as_deref()
                        .unwrap_or(account.login.as_str())
                        .to_lowercase();
                    if !email.contains(q) && !account.login.to_lowercase().contains(q) {
                        return false;
                    }
                }
                true
            });
            users.sort_by(|left, right| {
                left.created_at
                    .cmp(&right.created_at)
                    .then_with(|| left.id.cmp(&right.id))
            });
            let total = users.len();
            let items: Vec<UserView> = users
                .iter()
                .skip(offset)
                .take(limit)
                .map(UserView::from)
                .collect();
            Ok(PageView::new(items, total, limit, offset))
        })
        .await?
    };
    Ok(Json(page))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateUserRequest>,
) -> ApiResult<Json<UserView>> {
    user.require_admin()?;
    ensure_node(&state, request.node_id)?;
    let password = request
        .password
        .filter(|password| !password.trim().is_empty())
        .unwrap_or_else(generated_password);
    let created = {
        let identity = state.identity.clone();
        let input = NewUser {
            email: request.email,
            password,
            role: request.role,
            tariff_id: request.tariff_id,
            group_id: request.group_id,
            node_id: request.node_id,
        };
        blocking::run_core(move || identity.create(input))
            .await
            .map_err(ApiError::from)?
    };
    publish_user_groups(&state, created.id).await;
    Ok(Json(UserView::from(&created)))
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<UserView>> {
    user.require_self_or_admin(id)?;
    let found = state.identity.find(id).map_err(ApiError::from)?;
    Ok(Json(UserView::from(&found)))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateUserRequest>,
) -> ApiResult<Json<UserView>> {
    user.require_admin()?;
    if user.id() == id && request.disabled == Some(true) {
        return Err(ApiError::Conflict("cannot disable your own account".into()));
    }
    if let Some(Some(node_id)) = request.node_id {
        ensure_node(&state, Some(node_id))?;
    }
    let updated = state
        .identity
        .update(
            id,
            UserChanges {
                email: request.email,
                role: request.role,
                tariff_id: request.tariff_id,
                group_id: request.group_id,
                node_id: request.node_id,
                disabled: request.disabled,
            },
        )
        .map_err(ApiError::from)?;
    publish_user_groups(&state, updated.id).await;
    Ok(Json(UserView::from(&updated)))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    if user.id() == id {
        return Err(ApiError::Conflict("cannot delete your own account".into()));
    }
    let devices = state.devices.list_for_user(id).map_err(ApiError::from)?;
    let mut groups: HashSet<Uuid> = devices.iter().map(|device| device.group_id).collect();
    if let Ok(found) = state.identity.find(id)
        && let Some(group_id) = found.group_id
    {
        groups.insert(group_id);
    }
    for device in &devices {
        state
            .share
            .revoke_all_for_device(device.id)
            .map_err(ApiError::from)?;
        state.devices.delete(device.id).map_err(ApiError::from)?;
    }
    state.share.revoke_created_by(id).map_err(ApiError::from)?;
    state.identity.delete(id).map_err(ApiError::from)?;
    for group in groups {
        publish_group(&state, group).await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn reset_password(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<ChangePasswordRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let identity = state.identity.clone();
    let user_id = id;
    let new_password = request.new_password.clone();
    blocking::run_core(move || identity.reset_password_for_user(user_id, &new_password))
        .await
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn pending(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<UserView>>> {
    user.require_admin()?;
    let users = {
        let identity = state.identity.clone();
        blocking::run_core(move || identity.pending_users())
            .await
            .map_err(ApiError::from)?
    };
    Ok(Json(users.iter().map(UserView::from).collect()))
}

pub async fn approve(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<ApproveUserRequest>,
) -> ApiResult<Json<UserView>> {
    user.require_admin()?;
    ensure_node(&state, request.node_id)?;
    let mut approved = state
        .identity
        .approve_user(id, request.tariff_id, request.node_id)
        .map_err(ApiError::from)?;
    if let Some(group_id) = request.group_id {
        approved = state
            .identity
            .update(
                approved.id,
                UserChanges {
                    email: None,
                    role: None,
                    tariff_id: None,
                    group_id: Some(Some(group_id)),
                    node_id: None,
                    disabled: None,
                },
            )
            .map_err(ApiError::from)?;
    }
    publish_user_groups(&state, approved.id).await;
    Ok(Json(UserView::from(&approved)))
}

pub async fn reject(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<UserView>> {
    user.require_admin()?;
    let rejected = state.identity.reject_user(id).map_err(ApiError::from)?;
    publish_user_groups(&state, rejected.id).await;
    Ok(Json(UserView::from(&rejected)))
}

fn generated_password() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<24>())
}
