use std::collections::BTreeMap;
use std::net::IpAddr;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use awg_network::NewInterface;
use awg_shared::cidr::parse_net;
use awg_shared::conf::{parse_client_conf, parse_server_conf};
use awg_shared::crypto::public_from_private;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{ImportClient, ImportRequest};
use crate::state::AppState;

#[derive(serde::Serialize)]
pub struct ImportReport {
    pub group_id: uuid::Uuid,
    pub interface_id: uuid::Uuid,
    pub imported_devices: usize,
    pub failed_devices: Vec<ImportFailure>,
}

#[derive(serde::Serialize)]
pub struct ImportFailure {
    pub name: String,
    pub error: String,
}

pub async fn run(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<ImportRequest>,
) -> ApiResult<Json<ImportReport>> {
    user.require_admin()?;

    let server = parse_server_conf(&request.server_config).map_err(ApiError::from)?;
    let server_public = public_from_private(&server.private_key).map_err(ApiError::from)?;

    let owner_id = request.owner_user_id.unwrap_or(user.id());
    state.identity.find(owner_id).map_err(ApiError::from)?;

    let group = state
        .network
        .create_group(
            &request.group_name,
            &request.group_description,
            &request.base_cidr,
            false,
        )
        .map_err(ApiError::from)?;

    for pool in &request.pools {
        state
            .network
            .add_pool(
                group.id,
                awg_network::NewPool {
                    name: pool.name.clone(),
                    cidr: pool.cidr.clone(),
                    mode: pool.mode,
                    gateway: pool.gateway.clone(),
                },
            )
            .map_err(ApiError::from)?;
    }

    let interface = state
        .network
        .import_interface(
            group.id,
            request.node_id,
            NewInterface {
                name: request.interface.name.clone(),
                label: request.group_name.clone(),
                endpoint_host: request.interface.endpoint_host.clone(),
                endpoint_port: request.interface.endpoint_port,
                listen_port: request.interface.listen_port,
                mtu: request.interface.mtu,
            },
            &server.private_key,
            &server_public,
            server.obf.clone(),
        )
        .map_err(ApiError::from)?;

    let pools = state.network.list_pools(group.id).map_err(ApiError::from)?;
    let parsed_pools: Vec<(uuid::Uuid, ipnet::Ipv4Net)> = pools
        .iter()
        .filter(|p| p.enabled)
        .filter_map(|p| parse_net(&p.cidr).ok().map(|net| (p.id, net)))
        .collect();

    let mut imported = 0usize;
    let mut failures = Vec::new();
    for client in &request.clients {
        match import_client(
            &state,
            owner_id,
            group.id,
            interface.id,
            &interface.public_key,
            client,
            &parsed_pools,
        ) {
            Ok(()) => imported += 1,
            Err(error) => failures.push(ImportFailure {
                name: client.name.clone(),
                error: error.to_string(),
            }),
        }
    }

    let _ = state.orchestration.publish(request.node_id);

    Ok(Json(ImportReport {
        group_id: group.id,
        interface_id: interface.id,
        imported_devices: imported,
        failed_devices: failures,
    }))
}

fn import_client(
    state: &AppState,
    owner_id: uuid::Uuid,
    group_id: uuid::Uuid,
    interface_id: uuid::Uuid,
    server_public: &str,
    client: &ImportClient,
    pools: &[(uuid::Uuid, ipnet::Ipv4Net)],
) -> Result<(), awg_shared::CoreError> {
    let parsed = parse_client_conf(&client.config)?;
    if parsed.server_public_key != server_public {
        return Err(awg_shared::CoreError::Conflict(
            "client config points at a different server public key".into(),
        ));
    }
    let public_key = public_from_private(&parsed.private_key)?;
    let mut ips: BTreeMap<uuid::Uuid, IpAddr> = BTreeMap::new();
    for address in &parsed.addresses {
        let net = parse_net(address)?;
        let ip = net.addr();
        if let Some((pool_id, _)) = pools.iter().find(|(_, pool)| pool.contains(&ip)) {
            ips.insert(*pool_id, IpAddr::V4(ip));
        }
    }
    if ips.is_empty() {
        return Err(awg_shared::CoreError::Invalid(
            "client address does not belong to any configured pool".into(),
        ));
    }
    let psk = parsed.preshared_key.clone().unwrap_or_default();
    state.devices.import_device(
        owner_id,
        group_id,
        &client.name,
        interface_id,
        &parsed.private_key,
        &public_key,
        &psk,
        ips,
        parsed.client,
    )?;
    Ok(())
}
