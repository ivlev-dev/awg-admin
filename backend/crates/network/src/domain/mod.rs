use std::collections::HashSet;
use std::net::Ipv4Addr;

use chrono::{DateTime, Utc};
use ipnet::Ipv4Net;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use subtle::ConstantTimeEq;

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
    #[serde(default)]
    pub token_issued_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub cpu_load: Option<f64>,
    #[serde(default)]
    pub mem_used_bytes: Option<u64>,
    #[serde(default)]
    pub mem_total_bytes: Option<u64>,
    #[serde(default)]
    pub kernel_version: Option<String>,
    #[serde(default)]
    pub worker_version: Option<String>,
    #[serde(default)]
    pub uptime_secs: Option<u64>,
    #[serde(default)]
    pub metrics_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NodeMetricsUpdate {
    pub cpu_load: f64,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
    pub kernel_version: String,
    pub worker_version: String,
    pub uptime_secs: u64,
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
    /// Looks a node up by token hash through the lookup index and verifies that
    /// the stored hash still matches, so a stale index row never authenticates.
    fn find_by_token_hash(&self, token_hash: &str) -> CoreResult<Option<Node>>;
    /// Atomically updates only the metrics fields of `id`.
    fn record_metrics(&self, id: Uuid, metrics: &NodeMetricsUpdate) -> CoreResult<Node>;
    /// Atomically updates only the status/version/last-seen fields of `id`.
    fn set_status(
        &self,
        id: Uuid,
        status: NodeStatus,
        last_seen: DateTime<Utc>,
        version: Option<String>,
    ) -> CoreResult<Node>;
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
        Self::ensure_no_overlap_excluding(pools, candidate, None)
    }

    /// Same as [`Self::ensure_no_overlap`], but ignores `exclude` so a pool can
    /// be re-validated against its siblings after an update.
    pub fn ensure_no_overlap_excluding(
        pools: &[CidrPool],
        candidate: Ipv4Net,
        exclude: Option<Uuid>,
    ) -> CoreResult<()> {
        for existing in pools {
            if !existing.enabled || Some(existing.id) == exclude {
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

/// Validates a pool gateway address against the pool it serves.
///
/// A gateway without `/` is a plain host address; one with `/` is accepted as
/// a server address (`10.1.0.1/24`), but only its address part is checked.
/// The address must belong to the pool and, unless the pool is a `/31` or
/// `/32`, must not be the network or broadcast address.
pub fn validate_pool_gateway(pool: Ipv4Net, gateway: &str) -> CoreResult<()> {
    let raw = gateway.trim();
    if raw.is_empty() {
        return Err(CoreError::Invalid("pool gateway must not be empty".into()));
    }
    let addr = if raw.contains('/') {
        cidr::parse_net(raw)?.addr()
    } else {
        raw.parse::<Ipv4Addr>()
            .map_err(|e| CoreError::Invalid(format!("invalid pool gateway {raw:?}: {e}")))?
    };
    if !pool.contains(&addr) {
        return Err(CoreError::Invalid(format!(
            "pool gateway {addr} is outside {pool}"
        )));
    }
    if pool.prefix_len() <= 30 && (addr == pool.network() || addr == pool.broadcast()) {
        return Err(CoreError::Invalid(format!(
            "pool gateway {addr} must not be the network or broadcast address of {pool}"
        )));
    }
    Ok(())
}

/// Constant-time comparison of a stored and a presented token hash.
///
/// Token hashes are hex strings of equal length, so a plain `==` would leak
/// the position of the first differing byte through timing. Both sides are
/// normalized the same way the lookup index stores its keys, so an
/// uppercase legacy hash keeps working.
pub fn token_hash_matches(stored: &str, presented: &str) -> bool {
    let stored = stored.trim().to_ascii_lowercase();
    let presented = presented.trim().to_ascii_lowercase();
    stored.as_bytes().ct_eq(presented.as_bytes()).into()
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
