use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use ipnet::Ipv4Net;
use uuid::Uuid;

use awg_clients::DeviceService;
use awg_network::domain::validate_interface_name;
use awg_network::{NetworkService, NewInterface, NewPool, PoolMode};
use awg_shared::CoreError;
use awg_shared::cidr::{parse_net, validate_pool};
use awg_shared::conf::{parse_client_conf, parse_server_conf};
use awg_shared::crypto::public_from_private;
use awg_shared::obf::{ClientObf, InterfaceObf};

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::{
    BatchImportRequest, ClientsImportRequest, ImportClient, ImportInterfaceRequest, ImportRequest,
};
use crate::state::AppState;
use crate::views::{
    ClientsImportApplyView, ClientsImportCreatedInterfaceView, ClientsImportCreatedView,
    ClientsImportInterfaceView, ClientsImportPreviewView, ImportApplyView, ImportClientStatus,
    ImportClientView, ImportCountsView, ImportCreatedInterfaceView, ImportCreatedView,
    ImportGroupView, ImportInterfacePlanView, ImportPreviewView, ImportSummaryView,
};

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

pub async fn preview(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BatchImportRequest>,
) -> ApiResult<Json<ImportPreviewView>> {
    user.require_admin()?;
    let owner_id = resolve_owner(&state, &user, request.owner_user_id)?;
    let plan = plan_import(&state.network, &state.devices, &request, owner_id)?;
    Ok(Json(plan.view()))
}

pub async fn apply(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<BatchImportRequest>,
) -> ApiResult<Json<ImportApplyView>> {
    user.require_admin()?;
    let owner_id = resolve_owner(&state, &user, request.owner_user_id)?;
    let (plan, created) = apply_import(&state.network, &state.devices, &request, owner_id)?;
    let _ = state.orchestration.publish(request.node_id);
    Ok(Json(ImportApplyView {
        preview: plan.view(),
        created: created.view(),
    }))
}

fn resolve_owner(state: &AppState, user: &AuthUser, requested: Option<Uuid>) -> ApiResult<Uuid> {
    let owner_id = requested.unwrap_or_else(|| user.id());
    state.identity.find(owner_id).map_err(ApiError::from)?;
    Ok(owner_id)
}

pub async fn clients_preview(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<ClientsImportRequest>,
) -> ApiResult<Json<ClientsImportPreviewView>> {
    user.require_admin()?;
    resolve_owner(&state, &user, request.owner_user_id)?;
    let plan = plan_clients_import(&state.network, &state.devices, &request)?;
    Ok(Json(plan.view()))
}

pub async fn clients_apply(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<ClientsImportRequest>,
) -> ApiResult<Json<ClientsImportApplyView>> {
    user.require_admin()?;
    let owner_id = resolve_owner(&state, &user, request.owner_user_id)?;
    let (plan, created) = apply_clients_import(&state.network, &state.devices, &request, owner_id)?;
    let mut nodes: HashSet<Uuid> = HashSet::new();
    for interface in &created.interfaces {
        if !interface.device_ids.is_empty() {
            nodes.insert(interface.node_id);
        }
    }
    for node_id in nodes {
        let _ = state.orchestration.publish(node_id);
    }
    Ok(Json(ClientsImportApplyView {
        preview: plan.view(),
        created: created.view(),
    }))
}

#[derive(Debug, Clone, Copy, Default)]
struct ImportCounts {
    create: usize,
    duplicate: usize,
    error: usize,
}

impl ImportCounts {
    fn add(&mut self, other: ImportCounts) {
        self.create += other.create;
        self.duplicate += other.duplicate;
        self.error += other.error;
    }

    fn view(self) -> ImportCountsView {
        ImportCountsView {
            create: self.create,
            duplicate: self.duplicate,
            error: self.error,
        }
    }
}

#[derive(Debug, Clone)]
struct PlannedPool {
    name: String,
    cidr: Ipv4Net,
    mode: PoolMode,
    gateway: Option<String>,
}

#[derive(Debug, Clone)]
struct ClientSecret {
    private_key: String,
    public_key: String,
    preshared_key: String,
    client_obf: ClientObf,
    addresses: Vec<(Ipv4Net, Ipv4Addr)>,
}

#[derive(Debug, Clone)]
struct ImportClientPlan {
    name: String,
    status: ImportClientStatus,
    address: Option<String>,
    reason: Option<String>,
    secret: Option<ClientSecret>,
}

#[derive(Debug, Clone)]
struct InterfacePlan {
    index: usize,
    name: String,
    label: String,
    endpoint_host: String,
    endpoint_port: u16,
    listen_port: u16,
    mtu: u16,
    private_key: String,
    public_key: String,
    obf: InterfaceObf,
    pools: Vec<PlannedPool>,
    clients: Vec<ImportClientPlan>,
    counts: ImportCounts,
}

#[derive(Debug, Clone)]
struct ImportPlan {
    group_name: String,
    group_description: String,
    base_cidr: String,
    owner_id: Uuid,
    node_id: Uuid,
    interfaces: Vec<InterfacePlan>,
    counts: ImportCounts,
    warnings: Vec<String>,
}

impl ImportPlan {
    fn view(&self) -> ImportPreviewView {
        ImportPreviewView {
            group: ImportGroupView {
                name: self.group_name.clone(),
                base_cidr: self.base_cidr.clone(),
            },
            interfaces: self
                .interfaces
                .iter()
                .map(|interface| ImportInterfacePlanView {
                    index: interface.index,
                    name: interface.name.clone(),
                    public_key: interface.public_key.clone(),
                    clients: interface
                        .clients
                        .iter()
                        .map(|client| ImportClientView {
                            name: client.name.clone(),
                            status: client.status,
                            address: client.address.clone(),
                            reason: client.reason.clone(),
                        })
                        .collect(),
                    counts: interface.counts.view(),
                })
                .collect(),
            summary: ImportSummaryView {
                create: self.counts.create,
                duplicate: self.counts.duplicate,
                error: self.counts.error,
                interfaces: self.interfaces.len(),
            },
            warnings: self.warnings.clone(),
        }
    }
}

#[derive(Debug)]
struct CreatedInterface {
    id: Uuid,
    name: String,
    device_ids: Vec<Uuid>,
}

#[derive(Debug)]
struct CreatedImport {
    group_id: Uuid,
    interfaces: Vec<CreatedInterface>,
}

impl CreatedImport {
    fn view(&self) -> ImportCreatedView {
        ImportCreatedView {
            group_id: self.group_id,
            interfaces: self
                .interfaces
                .iter()
                .map(|interface| ImportCreatedInterfaceView {
                    id: interface.id,
                    name: interface.name.clone(),
                    device_ids: interface.device_ids.clone(),
                })
                .collect(),
        }
    }
}

fn plan_import(
    network: &NetworkService,
    devices: &DeviceService,
    request: &BatchImportRequest,
    owner_id: Uuid,
) -> ApiResult<ImportPlan> {
    network.get_node(request.node_id).map_err(ApiError::from)?;

    let group_name = request.group_name.trim();
    if group_name.is_empty() {
        return Err(ApiError::BadRequest("group name is required".into()));
    }
    let base = parse_net(&request.base_cidr).map_err(ApiError::from)?;
    if request.interfaces.is_empty() {
        return Err(ApiError::BadRequest(
            "at least one interface is required".into(),
        ));
    }

    let mut warnings = Vec::new();
    if network
        .list_groups()
        .map_err(ApiError::from)?
        .iter()
        .any(|group| group.name == group_name)
    {
        warnings.push(format!("a group named {group_name} already exists"));
    }

    let node_interfaces = network
        .interfaces_by_node(request.node_id)
        .map_err(ApiError::from)?;
    let existing_peers = devices.all_peers().map_err(ApiError::from)?;
    let existing_keys: HashSet<String> = existing_peers
        .iter()
        .map(|peer| peer.public_key.clone())
        .collect();
    let mut used_addresses: HashSet<Ipv4Addr> = existing_peers
        .iter()
        .flat_map(|peer| peer.ips.values())
        .filter_map(|ip| match ip {
            IpAddr::V4(v4) => Some(*v4),
            IpAddr::V6(_) => None,
        })
        .collect();

    let mut interface_names: HashSet<String> = HashSet::new();
    let mut pool_names: HashSet<String> = HashSet::new();
    let mut pool_nets: Vec<(usize, Ipv4Net)> = Vec::new();
    let mut server_keys: Vec<(String, String)> = Vec::new();
    let mut seen_client_keys: HashMap<String, String> = HashMap::new();
    let mut used_client_names: HashSet<String> = HashSet::new();
    let mut interfaces = Vec::new();
    let mut total = ImportCounts::default();

    for (index, input) in request.interfaces.iter().enumerate() {
        let planned = plan_interface(
            input,
            index,
            base,
            &node_interfaces,
            &mut interface_names,
            &mut pool_names,
            &mut pool_nets,
            &mut warnings,
            request,
        )?;

        let mut clients = Vec::new();
        for client in &input.clients {
            let planned_client = plan_client(
                client,
                &planned.public_key,
                &planned.pools,
                &existing_keys,
                &mut seen_client_keys,
                &mut used_addresses,
                &mut used_client_names,
                &input.name,
                &mut warnings,
            );
            clients.push(planned_client);
        }

        let counts = count_clients(&clients);
        total.add(counts);
        server_keys.push((planned.name.clone(), planned.public_key.clone()));
        interfaces.push(InterfacePlan {
            index: planned.index,
            name: planned.name,
            label: planned.label,
            endpoint_host: planned.endpoint_host,
            endpoint_port: planned.endpoint_port,
            listen_port: planned.listen_port,
            mtu: planned.mtu,
            private_key: planned.private_key,
            public_key: planned.public_key,
            obf: planned.obf,
            pools: planned.pools,
            clients,
            counts,
        });
    }

    let mut seen_server_keys: HashMap<&str, &str> = HashMap::new();
    for (name, key) in &server_keys {
        if seen_server_keys
            .insert(key.as_str(), name.as_str())
            .is_some()
        {
            warnings.push(format!(
                "interface {name} shares its server public key with another interface in the batch"
            ));
        }
    }

    Ok(ImportPlan {
        group_name: group_name.to_string(),
        group_description: request.group_description.clone(),
        base_cidr: format!("{}/{}", base.network(), base.prefix_len()),
        owner_id,
        node_id: request.node_id,
        interfaces,
        counts: total,
        warnings,
    })
}

struct PlannedInterfaceMeta {
    index: usize,
    name: String,
    label: String,
    endpoint_host: String,
    endpoint_port: u16,
    listen_port: u16,
    mtu: u16,
    private_key: String,
    public_key: String,
    obf: InterfaceObf,
    pools: Vec<PlannedPool>,
}

#[allow(clippy::too_many_arguments)]
fn plan_interface(
    input: &ImportInterfaceRequest,
    index: usize,
    base: Ipv4Net,
    node_interfaces: &[awg_network::Interface],
    interface_names: &mut HashSet<String>,
    pool_names: &mut HashSet<String>,
    pool_nets: &mut Vec<(usize, Ipv4Net)>,
    warnings: &mut Vec<String>,
    request: &BatchImportRequest,
) -> ApiResult<PlannedInterfaceMeta> {
    validate_interface_name(&input.name).map_err(ApiError::from)?;
    if !interface_names.insert(input.name.clone()) {
        return Err(ApiError::BadRequest(format!(
            "duplicate interface name {} in the batch",
            input.name
        )));
    }
    if input.endpoint_host.trim().is_empty() {
        return Err(ApiError::BadRequest(format!(
            "interface {} has an empty endpoint host",
            input.name
        )));
    }
    if input.listen_port == 0 || input.endpoint_port == 0 {
        return Err(ApiError::BadRequest(format!(
            "interface {} has a zero port",
            input.name
        )));
    }

    let server = parse_server_conf(&input.server_config).map_err(ApiError::from)?;
    let public_key = public_from_private(&server.private_key).map_err(ApiError::from)?;

    let mut pools = Vec::new();
    for pool in &input.pools {
        let name = pool.name.trim();
        if name.is_empty() {
            return Err(ApiError::BadRequest(format!(
                "interface {} has a pool without a name",
                input.name
            )));
        }
        if !pool_names.insert(name.to_string()) {
            return Err(ApiError::BadRequest(format!(
                "duplicate pool name {name} in the batch"
            )));
        }
        let net = parse_net(&pool.cidr).map_err(ApiError::from)?;
        validate_pool(base, net).map_err(ApiError::from)?;
        if let Some((other_index, other)) = pool_nets.iter().find(|(_, existing)| {
            existing.contains(&net.network()) || net.contains(&existing.network())
        }) {
            return Err(ApiError::BadRequest(format!(
                "pool {net} in interface {} overlaps with pool {other} in interface {}",
                input.name, request.interfaces[*other_index].name
            )));
        }
        pool_nets.push((index, net));
        pools.push(PlannedPool {
            name: name.to_string(),
            cidr: net,
            mode: pool.mode,
            gateway: pool.gateway.clone(),
        });
    }

    if node_interfaces.iter().any(|i| i.name == input.name) {
        warnings.push(format!(
            "interface {} already exists on the node; apply will fail and roll back",
            input.name
        ));
    }

    Ok(PlannedInterfaceMeta {
        index,
        name: input.name.clone(),
        label: input.label.clone(),
        endpoint_host: input.endpoint_host.trim().to_string(),
        endpoint_port: input.endpoint_port,
        listen_port: input.listen_port,
        mtu: input.mtu,
        private_key: server.private_key,
        public_key,
        obf: server.obf,
        pools,
    })
}

#[allow(clippy::too_many_arguments)]
fn plan_client(
    client: &ImportClient,
    server_public: &str,
    pools: &[PlannedPool],
    existing_keys: &HashSet<String>,
    seen_client_keys: &mut HashMap<String, String>,
    used_addresses: &mut HashSet<Ipv4Addr>,
    used_client_names: &mut HashSet<String>,
    interface_name: &str,
    warnings: &mut Vec<String>,
) -> ImportClientPlan {
    let raw_name = client.name.trim();
    let mut plan = ImportClientPlan {
        name: raw_name.to_string(),
        status: ImportClientStatus::Error,
        address: None,
        reason: None,
        secret: None,
    };

    if raw_name.is_empty() {
        plan.reason = Some("client name is required".into());
        return plan;
    }
    if raw_name.len() > 64 {
        plan.reason = Some("client name must be 1..64 characters".into());
        return plan;
    }

    let parsed = match parse_client_conf(&client.config) {
        Ok(parsed) => parsed,
        Err(error) => {
            plan.reason = Some(error.to_string());
            return plan;
        }
    };
    if parsed.server_public_key != server_public {
        plan.reason = Some("client config points at a different server public key".into());
        return plan;
    }
    let public_key = match public_from_private(&parsed.private_key) {
        Ok(public_key) => public_key,
        Err(error) => {
            plan.reason = Some(error.to_string());
            return plan;
        }
    };

    if let Some(owner) = seen_client_keys.get(&public_key) {
        plan.status = ImportClientStatus::Duplicate;
        plan.reason = Some(format!(
            "client public key already imported in interface {owner}"
        ));
        return plan;
    }
    if existing_keys.contains(&public_key) {
        plan.status = ImportClientStatus::Duplicate;
        plan.reason = Some("client public key already exists".into());
        return plan;
    }

    let mut matched: Vec<(Ipv4Net, Ipv4Addr)> = Vec::new();
    let mut matched_pools: HashSet<Ipv4Net> = HashSet::new();
    let mut outside = Vec::new();
    for raw in &parsed.addresses {
        let Ok(net) = parse_net(raw) else {
            outside.push(raw.clone());
            continue;
        };
        let ip = net.addr();
        match pools.iter().find(|pool| pool.cidr.contains(&ip)) {
            Some(pool) => {
                if matched_pools.insert(pool.cidr) {
                    matched.push((pool.cidr, ip));
                }
            }
            None => outside.push(raw.clone()),
        }
    }
    if matched.is_empty() {
        plan.reason = Some(if parsed.addresses.is_empty() {
            "client config has no Address".into()
        } else {
            format!(
                "client address does not belong to any configured pool: {}",
                outside.join(", ")
            )
        });
        return plan;
    }
    if let Some((_, ip)) = matched.iter().find(|(_, ip)| used_addresses.contains(ip)) {
        plan.reason = Some(format!("address {ip} is already in use"));
        return plan;
    }

    let name = unique_client_name(raw_name, used_client_names);
    if name != raw_name {
        warnings.push(format!(
            "client {raw_name} in interface {interface_name} renamed to {name}"
        ));
    }
    for (_, ip) in &matched {
        used_addresses.insert(*ip);
    }
    seen_client_keys.insert(public_key.clone(), interface_name.to_string());

    plan.name = name;
    plan.status = ImportClientStatus::Create;
    plan.address = matched.first().map(|(_, ip)| ip.to_string());
    plan.secret = Some(ClientSecret {
        private_key: parsed.private_key,
        public_key,
        preshared_key: parsed.preshared_key.unwrap_or_default(),
        client_obf: parsed.client,
        addresses: matched,
    });
    plan
}

fn unique_client_name(base: &str, used: &mut HashSet<String>) -> String {
    if used.insert(base.to_lowercase()) {
        return base.to_string();
    }
    let stem: String = base.chars().take(60).collect();
    let mut suffix = 2;
    loop {
        let candidate = format!("{stem}-{suffix}");
        if used.insert(candidate.to_lowercase()) {
            return candidate;
        }
        suffix += 1;
    }
}

fn count_clients(clients: &[ImportClientPlan]) -> ImportCounts {
    let mut counts = ImportCounts::default();
    for client in clients {
        match client.status {
            ImportClientStatus::Create => counts.create += 1,
            ImportClientStatus::Duplicate => counts.duplicate += 1,
            ImportClientStatus::Error => counts.error += 1,
        }
    }
    counts
}

fn apply_import(
    network: &NetworkService,
    devices: &DeviceService,
    request: &BatchImportRequest,
    owner_id: Uuid,
) -> ApiResult<(ImportPlan, CreatedImport)> {
    let mut plan = plan_import(network, devices, request, owner_id)?;

    let group = match network.create_group(
        &plan.group_name,
        &plan.group_description,
        &plan.base_cidr,
        false,
    ) {
        Ok(group) => group,
        Err(error) => {
            return Err(ApiError::Conflict(format!(
                "import failed before any entity was persisted: {error}"
            )));
        }
    };

    let mut created = CreatedImport {
        group_id: group.id,
        interfaces: Vec::new(),
    };

    if let Err(error) = create_interfaces(network, devices, &mut plan, &mut created) {
        let rollback_errors = rollback(network, devices, &created);
        return Err(rollback_error(error, &rollback_errors));
    }

    Ok((plan, created))
}

fn create_interfaces(
    network: &NetworkService,
    devices: &DeviceService,
    plan: &mut ImportPlan,
    created: &mut CreatedImport,
) -> Result<(), CoreError> {
    let group_id = created.group_id;
    for interface in &mut plan.interfaces {
        let mut pool_ids: Vec<(Ipv4Net, Uuid)> = Vec::new();
        for pool in &interface.pools {
            let stored = network.add_pool(
                group_id,
                NewPool {
                    name: pool.name.clone(),
                    cidr: format!("{}/{}", pool.cidr.network(), pool.cidr.prefix_len()),
                    mode: pool.mode,
                    gateway: pool.gateway.clone(),
                },
            )?;
            pool_ids.push((pool.cidr, stored.id));
        }

        let stored = network.import_interface(
            group_id,
            plan.node_id,
            NewInterface {
                name: interface.name.clone(),
                label: interface.label.clone(),
                endpoint_host: interface.endpoint_host.clone(),
                endpoint_port: interface.endpoint_port,
                listen_port: interface.listen_port,
                mtu: interface.mtu,
            },
            &interface.private_key,
            &interface.public_key,
            interface.obf.clone(),
        )?;

        let mut device_ids = Vec::new();
        for client in &mut interface.clients {
            if client.status != ImportClientStatus::Create {
                continue;
            }
            let Some(secret) = client.secret.take() else {
                continue;
            };
            let ips: BTreeMap<Uuid, IpAddr> = secret
                .addresses
                .iter()
                .filter_map(|(cidr, ip)| {
                    pool_ids
                        .iter()
                        .find(|(pool_cidr, _)| pool_cidr == cidr)
                        .map(|(_, id)| (*id, IpAddr::V4(*ip)))
                })
                .collect();
            match devices.import_device(
                plan.owner_id,
                group_id,
                &client.name,
                stored.id,
                &secret.private_key,
                &secret.public_key,
                &secret.preshared_key,
                ips,
                secret.client_obf,
            ) {
                Ok(device) => device_ids.push(device.id),
                Err(error @ (CoreError::Io(_) | CoreError::NotFound(_))) => return Err(error),
                Err(error) => {
                    client.status = ImportClientStatus::Error;
                    client.reason = Some(error.to_string());
                }
            }
        }
        interface.counts = count_clients(&interface.clients);

        created.interfaces.push(CreatedInterface {
            id: stored.id,
            name: interface.name.clone(),
            device_ids,
        });
    }

    plan.counts = ImportCounts::default();
    for interface in &plan.interfaces {
        plan.counts.add(interface.counts);
    }
    Ok(())
}

fn rollback(
    network: &NetworkService,
    devices: &DeviceService,
    created: &CreatedImport,
) -> Vec<String> {
    let mut errors = Vec::new();

    for interface in created.interfaces.iter().rev() {
        for device_id in interface.device_ids.iter().rev() {
            if let Err(error) = devices.delete(*device_id) {
                errors.push(format!("failed to delete device {device_id}: {error}"));
            }
        }
    }

    match devices.list_all() {
        Ok(list) => {
            for device in list.iter().filter(|d| d.group_id == created.group_id) {
                if let Err(error) = devices.delete(device.id) {
                    errors.push(format!("failed to delete device {}: {error}", device.id));
                }
            }
        }
        Err(error) => errors.push(format!("failed to list devices during rollback: {error}")),
    }

    for interface in created.interfaces.iter().rev() {
        if let Err(error) = network.delete_interface(interface.id) {
            errors.push(format!(
                "failed to delete interface {}: {error}",
                interface.id
            ));
        }
    }

    if let Err(error) = network.delete_group(created.group_id) {
        errors.push(format!(
            "failed to delete group {}: {error}",
            created.group_id
        ));
    }

    errors
}

fn rollback_error(error: CoreError, rollback_errors: &[String]) -> ApiError {
    if rollback_errors.is_empty() {
        ApiError::Conflict(format!(
            "import failed: {error}; all created entities were rolled back"
        ))
    } else {
        ApiError::Conflict(format!(
            "import failed: {error}; rollback was attempted but incomplete: {}",
            rollback_errors.join("; ")
        ))
    }
}

#[derive(Debug)]
struct ExistingClientSecret {
    private_key: String,
    public_key: String,
    preshared_key: String,
    client_obf: ClientObf,
    ips: BTreeMap<Uuid, IpAddr>,
}

#[derive(Debug)]
struct ExistingClientPlan {
    name: String,
    status: ImportClientStatus,
    address: Option<String>,
    reason: Option<String>,
    secret: Option<ExistingClientSecret>,
}

#[derive(Debug)]
struct ClientsInterfacePlan {
    id: Uuid,
    name: String,
    group_id: Uuid,
    group_name: String,
    node_id: Uuid,
    public_key: String,
    pools: Vec<(Uuid, Ipv4Net)>,
    clients: Vec<ExistingClientPlan>,
    counts: ImportCounts,
}

impl ClientsInterfacePlan {
    fn view(&self) -> ClientsImportInterfaceView {
        ClientsImportInterfaceView {
            id: self.id,
            name: self.name.clone(),
            group_id: self.group_id,
            group_name: self.group_name.clone(),
            node_id: self.node_id,
            public_key: self.public_key.clone(),
            clients: self
                .clients
                .iter()
                .map(|client| ImportClientView {
                    name: client.name.clone(),
                    status: client.status,
                    address: client.address.clone(),
                    reason: client.reason.clone(),
                })
                .collect(),
            counts: self.counts.view(),
        }
    }
}

#[derive(Debug)]
struct ClientsImportPlan {
    interfaces: Vec<ClientsInterfacePlan>,
    counts: ImportCounts,
    warnings: Vec<String>,
}

impl ClientsImportPlan {
    fn view(&self) -> ClientsImportPreviewView {
        ClientsImportPreviewView {
            interfaces: self.interfaces.iter().map(|i| i.view()).collect(),
            summary: ImportSummaryView {
                create: self.counts.create,
                duplicate: self.counts.duplicate,
                error: self.counts.error,
                interfaces: self.interfaces.len(),
            },
            warnings: self.warnings.clone(),
        }
    }
}

#[derive(Debug, Default)]
struct ClientsCreated {
    interfaces: Vec<ClientsCreatedInterface>,
}

#[derive(Debug)]
struct ClientsCreatedInterface {
    id: Uuid,
    node_id: Uuid,
    device_ids: Vec<Uuid>,
}

impl ClientsCreated {
    fn view(&self) -> ClientsImportCreatedView {
        ClientsImportCreatedView {
            interfaces: self
                .interfaces
                .iter()
                .map(|interface| ClientsImportCreatedInterfaceView {
                    id: interface.id,
                    device_ids: interface.device_ids.clone(),
                })
                .collect(),
        }
    }
}

struct ClientsPlanContext<'a> {
    network: &'a NetworkService,
    existing_keys: HashSet<String>,
    used_addresses: HashSet<Ipv4Addr>,
    seen_client_keys: HashMap<String, String>,
    used_names: HashMap<Uuid, HashSet<String>>,
    group_cache: HashMap<Uuid, (String, Vec<(Uuid, Ipv4Net)>)>,
    warnings: Vec<String>,
}

impl ClientsPlanContext<'_> {
    fn interface_plan(
        &mut self,
        interface: &awg_network::Interface,
    ) -> ApiResult<ClientsInterfacePlan> {
        let (group_name, pools) = self.group_info(interface.group_id)?;
        Ok(ClientsInterfacePlan {
            id: interface.id,
            name: interface.name.clone(),
            group_id: interface.group_id,
            group_name,
            node_id: interface.node_id,
            public_key: interface.public_key.clone(),
            pools,
            clients: Vec::new(),
            counts: ImportCounts::default(),
        })
    }

    fn group_info(&mut self, group_id: Uuid) -> ApiResult<(String, Vec<(Uuid, Ipv4Net)>)> {
        if let Some(cached) = self.group_cache.get(&group_id) {
            return Ok(cached.clone());
        }
        let group = self.network.get_group(group_id).map_err(ApiError::from)?;
        let pools = self
            .network
            .list_pools(group_id)
            .map_err(ApiError::from)?
            .into_iter()
            .filter(|pool| pool.enabled)
            .filter_map(|pool| parse_net(&pool.cidr).ok().map(|net| (pool.id, net)))
            .collect();
        let value = (group.name, pools);
        self.group_cache.insert(group_id, value.clone());
        Ok(value)
    }
}

fn plan_clients_import(
    network: &NetworkService,
    devices: &DeviceService,
    request: &ClientsImportRequest,
) -> ApiResult<ClientsImportPlan> {
    if request.clients.is_empty() {
        return Err(ApiError::BadRequest(
            "at least one client config is required".into(),
        ));
    }

    let existing_peers = devices.all_peers().map_err(ApiError::from)?;
    let mut ctx = ClientsPlanContext {
        network,
        existing_keys: existing_peers
            .iter()
            .map(|peer| peer.public_key.clone())
            .collect(),
        used_addresses: existing_peers
            .iter()
            .flat_map(|peer| peer.ips.values())
            .filter_map(|ip| match ip {
                IpAddr::V4(v4) => Some(*v4),
                IpAddr::V6(_) => None,
            })
            .collect(),
        seen_client_keys: HashMap::new(),
        used_names: HashMap::new(),
        group_cache: HashMap::new(),
        warnings: Vec::new(),
    };

    let mut interfaces = Vec::new();
    if let Some(interface_id) = request.interface_id {
        let interface = network
            .get_interface(interface_id)
            .map_err(ApiError::from)?;
        let mut plan = ctx.interface_plan(&interface)?;
        for client in &request.clients {
            let planned = plan_existing_client(
                client,
                plan.id,
                &plan.name,
                &plan.public_key,
                &plan.pools,
                &mut ctx,
            );
            plan.clients.push(planned);
        }
        interfaces.push(plan);
    } else {
        let available = network.list_interfaces().map_err(ApiError::from)?;
        let mut by_key: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, interface) in available.iter().enumerate() {
            by_key
                .entry(interface.public_key.clone())
                .or_default()
                .push(index);
        }

        let mut matched: Vec<ClientsInterfacePlan> = Vec::new();
        let mut positions: HashMap<Uuid, usize> = HashMap::new();
        let mut unresolved: Vec<ClientsInterfacePlan> = Vec::new();

        for client in &request.clients {
            let parsed = match parse_client_conf(&client.config) {
                Ok(parsed) => parsed,
                Err(error) => {
                    push_unresolved(&mut unresolved, "", client, error.to_string());
                    continue;
                }
            };
            let Some(matches) = by_key.get(&parsed.server_public_key) else {
                push_unresolved(
                    &mut unresolved,
                    &parsed.server_public_key,
                    client,
                    "no interface with this public key was found".into(),
                );
                continue;
            };
            if matches.len() > 1 {
                push_unresolved(
                    &mut unresolved,
                    &parsed.server_public_key,
                    client,
                    "ambiguous public key".into(),
                );
                continue;
            }
            let interface = &available[matches[0]];
            let position = match positions.get(&interface.id) {
                Some(position) => *position,
                None => {
                    let plan = ctx.interface_plan(interface)?;
                    matched.push(plan);
                    let position = matched.len() - 1;
                    positions.insert(interface.id, position);
                    position
                }
            };
            let (id, name, public_key, pools) = {
                let plan = &matched[position];
                (
                    plan.id,
                    plan.name.clone(),
                    plan.public_key.clone(),
                    plan.pools.clone(),
                )
            };
            let planned = plan_existing_client(client, id, &name, &public_key, &pools, &mut ctx);
            matched[position].clients.push(planned);
        }

        matched.extend(unresolved);
        interfaces = matched;
    }

    let mut counts = ImportCounts::default();
    for interface in &mut interfaces {
        interface.counts = count_existing_clients(&interface.clients);
        counts.add(interface.counts);
    }

    Ok(ClientsImportPlan {
        interfaces,
        counts,
        warnings: ctx.warnings,
    })
}

fn push_unresolved(
    buckets: &mut Vec<ClientsInterfacePlan>,
    public_key: &str,
    client: &ImportClient,
    reason: String,
) {
    let position = match buckets.iter().position(|b| b.public_key == public_key) {
        Some(position) => position,
        None => {
            buckets.push(ClientsInterfacePlan {
                id: Uuid::nil(),
                name: String::new(),
                group_id: Uuid::nil(),
                group_name: String::new(),
                node_id: Uuid::nil(),
                public_key: public_key.to_string(),
                pools: Vec::new(),
                clients: Vec::new(),
                counts: ImportCounts::default(),
            });
            buckets.len() - 1
        }
    };
    buckets[position].clients.push(ExistingClientPlan {
        name: client.name.trim().to_string(),
        status: ImportClientStatus::Error,
        address: None,
        reason: Some(reason),
        secret: None,
    });
}

fn plan_existing_client(
    client: &ImportClient,
    interface_id: Uuid,
    interface_name: &str,
    interface_public: &str,
    pools: &[(Uuid, Ipv4Net)],
    ctx: &mut ClientsPlanContext<'_>,
) -> ExistingClientPlan {
    let raw_name = client.name.trim();
    let mut plan = ExistingClientPlan {
        name: raw_name.to_string(),
        status: ImportClientStatus::Error,
        address: None,
        reason: None,
        secret: None,
    };

    if raw_name.is_empty() {
        plan.reason = Some("client name is required".into());
        return plan;
    }
    if raw_name.len() > 64 {
        plan.reason = Some("client name must be 1..64 characters".into());
        return plan;
    }

    let parsed = match parse_client_conf(&client.config) {
        Ok(parsed) => parsed,
        Err(error) => {
            plan.reason = Some(error.to_string());
            return plan;
        }
    };
    if parsed.server_public_key != interface_public {
        plan.reason = Some("client config points at a different server public key".into());
        return plan;
    }
    let public_key = match public_from_private(&parsed.private_key) {
        Ok(public_key) => public_key,
        Err(error) => {
            plan.reason = Some(error.to_string());
            return plan;
        }
    };

    if let Some(owner) = ctx.seen_client_keys.get(&public_key) {
        plan.status = ImportClientStatus::Duplicate;
        plan.reason = Some(format!(
            "client public key already imported in interface {owner}"
        ));
        return plan;
    }
    if ctx.existing_keys.contains(&public_key) {
        plan.status = ImportClientStatus::Duplicate;
        plan.reason = Some("client public key already exists".into());
        return plan;
    }

    let mut matched: Vec<(Uuid, Ipv4Addr)> = Vec::new();
    let mut matched_pools: HashSet<Uuid> = HashSet::new();
    let mut outside = Vec::new();
    for raw in &parsed.addresses {
        let Ok(net) = parse_net(raw) else {
            outside.push(raw.clone());
            continue;
        };
        let ip = net.addr();
        match pools.iter().find(|(_, net)| net.contains(&ip)) {
            Some((pool_id, _)) => {
                if matched_pools.insert(*pool_id) {
                    matched.push((*pool_id, ip));
                }
            }
            None => outside.push(raw.clone()),
        }
    }
    if matched.is_empty() {
        plan.reason = Some(if parsed.addresses.is_empty() {
            "client config has no Address".into()
        } else {
            format!(
                "client address does not belong to any configured pool: {}",
                outside.join(", ")
            )
        });
        return plan;
    }
    if let Some((_, ip)) = matched
        .iter()
        .find(|(_, ip)| ctx.used_addresses.contains(ip))
    {
        plan.reason = Some(format!("address {ip} is already in use"));
        return plan;
    }

    let used_names = ctx.used_names.entry(interface_id).or_default();
    let name = unique_client_name(raw_name, used_names);
    if name != raw_name {
        ctx.warnings.push(format!(
            "client {raw_name} in interface {interface_name} renamed to {name}"
        ));
    }
    for (_, ip) in &matched {
        ctx.used_addresses.insert(*ip);
    }
    ctx.seen_client_keys
        .insert(public_key.clone(), interface_name.to_string());

    plan.name = name;
    plan.status = ImportClientStatus::Create;
    plan.address = matched.first().map(|(_, ip)| ip.to_string());
    plan.secret = Some(ExistingClientSecret {
        private_key: parsed.private_key,
        public_key,
        preshared_key: parsed.preshared_key.unwrap_or_default(),
        client_obf: parsed.client,
        ips: matched
            .iter()
            .map(|(pool_id, ip)| (*pool_id, IpAddr::V4(*ip)))
            .collect(),
    });
    plan
}

fn count_existing_clients(clients: &[ExistingClientPlan]) -> ImportCounts {
    let mut counts = ImportCounts::default();
    for client in clients {
        match client.status {
            ImportClientStatus::Create => counts.create += 1,
            ImportClientStatus::Duplicate => counts.duplicate += 1,
            ImportClientStatus::Error => counts.error += 1,
        }
    }
    counts
}

fn apply_clients_import(
    network: &NetworkService,
    devices: &DeviceService,
    request: &ClientsImportRequest,
    owner_id: Uuid,
) -> ApiResult<(ClientsImportPlan, ClientsCreated)> {
    let started_at = chrono::Utc::now();
    let existing_devices: HashSet<Uuid> = devices
        .list_all()
        .map_err(ApiError::from)?
        .iter()
        .map(|device| device.id)
        .collect();
    let mut plan = plan_clients_import(network, devices, request)?;
    let group_ids: HashSet<Uuid> = plan
        .interfaces
        .iter()
        .filter(|interface| !interface.id.is_nil())
        .map(|interface| interface.group_id)
        .collect();

    let mut created = ClientsCreated::default();
    let mut fatal: Option<CoreError> = None;

    for interface in &mut plan.interfaces {
        if interface.id.is_nil() {
            continue;
        }
        let mut device_ids = Vec::new();
        for client in &mut interface.clients {
            if client.status != ImportClientStatus::Create {
                continue;
            }
            let Some(secret) = client.secret.take() else {
                continue;
            };
            match devices.import_device(
                owner_id,
                interface.group_id,
                &client.name,
                interface.id,
                &secret.private_key,
                &secret.public_key,
                &secret.preshared_key,
                secret.ips,
                secret.client_obf,
            ) {
                Ok(device) => device_ids.push(device.id),
                Err(error @ (CoreError::Io(_) | CoreError::NotFound(_))) => {
                    fatal = Some(error);
                    break;
                }
                Err(error) => {
                    client.status = ImportClientStatus::Error;
                    client.reason = Some(error.to_string());
                }
            }
        }
        interface.counts = count_existing_clients(&interface.clients);
        created.interfaces.push(ClientsCreatedInterface {
            id: interface.id,
            node_id: interface.node_id,
            device_ids,
        });
        if fatal.is_some() {
            break;
        }
    }

    if let Some(error) = fatal {
        let rollback_errors =
            rollback_clients(devices, &created, &group_ids, &existing_devices, started_at);
        return Err(clients_rollback_error(error, &rollback_errors));
    }

    let mut counts = ImportCounts::default();
    for interface in &plan.interfaces {
        counts.add(interface.counts);
    }
    plan.counts = counts;

    Ok((plan, created))
}

fn rollback_clients(
    devices: &DeviceService,
    created: &ClientsCreated,
    group_ids: &HashSet<Uuid>,
    existing: &HashSet<Uuid>,
    started_at: chrono::DateTime<chrono::Utc>,
) -> Vec<String> {
    let mut errors = Vec::new();
    let mut deleted: HashSet<Uuid> = HashSet::new();

    for interface in created.interfaces.iter().rev() {
        for device_id in interface.device_ids.iter().rev() {
            if !deleted.insert(*device_id) {
                continue;
            }
            if let Err(error) = devices.delete(*device_id) {
                errors.push(format!("failed to delete device {device_id}: {error}"));
            }
        }
    }

    match devices.list_all() {
        Ok(list) => {
            for device in list.iter().filter(|device| {
                group_ids.contains(&device.group_id)
                    && !existing.contains(&device.id)
                    && device.created_at >= started_at
            }) {
                if !deleted.insert(device.id) {
                    continue;
                }
                if let Err(error) = devices.delete(device.id) {
                    errors.push(format!("failed to delete device {}: {error}", device.id));
                }
            }
        }
        Err(error) => errors.push(format!("failed to list devices during rollback: {error}")),
    }

    errors
}

fn clients_rollback_error(error: CoreError, rollback_errors: &[String]) -> ApiError {
    if rollback_errors.is_empty() {
        ApiError::from(error)
    } else {
        ApiError::Internal(format!(
            "client import failed: {error}; rollback was attempted but incomplete: {}",
            rollback_errors.join("; ")
        ))
    }
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use awg_clients::domain::{DevicePeer, DevicePeerRepository};
    use awg_clients::{DeviceService, RedbDevicePeerRepository, RedbDeviceRepository};
    use awg_identity::{AuthPrincipal, Role};
    use awg_network::{
        NetworkService, NewInterface, PoolMode, RedbCidrPoolRepository, RedbGroupRepository,
        RedbInterfaceRepository, RedbNodeRepository,
    };
    use awg_shared::conf::{ClientConfParams, render_client_conf, render_server_conf};
    use awg_shared::crypto::{KeyPair, Sealer, generate_keypair};
    use awg_shared::obf::{ObfuscationSettings, generate_client_obf, generate_interface_obf};
    use awg_storage::Store;
    use awg_tariffs::{RedbTariffRepository, TariffService};
    use base64::Engine;

    use super::*;
    use crate::models::ImportPool;

    struct Harness {
        network: Arc<NetworkService>,
        devices: Arc<DeviceService>,
    }

    fn harness() -> Harness {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let sealer = Arc::new(
            Sealer::from_master_key(&base64::engine::general_purpose::STANDARD.encode([9u8; 32]))
                .unwrap(),
        );
        let network = Arc::new(NetworkService::new(
            Arc::new(RedbGroupRepository::new(store.clone())),
            Arc::new(RedbNodeRepository::new(store.clone())),
            Arc::new(RedbInterfaceRepository::new(store.clone())),
            Arc::new(RedbCidrPoolRepository::new(store.clone())),
            sealer.clone(),
        ));
        let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
            store.clone(),
        ))));
        let devices = Arc::new(DeviceService::new(
            Arc::new(RedbDeviceRepository::new(store.clone())),
            Arc::new(RedbDevicePeerRepository::new(store.clone())),
            network.clone(),
            tariffs,
            sealer,
        ));
        Harness { network, devices }
    }

    fn server_text(keys: &KeyPair) -> String {
        let obf = generate_interface_obf(&ObfuscationSettings::default());
        render_server_conf(&keys.private_key, 51820, 1420, &obf, &[])
    }

    fn client_text(client: &KeyPair, server_public: &str, address: &str) -> String {
        let obf = generate_interface_obf(&ObfuscationSettings::default());
        let client_obf = generate_client_obf(&ObfuscationSettings::default());
        let addresses = vec![address.to_string()];
        let allowed = vec!["0.0.0.0/0".to_string()];
        render_client_conf(ClientConfParams {
            private_key: &client.private_key,
            addresses: &addresses,
            dns: &[],
            mtu: 1420,
            server_public_key: server_public,
            preshared_key: None,
            endpoint: "vpn.example.com:51820",
            allowed_ips: &allowed,
            obf: &obf,
            client: &client_obf,
            persistent_keepalive: 25,
        })
    }

    fn public_of(keys: &KeyPair) -> String {
        public_from_private(&keys.private_key).unwrap()
    }

    fn client(name: &str, keys: &KeyPair, server_public: &str, address: &str) -> ImportClient {
        ImportClient {
            name: name.into(),
            config: client_text(keys, server_public, address),
        }
    }

    fn raw_client(name: &str, config: &str) -> ImportClient {
        ImportClient {
            name: name.into(),
            config: config.into(),
        }
    }

    fn interface(
        name: &str,
        server: &KeyPair,
        pools: &[(&str, &str)],
        clients: Vec<ImportClient>,
    ) -> ImportInterfaceRequest {
        ImportInterfaceRequest {
            server_config: server_text(server),
            name: name.into(),
            label: String::new(),
            endpoint_host: "vpn.example.com".into(),
            endpoint_port: 51820,
            listen_port: 51820,
            mtu: 1420,
            pools: pools
                .iter()
                .map(|(pool_name, cidr)| ImportPool {
                    name: (*pool_name).into(),
                    cidr: (*cidr).into(),
                    mode: PoolMode::Auto,
                    gateway: None,
                })
                .collect(),
            clients,
        }
    }

    fn batch(node_id: Uuid, interfaces: Vec<ImportInterfaceRequest>) -> BatchImportRequest {
        BatchImportRequest {
            node_id,
            group_name: "Imported".into(),
            group_description: String::new(),
            base_cidr: "10.8.0.0/24".into(),
            owner_user_id: None,
            interfaces,
        }
    }

    fn owner() -> Uuid {
        Uuid::new_v4()
    }

    struct Seed {
        group_id: Uuid,
        interface_id: Uuid,
        pool_ids: Vec<Uuid>,
    }

    fn seed(
        h: &Harness,
        node_id: Uuid,
        group_name: &str,
        base_cidr: &str,
        interface_name: &str,
        server: &KeyPair,
        pools: &[(&str, &str)],
    ) -> Seed {
        let group = h
            .network
            .create_group(group_name, "", base_cidr, false)
            .unwrap();
        let mut pool_ids = Vec::new();
        for (name, cidr) in pools {
            let pool = h
                .network
                .add_pool(
                    group.id,
                    NewPool {
                        name: (*name).into(),
                        cidr: (*cidr).into(),
                        mode: PoolMode::Auto,
                        gateway: None,
                    },
                )
                .unwrap();
            pool_ids.push(pool.id);
        }
        let interface = h
            .network
            .import_interface(
                group.id,
                node_id,
                NewInterface {
                    name: interface_name.into(),
                    label: String::new(),
                    endpoint_host: "vpn.example.com".into(),
                    endpoint_port: 51820,
                    listen_port: 51820,
                    mtu: 1420,
                },
                &server.private_key,
                &public_of(server),
                generate_interface_obf(&ObfuscationSettings::default()),
            )
            .unwrap();
        Seed {
            group_id: group.id,
            interface_id: interface.id,
            pool_ids,
        }
    }

    fn add_interface_with_key(
        h: &Harness,
        node_id: Uuid,
        group_id: Uuid,
        name: &str,
        server: &KeyPair,
    ) -> Uuid {
        h.network
            .import_interface(
                group_id,
                node_id,
                NewInterface {
                    name: name.into(),
                    label: String::new(),
                    endpoint_host: "vpn.example.com".into(),
                    endpoint_port: 51820,
                    listen_port: 51820,
                    mtu: 1420,
                },
                &server.private_key,
                &public_of(server),
                generate_interface_obf(&ObfuscationSettings::default()),
            )
            .unwrap()
            .id
    }

    fn clients_request(
        interface_id: Option<Uuid>,
        clients: Vec<ImportClient>,
    ) -> ClientsImportRequest {
        ClientsImportRequest {
            interface_id,
            owner_user_id: None,
            clients,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn seed_device(
        h: &Harness,
        owner_id: Uuid,
        group_id: Uuid,
        interface_id: Uuid,
        name: &str,
        keys: &KeyPair,
        pool_id: Uuid,
        address: Ipv4Addr,
    ) -> Uuid {
        let ips = BTreeMap::from([(pool_id, IpAddr::V4(address))]);
        h.devices
            .import_device(
                owner_id,
                group_id,
                name,
                interface_id,
                &keys.private_key,
                &public_of(keys),
                "",
                ips,
                generate_client_obf(&ObfuscationSettings::default()),
            )
            .unwrap()
            .id
    }

    struct FlakyPeers {
        inner: RedbDevicePeerRepository,
        saves: AtomicUsize,
        fail_after: usize,
    }

    impl DevicePeerRepository for FlakyPeers {
        fn find(
            &self,
            device_id: Uuid,
            interface_id: Uuid,
        ) -> Result<Option<DevicePeer>, CoreError> {
            self.inner.find(device_id, interface_id)
        }

        fn list(&self) -> Result<Vec<DevicePeer>, CoreError> {
            self.inner.list()
        }

        fn by_device(&self, device_id: Uuid) -> Result<Vec<DevicePeer>, CoreError> {
            self.inner.by_device(device_id)
        }

        fn by_interface(&self, interface_id: Uuid) -> Result<Vec<DevicePeer>, CoreError> {
            self.inner.by_interface(interface_id)
        }

        fn save(&self, peer: &DevicePeer) -> Result<(), CoreError> {
            let attempt = self.saves.fetch_add(1, Ordering::SeqCst);
            if attempt >= self.fail_after {
                return Err(CoreError::Io(std::io::Error::other("peer save failed")));
            }
            self.inner.save(peer)
        }

        fn delete_for_device(&self, device_id: Uuid) -> Result<usize, CoreError> {
            self.inner.delete_for_device(device_id)
        }

        fn delete(&self, device_id: Uuid, interface_id: Uuid) -> Result<(), CoreError> {
            self.inner.delete(device_id, interface_id)
        }
    }

    fn flaky_harness(fail_after: usize) -> Harness {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let sealer = Arc::new(
            Sealer::from_master_key(&base64::engine::general_purpose::STANDARD.encode([9u8; 32]))
                .unwrap(),
        );
        let network = Arc::new(NetworkService::new(
            Arc::new(RedbGroupRepository::new(store.clone())),
            Arc::new(RedbNodeRepository::new(store.clone())),
            Arc::new(RedbInterfaceRepository::new(store.clone())),
            Arc::new(RedbCidrPoolRepository::new(store.clone())),
            sealer.clone(),
        ));
        let tariffs = Arc::new(TariffService::new(Arc::new(RedbTariffRepository::new(
            store.clone(),
        ))));
        let peers = Arc::new(FlakyPeers {
            inner: RedbDevicePeerRepository::new(store.clone()),
            saves: AtomicUsize::new(0),
            fail_after,
        });
        let devices = Arc::new(DeviceService::new(
            Arc::new(RedbDeviceRepository::new(store.clone())),
            peers,
            network.clone(),
            tariffs,
            sealer,
        ));
        Harness { network, devices }
    }

    #[test]
    fn preview_does_not_persist_anything() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let phone = generate_keypair();
        let request = batch(
            node.id,
            vec![interface(
                "awg0",
                &server,
                &[("default", "10.8.0.0/25")],
                vec![client("phone", &phone, &public_of(&server), "10.8.0.2/25")],
            )],
        );

        let plan = plan_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(plan.counts.create, 1);
        assert_eq!(plan.counts.duplicate, 0);
        assert_eq!(plan.counts.error, 0);
        assert_eq!(
            plan.interfaces[0].clients[0].status,
            ImportClientStatus::Create
        );
        assert_eq!(
            plan.interfaces[0].clients[0].address.as_deref(),
            Some("10.8.0.2")
        );
        assert!(h.network.list_groups().unwrap().is_empty());
        assert!(h.network.list_interfaces().unwrap().is_empty());
        assert!(h.network.list_all_pools().unwrap().is_empty());
        assert!(h.devices.list_all().unwrap().is_empty());
    }

    #[test]
    fn builds_multi_interface_plan() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let first = generate_keypair();
        let second = generate_keypair();
        let phone = generate_keypair();
        let laptop = generate_keypair();
        let tablet = generate_keypair();
        let request = batch(
            node.id,
            vec![
                interface(
                    "awg0",
                    &first,
                    &[("pool-a", "10.8.0.0/25")],
                    vec![
                        client("phone", &phone, &public_of(&first), "10.8.0.2/25"),
                        client("laptop", &laptop, &public_of(&first), "10.8.0.3/25"),
                    ],
                ),
                interface(
                    "awg1",
                    &second,
                    &[("pool-b", "10.8.0.128/25")],
                    vec![client(
                        "tablet",
                        &tablet,
                        &public_of(&second),
                        "10.8.0.130/25",
                    )],
                ),
            ],
        );

        let plan = plan_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(plan.interfaces.len(), 2);
        assert_eq!(plan.interfaces[0].index, 0);
        assert_eq!(plan.interfaces[1].index, 1);
        assert_eq!(plan.counts.create, 3);
        assert_eq!(plan.interfaces[0].counts.create, 2);
        assert_eq!(plan.interfaces[1].counts.create, 1);
        let view = plan.view();
        assert_eq!(view.summary.interfaces, 2);
        assert_eq!(view.summary.create, 3);
    }

    #[test]
    fn duplicate_public_keys_are_marked_duplicate() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let first = generate_keypair();
        let second = generate_keypair();
        let phone = generate_keypair();
        let request = batch(
            node.id,
            vec![
                interface(
                    "awg0",
                    &first,
                    &[("pool-a", "10.8.0.0/25")],
                    vec![
                        client("phone", &phone, &public_of(&first), "10.8.0.2/25"),
                        client("phone-copy", &phone, &public_of(&first), "10.8.0.3/25"),
                    ],
                ),
                interface(
                    "awg1",
                    &second,
                    &[("pool-b", "10.8.0.128/25")],
                    vec![client(
                        "phone-again",
                        &phone,
                        &public_of(&second),
                        "10.8.0.130/25",
                    )],
                ),
            ],
        );

        let plan = plan_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(
            plan.interfaces[0].clients[0].status,
            ImportClientStatus::Create
        );
        assert_eq!(
            plan.interfaces[0].clients[1].status,
            ImportClientStatus::Duplicate
        );
        assert_eq!(
            plan.interfaces[1].clients[0].status,
            ImportClientStatus::Duplicate
        );
        assert_eq!(plan.counts.create, 1);
        assert_eq!(plan.counts.duplicate, 2);
        assert!(
            plan.interfaces[1].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("awg0")
        );
    }

    #[test]
    fn existing_public_keys_are_marked_duplicate() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let phone = generate_keypair();
        let request = batch(
            node.id,
            vec![interface(
                "awg0",
                &server,
                &[("default", "10.8.0.0/25")],
                vec![client("phone", &phone, &public_of(&server), "10.8.0.2/25")],
            )],
        );
        apply_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        let again = batch(
            node.id,
            vec![interface(
                "awg9",
                &server,
                &[("other", "10.8.0.128/25")],
                vec![client(
                    "phone",
                    &phone,
                    &public_of(&server),
                    "10.8.0.130/25",
                )],
            )],
        );
        let plan = plan_import(&h.network, &h.devices, &again, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(
            plan.interfaces[0].clients[0].status,
            ImportClientStatus::Duplicate
        );
        assert!(
            plan.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("already exists")
        );
    }

    #[test]
    fn invalid_clients_are_reported_without_failing_the_plan() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let foreign_server = generate_keypair();
        let foreign = generate_keypair();
        let outside = generate_keypair();
        let broken = generate_keypair();
        let request = batch(
            node.id,
            vec![interface(
                "awg0",
                &server,
                &[("default", "10.8.0.0/25")],
                vec![
                    raw_client(
                        "   ",
                        &client_text(&broken, &public_of(&server), "10.8.0.4/25"),
                    ),
                    raw_client(
                        "foreign",
                        &client_text(&foreign, &public_of(&foreign_server), "10.8.0.5/25"),
                    ),
                    raw_client(
                        "outside",
                        &client_text(&outside, &public_of(&server), "10.9.0.2/24"),
                    ),
                    raw_client("broken", "not a wireguard config"),
                ],
            )],
        );

        let plan = plan_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(plan.counts.create, 0);
        assert_eq!(plan.counts.error, 4);
        assert_eq!(plan.interfaces[0].clients[0].name, "");
        assert!(
            plan.interfaces[0].clients[2]
                .reason
                .as_deref()
                .unwrap()
                .contains("configured pool")
        );
        assert!(
            plan.interfaces[0].clients[3]
                .reason
                .as_deref()
                .unwrap()
                .contains("no [Interface] section")
        );
        assert!(h.network.list_groups().unwrap().is_empty());
    }

    #[test]
    fn foreign_server_key_and_empty_name_are_errors() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let other = generate_keypair();
        let phone = generate_keypair();
        let request = batch(
            node.id,
            vec![interface(
                "awg0",
                &server,
                &[("default", "10.8.0.0/25")],
                vec![
                    raw_client(
                        "   ",
                        &client_text(&phone, &public_of(&server), "10.8.0.2/25"),
                    ),
                    client("wrong-server", &phone, &public_of(&other), "10.8.0.3/25"),
                ],
            )],
        );

        let plan = plan_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(plan.counts.error, 2);
        assert!(
            plan.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("name is required")
        );
        assert!(
            plan.interfaces[0].clients[1]
                .reason
                .as_deref()
                .unwrap()
                .contains("different server public key")
        );
    }

    #[test]
    fn duplicate_client_names_get_a_suffix() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let first = generate_keypair();
        let second = generate_keypair();
        let request = batch(
            node.id,
            vec![interface(
                "awg0",
                &server,
                &[("default", "10.8.0.0/25")],
                vec![
                    client("phone", &first, &public_of(&server), "10.8.0.2/25"),
                    client("phone", &second, &public_of(&server), "10.8.0.3/25"),
                ],
            )],
        );

        let plan = plan_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(plan.interfaces[0].clients[0].name, "phone");
        assert_eq!(plan.interfaces[0].clients[1].name, "phone-2");
        assert_eq!(plan.counts.create, 2);
        assert!(plan.warnings.iter().any(|w| w.contains("phone-2")));
    }

    #[test]
    fn apply_creates_group_pools_interfaces_and_devices() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let first = generate_keypair();
        let second = generate_keypair();
        let phone = generate_keypair();
        let tablet = generate_keypair();
        let request = batch(
            node.id,
            vec![
                interface(
                    "awg0",
                    &first,
                    &[("pool-a", "10.8.0.0/25")],
                    vec![client("phone", &phone, &public_of(&first), "10.8.0.2/25")],
                ),
                interface(
                    "awg1",
                    &second,
                    &[("pool-b", "10.8.0.128/25")],
                    vec![client(
                        "tablet",
                        &tablet,
                        &public_of(&second),
                        "10.8.0.130/25",
                    )],
                ),
            ],
        );

        let (plan, created) = apply_import(&h.network, &h.devices, &request, owner())
            .ok()
            .expect("import should succeed");

        assert_eq!(plan.counts.create, 2);
        let groups = h.network.list_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, created.group_id);
        assert_eq!(h.network.list_interfaces().unwrap().len(), 2);
        let pools = h.network.list_pools(created.group_id).unwrap();
        assert_eq!(pools.len(), 2);
        let pool_ids: BTreeSet<Uuid> = pools.iter().map(|p| p.id).collect();
        assert_eq!(h.devices.list_all().unwrap().len(), 2);

        let peers = h.devices.all_peers().unwrap();
        assert_eq!(peers.len(), 2);
        let mut addresses = BTreeSet::new();
        for peer in &peers {
            assert_eq!(peer.ips.len(), 1);
            for (pool_id, ip) in &peer.ips {
                assert!(pool_ids.contains(pool_id));
                addresses.insert(ip.to_string());
            }
        }
        assert_eq!(
            addresses,
            BTreeSet::from(["10.8.0.2".to_string(), "10.8.0.130".to_string()])
        );
        assert_eq!(created.interfaces.len(), 2);
        assert_eq!(created.interfaces[0].device_ids.len(), 1);
        assert_eq!(created.interfaces[1].device_ids.len(), 1);
    }

    #[test]
    fn apply_rolls_back_everything_on_fatal_error() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let base = h
            .network
            .create_group("base", "", "10.9.0.0/24", false)
            .unwrap();
        h.network
            .add_interface(
                base.id,
                node.id,
                NewInterface {
                    name: "awg1".into(),
                    label: "existing".into(),
                    endpoint_host: "old.example.com".into(),
                    endpoint_port: 51820,
                    listen_port: 51820,
                    mtu: 1420,
                },
                &ObfuscationSettings::default(),
            )
            .unwrap();

        let first = generate_keypair();
        let second = generate_keypair();
        let phone = generate_keypair();
        let request = batch(
            node.id,
            vec![
                interface(
                    "awg0",
                    &first,
                    &[("pool-a", "10.8.0.0/25")],
                    vec![client("phone", &phone, &public_of(&first), "10.8.0.2/25")],
                ),
                interface("awg1", &second, &[("pool-b", "10.8.0.128/25")], vec![]),
            ],
        );

        let error = apply_import(&h.network, &h.devices, &request, owner()).unwrap_err();
        let message = match error {
            ApiError::Conflict(message) => message,
            other => panic!("unexpected error status: {}", other.status_code()),
        };
        assert!(message.contains("rolled back"));

        let groups = h.network.list_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "base");
        let interfaces = h.network.list_interfaces().unwrap();
        assert_eq!(interfaces.len(), 1);
        assert_eq!(interfaces[0].name, "awg1");
        assert!(h.network.list_all_pools().unwrap().is_empty());
        assert!(h.devices.list_all().unwrap().is_empty());
    }

    #[test]
    fn overlapping_pools_and_duplicate_names_are_rejected() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let first = generate_keypair();
        let second = generate_keypair();

        let overlapping = batch(
            node.id,
            vec![interface(
                "awg0",
                &first,
                &[("a", "10.8.0.0/24"), ("b", "10.8.0.0/25")],
                vec![],
            )],
        );
        let error = plan_import(&h.network, &h.devices, &overlapping, owner()).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(message) if message.contains("overlaps")));

        let cross_interface = batch(
            node.id,
            vec![
                interface("awg0", &first, &[("a", "10.8.0.0/24")], vec![]),
                interface("awg1", &second, &[("b", "10.8.0.0/25")], vec![]),
            ],
        );
        let error = plan_import(&h.network, &h.devices, &cross_interface, owner()).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(message) if message.contains("overlaps")));

        let duplicate_names = batch(
            node.id,
            vec![
                interface("awg0", &first, &[("a", "10.8.0.0/25")], vec![]),
                interface("awg0", &second, &[("b", "10.8.0.128/25")], vec![]),
            ],
        );
        let error = plan_import(&h.network, &h.devices, &duplicate_names, owner()).unwrap_err();
        assert!(
            matches!(error, ApiError::BadRequest(message) if message.contains("duplicate interface name"))
        );

        let outside_base = batch(
            node.id,
            vec![interface("awg0", &first, &[("a", "10.9.0.0/25")], vec![])],
        );
        let error = plan_import(&h.network, &h.devices, &outside_base, owner()).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(_)));

        let duplicate_pools = batch(
            node.id,
            vec![
                interface("awg0", &first, &[("dup", "10.8.0.0/25")], vec![]),
                interface("awg1", &second, &[("dup", "10.8.0.128/25")], vec![]),
            ],
        );
        let error = plan_import(&h.network, &h.devices, &duplicate_pools, owner()).unwrap_err();
        assert!(
            matches!(error, ApiError::BadRequest(message) if message.contains("duplicate pool name"))
        );
    }

    #[test]
    fn import_endpoints_require_admin_role() {
        let user = AuthUser(AuthPrincipal {
            user_id: Uuid::new_v4(),
            role: Role::User,
        });
        assert!(matches!(user.require_admin(), Err(ApiError::Forbidden(_))));

        let admin = AuthUser(AuthPrincipal {
            user_id: Uuid::new_v4(),
            role: Role::Admin,
        });
        assert!(admin.require_admin().is_ok());
    }

    #[test]
    fn clients_import_requires_admin_role() {
        let user = AuthUser(AuthPrincipal {
            user_id: Uuid::new_v4(),
            role: Role::User,
        });
        assert!(matches!(user.require_admin(), Err(ApiError::Forbidden(_))));

        let admin = AuthUser(AuthPrincipal {
            user_id: Uuid::new_v4(),
            role: Role::Admin,
        });
        assert!(admin.require_admin().is_ok());
    }

    #[test]
    fn clients_preview_auto_matches_by_public_key_without_writing() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let first = generate_keypair();
        let second = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &first,
            &[("default", "10.8.0.0/25")],
        );
        let b = seed(
            &h,
            node.id,
            "g2",
            "10.9.0.0/24",
            "awg1",
            &second,
            &[("default", "10.9.0.0/25")],
        );
        let phone = generate_keypair();
        let laptop = generate_keypair();
        let request = clients_request(
            None,
            vec![
                client("phone", &phone, &public_of(&first), "10.8.0.2/25"),
                client("laptop", &laptop, &public_of(&second), "10.9.0.2/25"),
            ],
        );

        let plan = plan_clients_import(&h.network, &h.devices, &request)
            .ok()
            .expect("preview should succeed");
        let view = plan.view();

        assert_eq!(view.interfaces.len(), 2);
        assert_eq!(view.interfaces[0].id, a.interface_id);
        assert_eq!(view.interfaces[0].group_id, a.group_id);
        assert_eq!(view.interfaces[0].group_name, "g1");
        assert_eq!(view.interfaces[0].node_id, node.id);
        assert_eq!(view.interfaces[0].public_key, public_of(&first));
        assert_eq!(
            view.interfaces[0].clients[0].status,
            ImportClientStatus::Create
        );
        assert_eq!(
            view.interfaces[0].clients[0].address.as_deref(),
            Some("10.8.0.2")
        );
        assert_eq!(view.interfaces[0].counts.create, 1);
        assert_eq!(view.interfaces[1].id, b.interface_id);
        assert_eq!(view.interfaces[1].group_name, "g2");
        assert_eq!(view.summary.interfaces, 2);
        assert_eq!(view.summary.create, 2);

        assert!(h.devices.list_all().unwrap().is_empty());
        assert!(h.devices.all_peers().unwrap().is_empty());
    }

    #[test]
    fn clients_preview_uses_explicit_interface() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let phone = generate_keypair();
        let laptop = generate_keypair();
        let request = clients_request(
            Some(a.interface_id),
            vec![
                client("phone", &phone, &public_of(&server), "10.8.0.2/25"),
                client("laptop", &laptop, &public_of(&server), "10.8.0.3/25"),
            ],
        );

        let view = plan_clients_import(&h.network, &h.devices, &request)
            .ok()
            .expect("preview should succeed")
            .view();

        assert_eq!(view.interfaces.len(), 1);
        assert_eq!(view.interfaces[0].id, a.interface_id);
        assert_eq!(view.interfaces[0].counts.create, 2);
        assert_eq!(view.summary.interfaces, 1);
        assert_eq!(view.summary.create, 2);

        let missing = clients_request(
            Some(Uuid::new_v4()),
            vec![client("phone", &phone, &public_of(&server), "10.8.0.2/25")],
        );
        let error = plan_clients_import(&h.network, &h.devices, &missing).unwrap_err();
        assert!(matches!(error, ApiError::NotFound(_)));
    }

    #[test]
    fn clients_preview_reports_server_key_mismatch() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let other = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let phone = generate_keypair();
        let request = clients_request(
            Some(a.interface_id),
            vec![client("phone", &phone, &public_of(&other), "10.8.0.2/25")],
        );

        let view = plan_clients_import(&h.network, &h.devices, &request)
            .ok()
            .expect("preview should succeed")
            .view();

        assert_eq!(view.interfaces[0].counts.error, 1);
        assert!(
            view.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("different server public key")
        );
    }

    #[test]
    fn clients_preview_reports_unknown_and_ambiguous_public_keys() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let phone = generate_keypair();
        let unknown = generate_keypair();

        let request = clients_request(
            None,
            vec![client("phone", &phone, &public_of(&unknown), "10.8.0.2/25")],
        );
        let view = plan_clients_import(&h.network, &h.devices, &request)
            .ok()
            .expect("preview should succeed")
            .view();

        assert_eq!(view.interfaces.len(), 1);
        assert!(view.interfaces[0].id.is_nil());
        assert_eq!(view.interfaces[0].public_key, public_of(&unknown));
        assert_eq!(view.interfaces[0].counts.error, 1);
        assert!(
            view.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("no interface with this public key")
        );

        add_interface_with_key(&h, node.id, a.group_id, "awg9", &server);
        let laptop = generate_keypair();
        let ambiguous = clients_request(
            None,
            vec![client(
                "laptop",
                &laptop,
                &public_of(&server),
                "10.8.0.3/25",
            )],
        );
        let view = plan_clients_import(&h.network, &h.devices, &ambiguous)
            .ok()
            .expect("preview should succeed")
            .view();

        assert_eq!(view.interfaces.len(), 1);
        assert_eq!(view.interfaces[0].counts.error, 1);
        assert!(
            view.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("ambiguous public key")
        );
    }

    #[test]
    fn clients_preview_validates_address_pool_and_usage() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let occupied = generate_keypair();
        seed_device(
            &h,
            owner(),
            a.group_id,
            a.interface_id,
            "existing",
            &occupied,
            a.pool_ids[0],
            Ipv4Addr::new(10, 8, 0, 2),
        );
        let outside = generate_keypair();
        let conflict = generate_keypair();
        let first = generate_keypair();
        let second = generate_keypair();
        let request = clients_request(
            Some(a.interface_id),
            vec![
                client("outside", &outside, &public_of(&server), "10.9.0.2/24"),
                client("conflict", &conflict, &public_of(&server), "10.8.0.2/25"),
                client("first", &first, &public_of(&server), "10.8.0.3/25"),
                client("second", &second, &public_of(&server), "10.8.0.3/25"),
            ],
        );

        let view = plan_clients_import(&h.network, &h.devices, &request)
            .ok()
            .expect("preview should succeed")
            .view();

        assert_eq!(view.interfaces[0].counts.create, 1);
        assert_eq!(view.interfaces[0].counts.error, 3);
        assert!(
            view.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("configured pool")
        );
        assert!(
            view.interfaces[0].clients[1]
                .reason
                .as_deref()
                .unwrap()
                .contains("already in use")
        );
        assert_eq!(
            view.interfaces[0].clients[2].status,
            ImportClientStatus::Create
        );
        assert!(
            view.interfaces[0].clients[3]
                .reason
                .as_deref()
                .unwrap()
                .contains("already in use")
        );
    }

    #[test]
    fn clients_preview_reports_duplicates_in_database_and_batch() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let existing = generate_keypair();
        seed_device(
            &h,
            owner(),
            a.group_id,
            a.interface_id,
            "existing",
            &existing,
            a.pool_ids[0],
            Ipv4Addr::new(10, 8, 0, 2),
        );
        let phone = generate_keypair();
        let request = clients_request(
            Some(a.interface_id),
            vec![
                client("existing", &existing, &public_of(&server), "10.8.0.3/25"),
                client("phone", &phone, &public_of(&server), "10.8.0.4/25"),
                client("phone-copy", &phone, &public_of(&server), "10.8.0.5/25"),
            ],
        );

        let view = plan_clients_import(&h.network, &h.devices, &request)
            .ok()
            .expect("preview should succeed")
            .view();

        assert_eq!(view.interfaces[0].counts.create, 1);
        assert_eq!(view.interfaces[0].counts.duplicate, 2);
        assert_eq!(
            view.interfaces[0].clients[0].status,
            ImportClientStatus::Duplicate
        );
        assert!(
            view.interfaces[0].clients[0]
                .reason
                .as_deref()
                .unwrap()
                .contains("already exists")
        );
        assert_eq!(
            view.interfaces[0].clients[2].status,
            ImportClientStatus::Duplicate
        );
        assert!(
            view.interfaces[0].clients[2]
                .reason
                .as_deref()
                .unwrap()
                .contains("awg0")
        );
    }

    #[test]
    fn clients_apply_creates_devices_in_the_target_interface() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let phone = generate_keypair();
        let laptop = generate_keypair();
        let request = clients_request(
            None,
            vec![
                client("phone", &phone, &public_of(&server), "10.8.0.2/25"),
                client("laptop", &laptop, &public_of(&server), "10.8.0.3/25"),
            ],
        );
        let owner_id = owner();

        let (plan, created) = apply_clients_import(&h.network, &h.devices, &request, owner_id)
            .ok()
            .expect("apply should succeed");

        assert_eq!(plan.counts.create, 2);
        assert_eq!(created.interfaces.len(), 1);
        assert_eq!(created.interfaces[0].id, a.interface_id);
        assert_eq!(created.interfaces[0].device_ids.len(), 2);

        let devices = h.devices.list_all().unwrap();
        assert_eq!(devices.len(), 2);
        for device in &devices {
            assert_eq!(device.group_id, a.group_id);
            assert_eq!(device.user_id, owner_id);
        }
        let peers = h.devices.all_peers().unwrap();
        assert_eq!(peers.len(), 2);
        let mut addresses = BTreeSet::new();
        for peer in &peers {
            assert_eq!(peer.interface_id, a.interface_id);
            assert_eq!(peer.ips.len(), 1);
            for (pool_id, ip) in &peer.ips {
                assert_eq!(*pool_id, a.pool_ids[0]);
                addresses.insert(ip.to_string());
            }
        }
        assert_eq!(
            addresses,
            BTreeSet::from(["10.8.0.2".to_string(), "10.8.0.3".to_string()])
        );
    }

    #[test]
    fn clients_apply_uses_requested_owner_and_skips_duplicates() {
        let h = harness();
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let phone = generate_keypair();
        let existing_owner = owner();
        seed_device(
            &h,
            existing_owner,
            a.group_id,
            a.interface_id,
            "phone",
            &phone,
            a.pool_ids[0],
            Ipv4Addr::new(10, 8, 0, 2),
        );
        let laptop = generate_keypair();
        let request = clients_request(
            Some(a.interface_id),
            vec![
                client("phone", &phone, &public_of(&server), "10.8.0.3/25"),
                client("laptop", &laptop, &public_of(&server), "10.8.0.4/25"),
            ],
        );
        let requested_owner = owner();

        let (plan, created) =
            apply_clients_import(&h.network, &h.devices, &request, requested_owner)
                .ok()
                .expect("apply should succeed");

        assert_eq!(plan.counts.duplicate, 1);
        assert_eq!(plan.counts.create, 1);
        assert_eq!(created.interfaces[0].device_ids.len(), 1);

        let devices = h.devices.list_all().unwrap();
        assert_eq!(devices.len(), 2);
        let created_device = devices
            .iter()
            .find(|device| device.name == "laptop")
            .expect("laptop device should exist");
        assert_eq!(created_device.user_id, requested_owner);
        assert_eq!(created_device.group_id, a.group_id);
        let phone_device = devices
            .iter()
            .find(|device| device.name == "phone")
            .expect("existing phone should remain");
        assert_eq!(phone_device.user_id, existing_owner);
    }

    #[test]
    fn clients_apply_rolls_back_on_fatal_error() {
        let h = flaky_harness(1);
        let (node, _) = h.network.create_node("node-a").unwrap();
        let server = generate_keypair();
        let a = seed(
            &h,
            node.id,
            "g1",
            "10.8.0.0/24",
            "awg0",
            &server,
            &[("default", "10.8.0.0/25")],
        );
        let existing = generate_keypair();
        let existing_id = seed_device(
            &h,
            owner(),
            a.group_id,
            a.interface_id,
            "existing",
            &existing,
            a.pool_ids[0],
            Ipv4Addr::new(10, 8, 0, 9),
        );
        let first = generate_keypair();
        let second = generate_keypair();
        let request = clients_request(
            Some(a.interface_id),
            vec![
                client("first", &first, &public_of(&server), "10.8.0.2/25"),
                client("second", &second, &public_of(&server), "10.8.0.3/25"),
            ],
        );

        let error = apply_clients_import(&h.network, &h.devices, &request, owner()).unwrap_err();
        assert!(matches!(error, ApiError::Internal(_)));

        let devices = h.devices.list_all().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, existing_id);
        let peers = h.devices.all_peers().unwrap();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].device_id, existing_id);
    }

    #[test]
    fn clients_import_rejects_empty_clients() {
        let h = harness();
        let request = clients_request(None, vec![]);
        let error = plan_clients_import(&h.network, &h.devices, &request).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(_)));
    }
}
