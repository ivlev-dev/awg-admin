use std::collections::HashSet;
use std::net::Ipv4Addr;

use chrono::{DateTime, Utc};
use ipnet::Ipv4Net;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::cidr::{self, validate_pool};
use awg_shared::obf::InterfaceObf;
use awg_shared::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub base_cidr: String,
    pub forwarding_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Online,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: Uuid,
    pub name: String,
    pub token_hash: String,
    pub status: NodeStatus,
    pub last_seen: Option<DateTime<Utc>>,
    pub version: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interface {
    pub id: Uuid,
    pub group_id: Uuid,
    pub node_id: Uuid,
    pub name: String,
    pub label: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub listen_port: u16,
    pub mtu: u16,
    pub private_key_sealed: String,
    pub public_key: String,
    pub obf: InterfaceObf,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PoolMode {
    Auto,
    RfOnly,
    ExternalOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CidrPool {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub cidr: String,
    pub mode: PoolMode,
    pub gateway: Option<String>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub trait GroupRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Group>>;
    fn list(&self) -> CoreResult<Vec<Group>>;
    fn save(&self, group: &Group) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}

pub trait NodeRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Node>>;
    fn list(&self) -> CoreResult<Vec<Node>>;
    fn save(&self, node: &Node) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}

pub trait InterfaceRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Interface>>;
    fn list(&self) -> CoreResult<Vec<Interface>>;
    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Interface>>;
    fn by_node(&self, node_id: Uuid) -> CoreResult<Vec<Interface>>;
    fn save(&self, interface: &Interface) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}

pub trait CidrPoolRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<CidrPool>>;
    fn list(&self) -> CoreResult<Vec<CidrPool>>;
    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<CidrPool>>;
    fn save(&self, pool: &CidrPool) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}

pub struct SubnetAllocator;

impl SubnetAllocator {
    pub fn ensure_valid_pool(base: &str, pool_cidr: &str) -> CoreResult<Ipv4Net> {
        let base = cidr::parse_net(base)?;
        let pool = cidr::parse_net(pool_cidr)?;
        validate_pool(base, pool)?;
        Ok(pool)
    }

    pub fn ensure_no_overlap(pools: &[CidrPool], candidate: Ipv4Net) -> CoreResult<()> {
        for existing in pools {
            if !existing.enabled {
                continue;
            }
            let net = cidr::parse_net(&existing.cidr)?;
            if net.contains(&candidate.network()) || candidate.contains(&net.network()) {
                return Err(CoreError::Conflict(format!(
                    "pool {candidate} overlaps with {}",
                    existing.cidr
                )));
            }
        }
        Ok(())
    }

    pub fn allocate(
        pool: Ipv4Net,
        used: &HashSet<Ipv4Addr>,
        seed: u64,
        gateway: Option<Ipv4Addr>,
    ) -> CoreResult<Ipv4Addr> {
        let reserved: Vec<Ipv4Addr> = gateway.into_iter().collect();
        cidr::allocate_ip(pool, used, seed, &reserved)
    }
}

pub fn validate_interface_name(name: &str) -> CoreResult<()> {
    if name.is_empty() || name.len() > 15 {
        return Err(CoreError::Invalid(
            "interface name must be 1..15 characters".into(),
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(CoreError::Invalid(
            "interface name may contain letters, digits, _ and -".into(),
        ));
    }
    Ok(())
}
