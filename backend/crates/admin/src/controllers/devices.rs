use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use chrono::Utc;
use uuid::Uuid;

use awg_clients::{Forwarding, NewDevice};
use awg_shared::cidr::address_with_prefix;
use awg_tariffs::Tariff;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{CreateDeviceRequest, CreateShareRequest, UpdateDeviceRequest};
use crate::state::AppState;
use crate::views::{DeviceView, ProfileView, ShareLinkView};

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<DeviceView>>> {
    let devices = if user.is_admin() {
        state.devices.list_all().map_err(ApiError::from)?
    } else {
        state
            .devices
            .list_for_user(user.id())
            .map_err(ApiError::from)?
    };
    let mut out = Vec::with_capacity(devices.len());
    for device in devices {
        out.push(build_view(&state, &device)?);
    }
    Ok(Json(out))
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<DeviceView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    Ok(Json(build_view(&state, &device)?))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateDeviceRequest>,
) -> ApiResult<Json<DeviceView>> {
    let target_user_id = match request.user_id {
        Some(id) => {
            user.require_self_or_admin(id)?;
            id
        }
        None => user.id(),
    };
    let owner = state
        .identity
        .find(target_user_id)
        .map_err(ApiError::from)?;
    let tariff = state
        .devices
        .tariff_for(&owner)
        .map_err(ApiError::from)?
        .unwrap_or_else(unlimited_tariff);
    let group_id = match request.group_id {
        Some(id) => id,
        None => owner
            .group_id
            .ok_or_else(|| ApiError::BadRequest("user has no group assigned".into()))?,
    };
    let group = state.network.get_group(group_id).map_err(ApiError::from)?;
    let settings = state.settings.get().map_err(ApiError::from)?;
    let forwarding = request.forwarding.unwrap_or(Forwarding {
        to_own_devices: group.forwarding_default,
        allowed_devices: vec![],
    });
    let device = state
        .devices
        .create(
            &owner,
            &tariff,
            NewDevice {
                user_id: owner.id,
                group_id,
                name: request.name,
                down_kbps: request.down_kbps,
                up_kbps: request.up_kbps,
                forwarding,
            },
            &settings.obfuscation,
        )
        .map_err(ApiError::from)?;
    publish_group(&state, group_id);
    Ok(Json(build_view(&state, &device)?))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateDeviceRequest>,
) -> ApiResult<Json<DeviceView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    if user.is_admin() && request.revoked.is_some() {
        state
            .devices
            .revoke(id, request.revoked.unwrap_or(false))
            .map_err(ApiError::from)?;
    }
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
        .update(
            id,
            &tariff,
            request.name,
            request.down_kbps,
            request.up_kbps,
            request.forwarding,
        )
        .map_err(ApiError::from)?;
    publish_group(&state, updated.group_id);
    Ok(Json(build_view(&state, &updated)?))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    state.devices.delete(id).map_err(ApiError::from)?;
    publish_group(&state, device.group_id);
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn profiles(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<ProfileView>>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let (_, profiles) = state.profiles.build_all(id).map_err(ApiError::from)?;
    Ok(Json(profiles.into_iter().map(ProfileView::from).collect()))
}

pub async fn profile(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((id, interface_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<ProfileView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let profile = state
        .profiles
        .build_one(id, interface_id)
        .map_err(ApiError::from)?;
    Ok(Json(ProfileView::from(profile)))
}

pub async fn create_share(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<CreateShareRequest>,
) -> ApiResult<Json<ShareLinkView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let ttl = request.ttl_secs.unwrap_or(state.config.share_ttl_secs);
    let link = state
        .share
        .create(id, request.interface_id, user.id(), request.format, ttl)
        .map_err(ApiError::from)?;
    Ok(Json(ShareLinkView::build(&link, &public_base(&state))))
}

pub async fn list_shares(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<ShareLinkView>>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let links = state.share.list_for_device(id).map_err(ApiError::from)?;
    Ok(Json(
        links
            .iter()
            .map(|link| ShareLinkView::build(link, &public_base(&state)))
            .collect(),
    ))
}

pub async fn revoke_share(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(token): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let link = state.share.resolve(&token);
    if link.is_err() {
        user.require_admin()?;
    }
    state.share.revoke(&token).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn build_view(state: &AppState, device: &awg_clients::Device) -> Result<DeviceView, ApiError> {
    let peers = state.devices.peers_for(device.id).map_err(ApiError::from)?;
    let pools = state
        .network
        .list_pools(device.group_id)
        .map_err(ApiError::from)?;
    let pool_map: HashMap<Uuid, &awg_network::CidrPool> = pools.iter().map(|p| (p.id, p)).collect();
    let interfaces = state
        .network
        .interfaces_by_group(device.group_id)
        .map_err(ApiError::from)?;
    let mut names = Vec::new();
    for peer in &peers {
        let interface_name = interfaces
            .iter()
            .find(|i| i.id == peer.interface_id)
            .map(|i| i.name.clone())
            .unwrap_or_default();
        let mut addresses = Vec::new();
        for (pool_id, ip) in &peer.ips {
            if let (Some(pool), std::net::IpAddr::V4(v4)) = (pool_map.get(pool_id), ip) {
                let net = state.network.pool_net(pool).map_err(ApiError::from)?;
                addresses.push(address_with_prefix(*v4, net));
            }
        }
        names.push((peer.interface_id, interface_name, addresses));
    }
    Ok(DeviceView::build(device, &peers, &names))
}

fn publish_group(state: &AppState, group_id: Uuid) {
    if let Ok(interfaces) = state.network.interfaces_by_group(group_id) {
        let mut nodes: Vec<Uuid> = interfaces.iter().map(|i| i.node_id).collect();
        nodes.sort();
        nodes.dedup();
        for node in nodes {
            let _ = state.orchestration.publish(node);
        }
    }
}

fn unlimited_tariff() -> Tariff {
    let now = Utc::now();
    Tariff {
        id: Uuid::nil(),
        name: "Unlimited".into(),
        description: "Synthetic tariff for accounts without one".into(),
        max_devices: u32::MAX,
        device_down_kbps: 0,
        device_up_kbps: 0,
        group_down_kbps: 0,
        group_up_kbps: 0,
        traffic_quota_bytes: None,
        created_at: now,
        updated_at: now,
    }
}

fn public_base(state: &AppState) -> String {
    let configured = state.config.public_url.trim().trim_end_matches('/');
    if configured.is_empty() {
        String::new()
    } else {
        configured.to_string()
    }
}
