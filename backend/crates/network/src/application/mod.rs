use std::sync::Arc;

use chrono::Utc;
use ipnet::Ipv4Net;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use awg_shared::crypto::{Sealer, generate_keypair, random_bytes};
use awg_shared::obf::{ObfuscationSettings, generate_interface_obf};
use awg_shared::{CoreError, CoreResult};

use crate::domain::{
    CidrPool, CidrPoolRepository, Group, GroupRepository, Interface, InterfaceRepository, Node,
    NodeRepository, NodeStatus, PoolMode, SubnetAllocator, validate_interface_name,
};

#[derive(Debug, Clone)]
pub struct NewInterface {
    pub name: String,
    pub label: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub listen_port: u16,
    pub mtu: u16,
}

#[derive(Debug, Clone, Default)]
pub struct InterfaceChanges {
    pub label: Option<String>,
    pub endpoint_host: Option<String>,
    pub endpoint_port: Option<u16>,
    pub listen_port: Option<u16>,
    pub mtu: Option<u16>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct NewPool {
    pub name: String,
    pub cidr: String,
    pub mode: PoolMode,
    pub gateway: Option<String>,
}

pub struct NetworkService {
    groups: Arc<dyn GroupRepository>,
    nodes: Arc<dyn NodeRepository>,
    interfaces: Arc<dyn InterfaceRepository>,
    pools: Arc<dyn CidrPoolRepository>,
    sealer: Arc<Sealer>,
}

impl NetworkService {
    pub fn new(
        groups: Arc<dyn GroupRepository>,
        nodes: Arc<dyn NodeRepository>,
        interfaces: Arc<dyn InterfaceRepository>,
        pools: Arc<dyn CidrPoolRepository>,
        sealer: Arc<Sealer>,
    ) -> Self {
        Self {
            groups,
            nodes,
            interfaces,
            pools,
            sealer,
        }
    }

    pub fn list_groups(&self) -> CoreResult<Vec<Group>> {
        self.groups.list()
    }

    pub fn get_group(&self, id: Uuid) -> CoreResult<Group> {
        self.groups
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("group".into()))
    }

    pub fn create_group(
        &self,
        name: &str,
        description: &str,
        base_cidr: &str,
        forwarding_default: bool,
    ) -> CoreResult<Group> {
        if name.trim().is_empty() {
            return Err(CoreError::Invalid("group name is required".into()));
        }
        let base = awg_shared::cidr::parse_net(base_cidr)?;
        let now = Utc::now();
        let group = Group {
            id: Uuid::new_v4(),
            name: name.trim().to_string(),
            description: description.to_string(),
            base_cidr: format!("{}/{}", base.addr(), base.prefix_len()),
            forwarding_default,
            created_at: now,
            updated_at: now,
        };
        self.groups.save(&group)?;
        Ok(group)
    }

    pub fn update_group(
        &self,
        id: Uuid,
        name: Option<String>,
        description: Option<String>,
        base_cidr: Option<String>,
        forwarding_default: Option<bool>,
    ) -> CoreResult<Group> {
        let mut group = self.get_group(id)?;
        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err(CoreError::Invalid("group name is required".into()));
            }
            group.name = name.trim().to_string();
        }
        if let Some(description) = description {
            group.description = description;
        }
        if let Some(base_cidr) = base_cidr {
            let base = awg_shared::cidr::parse_net(&base_cidr)?;
            for pool in self.pools.by_group(id)? {
                SubnetAllocator::ensure_valid_pool(&base_cidr, &pool.cidr)?;
            }
            group.base_cidr = format!("{}/{}", base.addr(), base.prefix_len());
        }
        if let Some(value) = forwarding_default {
            group.forwarding_default = value;
        }
        group.updated_at = Utc::now();
        self.groups.save(&group)?;
        Ok(group)
    }

    pub fn delete_group(&self, id: Uuid) -> CoreResult<()> {
        if !self.interfaces.by_group(id)?.is_empty() {
            return Err(CoreError::Conflict(
                "group still has interfaces; detach them first".into(),
            ));
        }
        for pool in self.pools.by_group(id)? {
            self.pools.delete(pool.id)?;
        }
        self.groups.delete(id)
    }

    pub fn list_pools(&self, group_id: Uuid) -> CoreResult<Vec<CidrPool>> {
        self.pools.by_group(group_id)
    }

    pub fn list_all_pools(&self) -> CoreResult<Vec<CidrPool>> {
        self.pools.list()
    }

    pub fn add_pool(&self, group_id: Uuid, input: NewPool) -> CoreResult<CidrPool> {
        let group = self.get_group(group_id)?;
        let net = SubnetAllocator::ensure_valid_pool(&group.base_cidr, &input.cidr)?;
        if input.name.trim().is_empty() {
            return Err(CoreError::Invalid("pool name is required".into()));
        }
        let existing = self.pools.by_group(group_id)?;
        SubnetAllocator::ensure_no_overlap(&existing, net)?;
        let now = Utc::now();
        let pool = CidrPool {
            id: Uuid::new_v4(),
            group_id,
            name: input.name.trim().to_string(),
            cidr: format!("{}/{}", net.addr(), net.prefix_len()),
            mode: input.mode,
            gateway: input.gateway,
            enabled: true,
            created_at: now,
            updated_at: now,
        };
        self.pools.save(&pool)?;
        Ok(pool)
    }

    pub fn update_pool(
        &self,
        id: Uuid,
        name: Option<String>,
        mode: Option<PoolMode>,
        gateway: Option<Option<String>>,
        enabled: Option<bool>,
    ) -> CoreResult<CidrPool> {
        let mut pool = self
            .pools
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("cidr pool".into()))?;
        if let Some(name) = name {
            if name.trim().is_empty() {
                return Err(CoreError::Invalid("pool name is required".into()));
            }
            pool.name = name.trim().to_string();
        }
        if let Some(mode) = mode {
            pool.mode = mode;
        }
        if let Some(gateway) = gateway {
            pool.gateway = gateway;
        }
        if let Some(enabled) = enabled {
            pool.enabled = enabled;
        }
        pool.updated_at = Utc::now();
        self.pools.save(&pool)?;
        Ok(pool)
    }

    pub fn delete_pool(&self, id: Uuid) -> CoreResult<()> {
        self.pools.delete(id)
    }

    pub fn pool_net(&self, pool: &CidrPool) -> CoreResult<Ipv4Net> {
        awg_shared::cidr::parse_net(&pool.cidr)
    }

    pub fn list_nodes(&self) -> CoreResult<Vec<Node>> {
        self.nodes.list()
    }

    pub fn get_node(&self, id: Uuid) -> CoreResult<Node> {
        self.nodes
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("node".into()))
    }

    pub fn create_node(&self, name: &str) -> CoreResult<(Node, String)> {
        if name.trim().is_empty() {
            return Err(CoreError::Invalid("node name is required".into()));
        }
        let token = hex(&random_bytes::<32>());
        let node = Node {
            id: Uuid::new_v4(),
            name: name.trim().to_string(),
            token_hash: hash_token(&token),
            status: NodeStatus::Offline,
            last_seen: None,
            version: None,
            created_at: Utc::now(),
        };
        self.nodes.save(&node)?;
        Ok((node, token))
    }

    pub fn authenticate_node(&self, token: &str) -> CoreResult<Node> {
        let hash = hash_token(token);
        let node = self
            .nodes
            .list()?
            .into_iter()
            .find(|n| n.token_hash == hash)
            .ok_or_else(|| CoreError::Forbidden("unknown worker token".into()))?;
        Ok(node)
    }

    pub fn mark_node(
        &self,
        id: Uuid,
        status: NodeStatus,
        version: Option<String>,
    ) -> CoreResult<Node> {
        let mut node = self.get_node(id)?;
        node.status = status;
        node.last_seen = Some(Utc::now());
        if version.is_some() {
            node.version = version;
        }
        self.nodes.save(&node)?;
        Ok(node)
    }

    pub fn delete_node(&self, id: Uuid) -> CoreResult<()> {
        if !self.interfaces.by_node(id)?.is_empty() {
            return Err(CoreError::Conflict(
                "node still has interfaces; detach them first".into(),
            ));
        }
        self.nodes.delete(id)
    }

    pub fn list_interfaces(&self) -> CoreResult<Vec<Interface>> {
        self.interfaces.list()
    }

    pub fn interfaces_by_group(&self, group_id: Uuid) -> CoreResult<Vec<Interface>> {
        self.interfaces.by_group(group_id)
    }

    pub fn interfaces_by_node(&self, node_id: Uuid) -> CoreResult<Vec<Interface>> {
        self.interfaces.by_node(node_id)
    }

    pub fn get_interface(&self, id: Uuid) -> CoreResult<Interface> {
        self.interfaces
            .find(id)?
            .ok_or_else(|| CoreError::NotFound("interface".into()))
    }

    pub fn add_interface(
        &self,
        group_id: Uuid,
        node_id: Uuid,
        input: NewInterface,
        settings: &ObfuscationSettings,
    ) -> CoreResult<Interface> {
        let group = self.get_group(group_id)?;
        self.get_node(node_id)?;
        validate_interface_name(&input.name)?;
        validate_port(input.listen_port, "listen port")?;
        validate_port(input.endpoint_port, "endpoint port")?;
        if input.endpoint_host.trim().is_empty() {
            return Err(CoreError::Invalid("endpoint host is required".into()));
        }
        if self
            .interfaces
            .by_node(node_id)?
            .iter()
            .any(|i| i.name == input.name)
        {
            return Err(CoreError::Conflict(format!(
                "interface {} already exists on this node",
                input.name
            )));
        }
        let keypair = generate_keypair();
        let now = Utc::now();
        let interface = Interface {
            id: Uuid::new_v4(),
            group_id: group.id,
            node_id,
            name: input.name,
            label: if input.label.trim().is_empty() {
                group.name.clone()
            } else {
                input.label
            },
            endpoint_host: input.endpoint_host.trim().to_string(),
            endpoint_port: input.endpoint_port,
            listen_port: input.listen_port,
            mtu: input.mtu.clamp(576, 1500),
            private_key_sealed: self.sealer.seal_str(&keypair.private_key)?,
            public_key: keypair.public_key,
            obf: generate_interface_obf(settings),
            enabled: true,
            created_at: now,
            updated_at: now,
        };
        self.interfaces.save(&interface)?;
        Ok(interface)
    }

    pub fn import_interface(
        &self,
        group_id: Uuid,
        node_id: Uuid,
        input: NewInterface,
        private_key: &str,
        public_key: &str,
        obf: awg_shared::obf::InterfaceObf,
    ) -> CoreResult<Interface> {
        let group = self.get_group(group_id)?;
        self.get_node(node_id)?;
        validate_interface_name(&input.name)?;
        validate_port(input.listen_port, "listen port")?;
        validate_port(input.endpoint_port, "endpoint port")?;
        if self
            .interfaces
            .by_node(node_id)?
            .iter()
            .any(|i| i.name == input.name)
        {
            return Err(CoreError::Conflict(format!(
                "interface {} already exists on this node",
                input.name
            )));
        }
        let now = Utc::now();
        let interface = Interface {
            id: Uuid::new_v4(),
            group_id: group.id,
            node_id,
            name: input.name,
            label: if input.label.trim().is_empty() {
                group.name.clone()
            } else {
                input.label
            },
            endpoint_host: input.endpoint_host.trim().to_string(),
            endpoint_port: input.endpoint_port,
            listen_port: input.listen_port,
            mtu: input.mtu.clamp(576, 1500),
            private_key_sealed: self.sealer.seal_str(private_key)?,
            public_key: public_key.to_string(),
            obf,
            enabled: true,
            created_at: now,
            updated_at: now,
        };
        self.interfaces.save(&interface)?;
        Ok(interface)
    }

    pub fn update_interface(&self, id: Uuid, changes: InterfaceChanges) -> CoreResult<Interface> {
        let mut interface = self.get_interface(id)?;
        if let Some(label) = changes.label {
            interface.label = label;
        }
        if let Some(host) = changes.endpoint_host {
            if host.trim().is_empty() {
                return Err(CoreError::Invalid("endpoint host is required".into()));
            }
            interface.endpoint_host = host.trim().to_string();
        }
        if let Some(port) = changes.endpoint_port {
            validate_port(port, "endpoint port")?;
            interface.endpoint_port = port;
        }
        if let Some(port) = changes.listen_port {
            validate_port(port, "listen port")?;
            interface.listen_port = port;
        }
        if let Some(mtu) = changes.mtu {
            interface.mtu = mtu.clamp(576, 1500);
        }
        if let Some(enabled) = changes.enabled {
            interface.enabled = enabled;
        }
        interface.updated_at = Utc::now();
        self.interfaces.save(&interface)?;
        Ok(interface)
    }

    pub fn rotate_interface(
        &self,
        id: Uuid,
        settings: &ObfuscationSettings,
    ) -> CoreResult<Interface> {
        let mut interface = self.get_interface(id)?;
        let keypair = generate_keypair();
        interface.private_key_sealed = self.sealer.seal_str(&keypair.private_key)?;
        interface.public_key = keypair.public_key;
        interface.obf = generate_interface_obf(settings);
        interface.updated_at = Utc::now();
        self.interfaces.save(&interface)?;
        Ok(interface)
    }

    pub fn delete_interface(&self, id: Uuid) -> CoreResult<()> {
        self.interfaces.delete(id)
    }

    pub fn interface_private_key(&self, interface: &Interface) -> CoreResult<String> {
        self.sealer.open_str(&interface.private_key_sealed)
    }
}

fn validate_port(port: u16, what: &str) -> CoreResult<()> {
    if port == 0 {
        return Err(CoreError::Invalid(format!("{what} must not be zero")));
    }
    Ok(())
}

fn hash_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
