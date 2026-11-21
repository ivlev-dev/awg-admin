use std::collections::HashSet;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use base64::Engine;
use uuid::Uuid;

use awg_identity::{NewUser, Role, User, UserChanges, UserPageQuery, UserPageTab};
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
const LAST_ADMIN_CONFLICT: &str = "cannot remove the last administrator";

/// Serializes role/status changes that could remove an administrator so two
/// concurrent demotions cannot both observe a second admin and leave the
/// system without one.
static ADMIN_MUTATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_admin_mutation() -> std::sync::MutexGuard<'static, ()> {
    ADMIN_MUTATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

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

    fn to_page_tab(self) -> UserPageTab {
        match self {
            Self::Active => UserPageTab::Active,
            Self::Pending => UserPageTab::Pending,
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

fn ensure_group(state: &AppState, group_id: Option<Uuid>) -> ApiResult<()> {
    if let Some(group_id) = group_id {
        state.network.get_group(group_id).map_err(ApiError::from)?;
    }
    Ok(())
}

fn ensure_tariff(state: &AppState, tariff_id: Option<Uuid>) -> ApiResult<()> {
    if let Some(tariff_id) = tariff_id {
        state.tariffs.get(tariff_id).map_err(ApiError::from)?;
    }
    Ok(())
}

fn is_active_admin(user: &User) -> bool {
    user.role.is_admin() && !user.disabled
}

fn active_admin_count(state: &AppState) -> ApiResult<usize> {
    let users = state.identity.list().map_err(ApiError::from)?;
    Ok(users.iter().filter(|user| is_active_admin(user)).count())
}

/// Rejects a change that would leave the system without an active
/// administrator. The check only applies when the target currently *is* an
/// active administrator, so disabling or deleting an already disabled admin
/// account is never blocked.
fn ensure_admin_survives(state: &AppState, target_id: Uuid) -> ApiResult<()> {
    let target = state.identity.find(target_id).map_err(ApiError::from)?;
    if !is_active_admin(&target) {
        return Ok(());
    }
    if active_admin_count(state)? > 1 {
        return Ok(());
    }
    Err(ApiError::Conflict(LAST_ADMIN_CONFLICT.into()))
}

fn request_demotes_admin(request: &UpdateUserRequest) -> bool {
    matches!(request.role, Some(role) if !role.is_admin()) || request.disabled == Some(true)
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
            let query = UserPageQuery {
                limit,
                offset,
                q,
                role,
                disabled,
                tab: tab.to_page_tab(),
            };
            let page = identity.page(&query).map_err(ApiError::from)?;
            let items = page.items.iter().map(UserView::from).collect();
            Ok(PageView::new(items, page.total, page.limit, page.offset))
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
    let password = request
        .password
        .filter(|password| !password.trim().is_empty())
        .unwrap_or_else(generated_password);
    let created = {
        let state = state.clone();
        blocking::run_api(move || {
            ensure_node(&state, request.node_id)?;
            ensure_group(&state, request.group_id)?;
            ensure_tariff(&state, request.tariff_id)?;
            let input = NewUser {
                email: request.email,
                full_name: request.full_name,
                password,
                role: request.role,
                tariff_id: request.tariff_id,
                group_id: request.group_id,
                node_id: request.node_id,
            };
            state.identity.create(input).map_err(ApiError::from)
        })
        .await?
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
    let found = {
        let identity = state.identity.clone();
        blocking::run_core(move || identity.find(id))
            .await
            .map_err(ApiError::from)?
    };
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
    let demotes_admin = request_demotes_admin(&request);
    let updated = {
        let state = state.clone();
        blocking::run_api(move || {
            if let Some(Some(node_id)) = request.node_id {
                ensure_node(&state, Some(node_id))?;
            }
            if let Some(Some(group_id)) = request.group_id {
                ensure_group(&state, Some(group_id))?;
            }
            if let Some(Some(tariff_id)) = request.tariff_id {
                ensure_tariff(&state, Some(tariff_id))?;
            }
            let _guard = demotes_admin.then(lock_admin_mutation);
            if demotes_admin {
                ensure_admin_survives(&state, id)?;
            }
            state
                .identity
                .update(
                    id,
                    UserChanges {
                        email: request.email,
                        full_name: request.full_name,
                        role: request.role,
                        tariff_id: request.tariff_id,
                        group_id: request.group_id,
                        node_id: request.node_id,
                        disabled: request.disabled,
                    },
                )
                .map_err(ApiError::from)
        })
        .await?
    };
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
    let groups = {
        let state = state.clone();
        blocking::run_api(move || {
            let _guard = lock_admin_mutation();
            ensure_admin_survives(&state, id)?;
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
            Ok(groups)
        })
        .await?
    };
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
    let approved = {
        let state = state.clone();
        blocking::run_api(move || {
            ensure_tariff(&state, Some(request.tariff_id))?;
            ensure_group(&state, request.group_id)?;
            ensure_node(&state, request.node_id)?;
            let identity = &state.identity;
            let original = identity.find(id).map_err(ApiError::from)?;
            let approved = identity
                .approve_user(id, request.tariff_id, request.node_id)
                .map_err(ApiError::from)?;
            let Some(group_id) = request.group_id else {
                return Ok(approved);
            };
            match identity.update(
                approved.id,
                UserChanges {
                    email: None,
                    full_name: None,
                    role: None,
                    tariff_id: None,
                    group_id: Some(Some(group_id)),
                    node_id: None,
                    disabled: None,
                },
            ) {
                Ok(updated) => Ok(updated),
                Err(error) => {
                    // The approval has already been persisted. Compensate so a
                    // user is never left activated with a broken group binding:
                    // restore the original profile and keep the account
                    // disabled until an administrator retries the approval.
                    let rollback = identity.update(
                        id,
                        UserChanges {
                            email: None,
                            full_name: None,
                            role: Some(original.role),
                            tariff_id: Some(original.tariff_id),
                            group_id: Some(original.group_id),
                            node_id: Some(original.node_id),
                            disabled: Some(true),
                        },
                    );
                    if let Err(rollback_error) = rollback {
                        tracing::error!(
                            %rollback_error,
                            "failed to roll back a partially approved user"
                        );
                    }
                    Err(ApiError::from(error))
                }
            }
        })
        .await?
    };
    publish_user_groups(&state, approved.id).await;
    Ok(Json(UserView::from(&approved)))
}

pub async fn reject(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<UserView>> {
    user.require_admin()?;
    let rejected = {
        let identity = state.identity.clone();
        blocking::run_core(move || identity.reject_user(id))
            .await
            .map_err(ApiError::from)?
    };
    publish_user_groups(&state, rejected.id).await;
    Ok(Json(UserView::from(&rejected)))
}

fn generated_password() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<24>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::app_env;

    #[test]
    fn last_active_admin_cannot_be_removed() {
        let env = app_env();
        let admin = env
            .state
            .identity
            .update(
                env.owner_id,
                UserChanges {
                    email: None,
                    full_name: None,
                    role: Some(Role::Admin),
                    tariff_id: None,
                    group_id: None,
                    node_id: None,
                    disabled: None,
                },
            )
            .unwrap();
        assert!(is_active_admin(&admin));
        assert_eq!(active_admin_count(&env.state).unwrap(), 1);
        let error = ensure_admin_survives(&env.state, admin.id).unwrap_err();
        assert!(matches!(error, ApiError::Conflict(_)));
        assert_eq!(error.message(), LAST_ADMIN_CONFLICT);
    }

    #[test]
    fn removing_one_of_two_admins_is_allowed() {
        let env = app_env();
        let first = env
            .state
            .identity
            .update(
                env.owner_id,
                UserChanges {
                    email: None,
                    full_name: None,
                    role: Some(Role::Admin),
                    tariff_id: None,
                    group_id: None,
                    node_id: None,
                    disabled: None,
                },
            )
            .unwrap();
        env.state
            .identity
            .update(
                env.other_id,
                UserChanges {
                    email: None,
                    full_name: None,
                    role: Some(Role::Admin),
                    tariff_id: None,
                    group_id: None,
                    node_id: None,
                    disabled: None,
                },
            )
            .unwrap();
        assert_eq!(active_admin_count(&env.state).unwrap(), 2);
        ensure_admin_survives(&env.state, first.id).unwrap();
    }

    #[test]
    fn disabled_admins_do_not_count_as_active() {
        let env = app_env();
        env.state
            .identity
            .update(
                env.owner_id,
                UserChanges {
                    email: None,
                    full_name: None,
                    role: Some(Role::Admin),
                    tariff_id: None,
                    group_id: None,
                    node_id: None,
                    disabled: Some(true),
                },
            )
            .unwrap();
        let other = env.state.identity.find(env.other_id).unwrap();
        assert!(!is_active_admin(&other));
        assert_eq!(active_admin_count(&env.state).unwrap(), 0);
        // A non-admin or disabled target never triggers the last-admin guard.
        ensure_admin_survives(&env.state, env.owner_id).unwrap();
    }

    #[test]
    fn update_requests_that_remove_an_admin_are_detected() {
        assert!(request_demotes_admin(&UpdateUserRequest {
            role: Some(Role::User),
            ..UpdateUserRequest::default()
        }));
        assert!(request_demotes_admin(&UpdateUserRequest {
            disabled: Some(true),
            ..UpdateUserRequest::default()
        }));
        assert!(!request_demotes_admin(&UpdateUserRequest {
            role: Some(Role::Admin),
            disabled: Some(false),
            ..UpdateUserRequest::default()
        }));
    }
}
