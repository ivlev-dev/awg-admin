use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::Utc;
use ipnet::Ipv4Net;
use uuid::Uuid;

use awg_clients::{
    DEFAULT_DEVICE_PAGE_LIMIT, Device, DevicePageOrder, DevicePageQuery, DevicePageSort,
    DevicePageStatus, DevicePeer, DeviceService, Forwarding, MAX_DEVICE_PAGE_LIMIT, NewDevice,
};
use awg_network::{CidrPool, NetworkService};
use awg_shared::cidr::address_with_prefix;
use awg_tariffs::Tariff;

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::{ApiError, ApiResult};
use crate::models::{
    CreateDeviceRequest, CreateShareRequest, CreateTunnelRequest, DevicePageParams,
    UpdateDeviceRequest, UpdateTunnelRequest,
};
use crate::publish::publish_group;
use crate::state::AppState;
use crate::views::{DeviceView, PageView, ProfileView, ShareLinkView};

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<DeviceView>>> {
    let admin = user.is_admin();
    let user_id = user.id();
    let devices = {
        let state = state.clone();
        blocking::run_api(move || {
            let devices = if admin {
                state.devices.list_all()?
            } else {
                state.devices.list_for_user(user_id)?
            };
            build_views(&state.devices, &state.network, &devices)
        })
        .await?
    };
    Ok(Json(devices))
}

pub async fn page(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(params): Query<DevicePageParams>,
) -> ApiResult<Json<PageView<DeviceView>>> {
    let admin = user.is_admin();
    let requester = user.id();
    if !admin
        && let Some(requested) = params.user_id
        && requested != requester
    {
        return Err(ApiError::Forbidden(
            "access to another user is denied".into(),
        ));
    }
    let user_filter = if admin {
        params.user_id
    } else {
        Some(requester)
    };
    let page = {
        let state = state.clone();
        blocking::run_api(move || page_view(&state, user_filter, params)).await?
    };
    Ok(Json(page))
}

pub(crate) fn page_view(
    state: &AppState,
    user_filter: Option<Uuid>,
    params: DevicePageParams,
) -> ApiResult<PageView<DeviceView>> {
    let limit = params.limit.unwrap_or(DEFAULT_DEVICE_PAGE_LIMIT as u32);
    if limit == 0 || limit as usize > MAX_DEVICE_PAGE_LIMIT {
        return Err(ApiError::BadRequest(format!(
            "limit must be between 1 and {MAX_DEVICE_PAGE_LIMIT}"
        )));
    }
    let status = DevicePageStatus::parse(params.status.as_deref()).map_err(ApiError::from)?;
    let sort = DevicePageSort::parse(params.sort.as_deref()).map_err(ApiError::from)?;
    let order = DevicePageOrder::parse(params.order.as_deref()).map_err(ApiError::from)?;
    let q = DevicePageQuery::normalize_q(params.q.as_deref());
    let owner_emails = if q.is_some() {
        state
            .identity
            .list()
            .map_err(ApiError::from)?
            .into_iter()
            .filter(|owner| user_filter.is_none_or(|id| owner.id == id))
            .map(|owner| (owner.id, owner.email.clone()))
            .collect()
    } else {
        HashMap::new()
    };
    let query = DevicePageQuery {
        limit: limit as usize,
        offset: params.offset.unwrap_or(0) as usize,
        q,
        status,
        interface_id: params.interface_id,
        user_id: user_filter,
        sort,
        order,
        owner_emails,
    };
    let page = state.devices.page(&query).map_err(ApiError::from)?;
    let views = build_views(&state.devices, &state.network, &page.items)?;
    Ok(PageView::new(views, page.total, page.limit, page.offset))
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
    let group_id = request.group_id.or(owner.group_id);
    if !user.is_admin() {
        authorize_placement(
            &state,
            &owner,
            &tariff,
            group_id,
            request.interface_id,
            &request.interface_ids,
        )?;
    }
    let settings = state.settings.get().map_err(ApiError::from)?;
    let forwarding = request.forwarding.unwrap_or(Forwarding {
        to_own_devices: forwarding_default(
            &state,
            &owner,
            &tariff,
            request
                .interface_id
                .or_else(|| request.interface_ids.first().copied()),
            group_id,
        ),
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
                interface_id: request.interface_id,
                interface_ids: request.interface_ids,
                name: request.name,
                down_kbps: request.down_kbps,
                up_kbps: request.up_kbps,
                forwarding,
            },
            &settings.obfuscation,
        )
        .await
        .map_err(ApiError::from)?;
    publish_group(&state, device.group_id).await;
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
    publish_group(&state, updated.group_id).await;
    Ok(Json(build_view(&state, &updated)?))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    state
        .share
        .revoke_all_for_device(id)
        .map_err(ApiError::from)?;
    state.devices.delete(id).map_err(ApiError::from)?;
    publish_group(&state, device.group_id).await;
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

pub async fn profile_by_peer(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((id, peer_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<ProfileView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let profile = state
        .profiles
        .build_peer(id, peer_id)
        .map_err(ApiError::from)?;
    Ok(Json(ProfileView::from(profile)))
}

pub async fn create_tunnel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<CreateTunnelRequest>,
) -> ApiResult<Json<DeviceView>> {
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
    if !user.is_admin() {
        authorize_placement(
            &state,
            &owner,
            &tariff,
            Some(device.group_id),
            Some(request.interface_id),
            &[],
        )?;
    }
    let settings = state.settings.get().map_err(ApiError::from)?;
    state
        .devices
        .add_peer(
            &owner,
            &tariff,
            id,
            request.interface_id,
            request.label,
            &settings.obfuscation,
        )
        .await
        .map_err(ApiError::from)?;
    publish_group(&state, device.group_id).await;
    Ok(Json(build_view(&state, &device)?))
}

pub async fn update_tunnel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((id, peer_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<UpdateTunnelRequest>,
) -> ApiResult<Json<DeviceView>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let peer = state.devices.peer(peer_id).map_err(ApiError::from)?;
    if peer.device_id != id {
        return Err(ApiError::NotFound("device peer".into()));
    }
    state
        .devices
        .rename_peer(peer_id, request.label)
        .map_err(ApiError::from)?;
    publish_group(&state, device.group_id).await;
    Ok(Json(build_view(&state, &device)?))
}

pub async fn delete_tunnel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((id, peer_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<axum::http::StatusCode> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let peer = state.devices.peer(peer_id).map_err(ApiError::from)?;
    if peer.device_id != id {
        return Err(ApiError::NotFound("device peer".into()));
    }
    state.devices.remove_peer(peer_id).map_err(ApiError::from)?;
    publish_group(&state, device.group_id).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
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
    let max_uses = request.resolved_max_uses().map_err(ApiError::BadRequest)?;
    let link = state
        .share
        .create(
            id,
            request.interface_id,
            user.id(),
            request.format,
            ttl,
            max_uses,
        )
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
    let now = Utc::now();
    Ok(Json(
        links
            .iter()
            .map(|link| ShareLinkView::build_at(link, &public_base(&state), now))
            .collect(),
    ))
}

pub async fn revoke_all_shares(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    let device = state.devices.get(id).map_err(ApiError::from)?;
    user.require_self_or_admin(device.user_id)?;
    let revoked = state
        .share
        .revoke_all_for_device(id)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "revoked": revoked })))
}

pub async fn revoke_share(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(token): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let link = state
        .share
        .find(&token)
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::NotFound("share link".into()))?;
    let owner_id = state
        .devices
        .get(link.device_id)
        .ok()
        .map(|device| device.user_id);
    if !user.is_admin() && owner_id != Some(user.id()) && link.created_by != user.id() {
        return Err(ApiError::Forbidden(
            "share link belongs to another user".into(),
        ));
    }
    state.share.revoke(&token).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub(crate) fn build_view(state: &AppState, device: &awg_clients::Device) -> ApiResult<DeviceView> {
    build_views(&state.devices, &state.network, std::slice::from_ref(device))?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::Internal("device view is missing".into()))
}

pub(crate) fn build_views(
    devices: &DeviceService,
    network: &NetworkService,
    items: &[Device],
) -> ApiResult<Vec<DeviceView>> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = items.iter().map(|device| device.id).collect();
    let mut peers_by_device: HashMap<Uuid, Vec<DevicePeer>> = HashMap::new();
    for peer in devices.peers_for_devices(&ids).map_err(ApiError::from)? {
        peers_by_device
            .entry(peer.device_id)
            .or_default()
            .push(peer);
    }
    let interface_names: HashMap<Uuid, (String, Uuid)> = network
        .list_interfaces()
        .map_err(ApiError::from)?
        .into_iter()
        .map(|interface| (interface.id, (interface.name, interface.node_id)))
        .collect();
    let node_names: HashMap<Uuid, String> = network
        .list_nodes()
        .map_err(ApiError::from)?
        .into_iter()
        .map(|node| (node.id, node.name))
        .collect();
    let pools = network.list_all_pools().map_err(ApiError::from)?;
    let mut pools_by_group: HashMap<Uuid, HashMap<Uuid, &CidrPool>> = HashMap::new();
    for pool in &pools {
        pools_by_group
            .entry(pool.group_id)
            .or_default()
            .insert(pool.id, pool);
    }
    let mut pool_nets: HashMap<Uuid, Ipv4Net> = HashMap::new();
    let mut views = Vec::with_capacity(items.len());
    for device in items {
        let peers = peers_by_device
            .get(&device.id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let group_pools = pools_by_group.get(&device.group_id);
        for pool_id in peers.iter().flat_map(|peer| peer.ips.keys()) {
            if pool_nets.contains_key(pool_id) {
                continue;
            }
            if let Some(pool) = group_pools.and_then(|pools| pools.get(pool_id)) {
                pool_nets.insert(*pool_id, network.pool_net(pool).map_err(ApiError::from)?);
            }
        }
        views.push(assemble_view(
            device,
            peers,
            &interface_names,
            &node_names,
            &pool_nets,
        ));
    }
    Ok(views)
}

fn assemble_view(
    device: &Device,
    peers: &[DevicePeer],
    interfaces: &HashMap<Uuid, (String, Uuid)>,
    node_names: &HashMap<Uuid, String>,
    pool_nets: &HashMap<Uuid, Ipv4Net>,
) -> DeviceView {
    let names: Vec<(Uuid, Uuid, String, Vec<String>)> = peers
        .iter()
        .map(|peer| {
            let name = interfaces
                .get(&peer.interface_id)
                .map(|(name, _)| name.clone())
                .unwrap_or_default();
            let addresses = peer
                .ips
                .iter()
                .filter_map(|(pool_id, ip)| match (pool_nets.get(pool_id), ip) {
                    (Some(net), IpAddr::V4(v4)) => Some(address_with_prefix(*v4, *net)),
                    _ => None,
                })
                .collect();
            (peer.id, peer.interface_id, name, addresses)
        })
        .collect();
    let (interface_name, node_id) = interfaces
        .get(&device.interface_id)
        .cloned()
        .unwrap_or_default();
    let node_name = node_names.get(&node_id).cloned().unwrap_or_default();
    DeviceView::build(device, peers, &names, &interface_name, node_id, &node_name)
}

/// Restricts where a non-administrator may place devices and interfaces.
/// Interfaces explicitly allowed by the tariff are always accepted; everything
/// else must belong to the group assigned to the account.
pub(crate) fn authorize_placement(
    state: &AppState,
    owner: &awg_identity::User,
    tariff: &Tariff,
    group_id: Option<Uuid>,
    interface_id: Option<Uuid>,
    interface_ids: &[Uuid],
) -> ApiResult<()> {
    let allowed_group = owner.group_id;
    if allowed_group.is_none() && group_id.is_some() {
        return Err(ApiError::Forbidden(
            "account is not assigned to a group".into(),
        ));
    }
    if let Some(group_id) = group_id
        && allowed_group != Some(group_id)
    {
        return Err(ApiError::Forbidden(
            "group is not assigned to this account".into(),
        ));
    }
    for id in interface_id.iter().chain(interface_ids.iter()) {
        if tariff.interface_id == Some(*id) {
            continue;
        }
        let interface = state.network.get_interface(*id).map_err(ApiError::from)?;
        let assigned_to_group = allowed_group == Some(interface.group_id);
        let assigned_to_node = owner.node_id == Some(interface.node_id);
        if !assigned_to_group && !assigned_to_node {
            return Err(ApiError::Forbidden(
                "interface is not assigned to this account".into(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn forwarding_default(
    state: &AppState,
    owner: &awg_identity::User,
    tariff: &Tariff,
    requested: Option<Uuid>,
    group_id: Option<Uuid>,
) -> bool {
    let interface = tariff
        .interface_id
        .and_then(|id| state.network.get_interface(id).ok())
        .or_else(|| requested.and_then(|id| state.network.get_interface(id).ok()))
        .or_else(|| {
            owner
                .node_id
                .and_then(|node_id| state.network.interfaces_by_node(node_id).ok())
                .and_then(|interfaces| interfaces.into_iter().next())
        })
        .or_else(|| {
            group_id
                .and_then(|group_id| state.network.interfaces_by_group(group_id).ok())
                .and_then(|interfaces| interfaces.into_iter().next())
        });
    interface
        .and_then(|interface| state.network.get_group(interface.group_id).ok())
        .map(|group| group.forwarding_default)
        .unwrap_or(false)
}

pub(crate) fn unlimited_tariff() -> Tariff {
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
        interface_id: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded;

    fn legacy_views(
        devices: &DeviceService,
        network: &NetworkService,
        items: &[Device],
    ) -> Vec<DeviceView> {
        let mut out = Vec::new();
        let interfaces = network.list_interfaces().unwrap();
        let nodes = network.list_nodes().unwrap();
        for device in items {
            let peers = devices.peers_for(device.id).unwrap();
            let pools = network.list_pools(device.group_id).unwrap();
            let pool_map: HashMap<Uuid, &CidrPool> =
                pools.iter().map(|pool| (pool.id, pool)).collect();
            let mut names = Vec::new();
            for peer in &peers {
                let interface_name = interfaces
                    .iter()
                    .find(|interface| interface.id == peer.interface_id)
                    .map(|interface| interface.name.clone())
                    .unwrap_or_default();
                let mut addresses = Vec::new();
                for (pool_id, ip) in &peer.ips {
                    if let (Some(pool), std::net::IpAddr::V4(v4)) = (pool_map.get(pool_id), ip) {
                        addresses.push(address_with_prefix(*v4, network.pool_net(pool).unwrap()));
                    }
                }
                names.push((peer.id, peer.interface_id, interface_name, addresses));
            }
            let interface = interfaces
                .iter()
                .find(|interface| interface.id == device.interface_id);
            let node = interface
                .and_then(|interface| nodes.iter().find(|node| node.id == interface.node_id));
            out.push(DeviceView::build(
                device,
                &peers,
                &names,
                interface
                    .map(|interface| interface.name.as_str())
                    .unwrap_or(""),
                interface
                    .map(|interface| interface.node_id)
                    .unwrap_or_default(),
                node.map(|node| node.name.as_str()).unwrap_or(""),
            ));
        }
        out
    }

    #[test]
    fn bulk_views_match_legacy_json() {
        let (env, sample) = seeded();
        let bulk = build_views(&env.devices, &env.network, &sample.devices).unwrap();
        let legacy = legacy_views(&env.devices, &env.network, &sample.devices);
        assert_eq!(
            serde_json::to_value(&bulk).unwrap(),
            serde_json::to_value(&legacy).unwrap()
        );
        let names: Vec<&str> = bulk.iter().map(|view| view.name.as_str()).collect();
        let expected: Vec<&str> = sample
            .devices
            .iter()
            .map(|device| device.name.as_str())
            .collect();
        assert_eq!(names, expected);
    }

    #[test]
    fn bulk_views_keep_peer_names_and_addresses() {
        let (env, sample) = seeded();
        let views = build_views(&env.devices, &env.network, &sample.devices).unwrap();

        let phone = views.iter().find(|view| view.name == "phone").unwrap();
        assert_eq!(phone.peers.len(), 1);
        assert_eq!(phone.interface_name, "awg0");
        assert_eq!(
            phone.addresses,
            vec!["10.1.0.2".to_string(), "10.2.0.5".to_string()]
        );
        let awg0 = phone
            .peers
            .iter()
            .find(|peer| peer.interface_id == sample.iface_a0)
            .unwrap();
        assert_eq!(awg0.interface_name, "awg0");
        let mut addresses = awg0.addresses.clone();
        addresses.sort();
        assert_eq!(
            addresses,
            vec!["10.1.0.2/24".to_string(), "10.2.0.5/24".to_string()]
        );

        let laptop = views.iter().find(|view| view.name == "laptop").unwrap();
        assert_eq!(laptop.peers.len(), 1);
        assert_eq!(laptop.peers[0].interface_name, "awg0");
        assert_eq!(laptop.peers[0].addresses, vec!["10.1.0.3/24".to_string()]);

        let tablet = views.iter().find(|view| view.name == "tablet").unwrap();
        assert_eq!(tablet.peers[0].interface_name, "awg2");
        assert_eq!(tablet.peers[0].addresses, vec!["10.10.0.7/25".to_string()]);

        let lonely = views.iter().find(|view| view.name == "lonely").unwrap();
        assert!(lonely.peers.is_empty());
        assert!(lonely.addresses.is_empty());
    }

    #[test]
    fn bulk_views_use_constant_repository_calls() {
        let (env, sample) = seeded();
        let views = build_views(&env.devices, &env.network, &sample.devices).unwrap();
        assert_eq!(views.len(), 4);
        assert_eq!(env.peers.by_devices_calls(), 1);
        assert_eq!(env.peers.list_calls(), 0);
        assert_eq!(env.peers.by_device_calls(), 0);
        assert_eq!(env.interfaces.list_calls(), 1);
        assert_eq!(env.interfaces.by_group_calls(), 0);
        assert_eq!(env.pools.list_calls(), 1);
        assert_eq!(env.pools.by_group_calls(), 0);
    }

    #[test]
    fn empty_device_list_skips_repository_reads() {
        let (env, _sample) = seeded();
        let views = build_views(&env.devices, &env.network, &[]).unwrap();
        assert!(views.is_empty());
        assert_eq!(env.peers.by_devices_calls(), 0);
        assert_eq!(env.interfaces.list_calls(), 0);
        assert_eq!(env.pools.list_calls(), 0);
    }
}
