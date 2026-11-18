use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::Utc;
use uuid::Uuid;

use awg_clients::{Device, DeviceProfile, Forwarding, NewDevice};
use awg_identity::User;
use awg_network::Interface;
use awg_shared::CoreError;
use awg_statistics::StatsScope;
use awg_tariffs::Tariff;

use crate::auth::AuthUser;
use crate::controllers::devices::{build_view, build_views, forwarding_default, unlimited_tariff};
use crate::controllers::quota::current_quota;
use crate::error::{ApiError, ApiResult};
use crate::models::AppDeviceRequest;
use crate::publish::publish_group;
use crate::state::AppState;
use crate::views::{
    AppAccessView, AppBootstrapView, AppDeviceView, AppInterfaceView, AppSubscriptionView,
    AppTariffView, DeviceConfigView, DeviceView, UserView,
};

pub async fn bootstrap(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<AppBootstrapView>> {
    let account = state.identity.find(user.id()).map_err(ApiError::from)?;
    let tariff = state.devices.tariff_for(&account).map_err(ApiError::from)?;
    let used = state
        .stats
        .used_bytes(StatsScope::User(account.id))
        .map_err(ApiError::from)?;
    let quota =
        current_quota(&state.tariffs, &account, used, Utc::now()).map_err(ApiError::from)?;
    let subscription = app_subscription(&state, account.id)?;
    let access = AppAccessView::build(
        tariff.is_none(),
        quota.exceeded,
        app_subscription_inactive(&state, account.id)?,
    );
    let devices = state
        .devices
        .list_for_user(account.id)
        .map_err(ApiError::from)?;
    let interfaces = available_interfaces(&state, &account, tariff.as_ref())?;
    Ok(Json(AppBootstrapView {
        user: UserView::from(&account),
        tariff: tariff.as_ref().map(AppTariffView::from),
        quota,
        subscription,
        access,
        devices: build_views(&state.devices, &state.network, &devices)?,
        interfaces,
    }))
}

fn app_subscription(state: &AppState, user_id: Uuid) -> ApiResult<Option<AppSubscriptionView>> {
    if !state.config.billing.enabled {
        return Ok(None);
    }
    let Some(subscription) = state
        .billing
        .current_subscription(user_id)
        .map_err(ApiError::from)?
    else {
        return Ok(None);
    };
    let plan = match state.billing.get_plan(subscription.plan_id) {
        Ok(plan) => Some(plan),
        Err(CoreError::NotFound(_)) => None,
        Err(error) => return Err(ApiError::from(error)),
    };
    Ok(Some(AppSubscriptionView::build(
        &subscription,
        plan.as_ref(),
    )))
}

fn app_subscription_inactive(state: &AppState, user_id: Uuid) -> ApiResult<bool> {
    if !state.config.billing.enabled {
        return Ok(false);
    }
    let latest = state
        .billing
        .latest_subscription(user_id)
        .map_err(ApiError::from)?;
    Ok(latest.is_some_and(|subscription| !subscription.grants_access()))
}

pub async fn create_device(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<AppDeviceRequest>,
) -> ApiResult<Json<AppDeviceView>> {
    let name = request.resolved_name().map_err(ApiError::BadRequest)?;
    let owner = state.identity.find(user.id()).map_err(ApiError::from)?;
    let tariff = state
        .devices
        .tariff_for(&owner)
        .map_err(ApiError::from)?
        .ok_or(ApiError::TariffRequired)?;
    let group_id = owner.group_id;
    let (interface_id, interface_ids) = if request.interface_ids.is_empty() {
        (
            Some(select_interface(&state, &owner, &tariff, group_id)?),
            Vec::new(),
        )
    } else {
        (None, request.interface_ids)
    };
    let settings = state.settings.get().map_err(ApiError::from)?;
    let forwarding = Forwarding {
        to_own_devices: forwarding_default(
            &state,
            &owner,
            &tariff,
            interface_id.or_else(|| interface_ids.first().copied()),
            group_id,
        ),
        allowed_devices: Vec::new(),
    };
    let device = state
        .devices
        .create(
            &owner,
            &tariff,
            NewDevice {
                user_id: owner.id,
                group_id,
                interface_id,
                interface_ids,
                name,
                down_kbps: 0,
                up_kbps: 0,
                forwarding,
            },
            &settings.obfuscation,
        )
        .map_err(ApiError::from)?;
    publish_group(&state, device.group_id);
    let configs = device_configs_for(&state, device.id)?;
    let config = configs
        .iter()
        .find(|config| config.interface_id == device.interface_id)
        .cloned()
        .or_else(|| configs.first().cloned())
        .ok_or_else(|| ApiError::NotFound("device peer".into()))?;
    Ok(Json(AppDeviceView {
        device: build_view(&state, &device)?,
        config,
        configs,
    }))
}

pub async fn device_configs(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<DeviceConfigView>>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    Ok(Json(device_configs_for(&state, id)?))
}

fn device_configs_for(state: &AppState, id: Uuid) -> ApiResult<Vec<DeviceConfigView>> {
    let (_, profiles) = state.profiles.build_all(id).map_err(ApiError::from)?;
    Ok(profiles.into_iter().map(DeviceConfigView::from).collect())
}

pub async fn device_config(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<DeviceConfigView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let profile = build_profile(&state, &device)?;
    Ok(Json(DeviceConfigView::from(profile)))
}

pub async fn update_device(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<AppDeviceRequest>,
) -> ApiResult<Json<DeviceView>> {
    let name = request.resolved_name().map_err(ApiError::BadRequest)?;
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let owner = state
        .identity
        .find(device.user_id)
        .map_err(ApiError::from)?;
    let tariff = state
        .devices
        .tariff_for(&owner)
        .map_err(ApiError::from)?
        .unwrap_or_else(unlimited_tariff);
    let updated = state
        .devices
        .update(id, &tariff, Some(name), None, None, None)
        .map_err(ApiError::from)?;
    publish_group(&state, updated.group_id);
    Ok(Json(build_view(&state, &updated)?))
}

pub async fn delete_device(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    state.devices.delete(id).map_err(ApiError::from)?;
    publish_group(&state, device.group_id);
    Ok(StatusCode::NO_CONTENT)
}

fn build_profile(state: &AppState, device: &Device) -> ApiResult<DeviceProfile> {
    match state.profiles.build_one(device.id, device.interface_id) {
        Ok(profile) => Ok(profile),
        Err(CoreError::NotFound(_)) => {
            let (_, profiles) = state
                .profiles
                .build_all(device.id)
                .map_err(ApiError::from)?;
            profiles
                .into_iter()
                .next()
                .ok_or_else(|| ApiError::NotFound("device peer".into()))
        }
        Err(error) => Err(ApiError::from(error)),
    }
}

fn select_interface(
    state: &AppState,
    owner: &User,
    tariff: &Tariff,
    group_id: Option<Uuid>,
) -> ApiResult<Uuid> {
    if let Some(interface_id) = tariff.interface_id {
        return Ok(interface_id);
    }
    if let Some(node_id) = owner.node_id {
        let interfaces = state
            .network
            .interfaces_by_node(node_id)
            .map_err(ApiError::from)?;
        if let Some(interface) = pick_interface(interfaces) {
            return Ok(interface.id);
        }
    }
    if let Some(group_id) = group_id {
        let interfaces = state
            .network
            .interfaces_by_group(group_id)
            .map_err(ApiError::from)?;
        if let Some(interface) = pick_interface(interfaces) {
            return Ok(interface.id);
        }
    }
    Err(ApiError::BadRequest(
        "no enabled interface is available for this account".into(),
    ))
}

fn pick_interface(interfaces: Vec<Interface>) -> Option<Interface> {
    let mut enabled: Vec<Interface> = interfaces
        .into_iter()
        .filter(|interface| interface.enabled)
        .collect();
    enabled.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    enabled.into_iter().next()
}

fn available_interfaces(
    state: &AppState,
    owner: &User,
    tariff: Option<&Tariff>,
) -> ApiResult<Vec<AppInterfaceView>> {
    let mut interfaces = if let Some(interface_id) = tariff.and_then(|tariff| tariff.interface_id) {
        match state.network.get_interface(interface_id) {
            Ok(interface) => vec![interface],
            Err(CoreError::NotFound(_)) => Vec::new(),
            Err(error) => return Err(ApiError::from(error)),
        }
    } else if let Some(node_id) = owner.node_id {
        state
            .network
            .interfaces_by_node(node_id)
            .map_err(ApiError::from)?
    } else if let Some(group_id) = owner.group_id {
        state
            .network
            .interfaces_by_group(group_id)
            .map_err(ApiError::from)?
    } else {
        Vec::new()
    };
    interfaces.retain(|interface| interface.enabled);
    interfaces.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    let nodes: std::collections::HashMap<Uuid, String> = state
        .network
        .list_nodes()
        .map_err(ApiError::from)?
        .into_iter()
        .map(|node| (node.id, node.name))
        .collect();
    Ok(interfaces
        .into_iter()
        .map(|interface| AppInterfaceView {
            id: interface.id,
            name: interface.name,
            node_id: interface.node_id,
            node_name: nodes.get(&interface.node_id).cloned().unwrap_or_default(),
        })
        .collect())
}
