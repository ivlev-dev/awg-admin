use std::collections::HashSet;
use std::net::Ipv4Addr;

use ipnet::Ipv4Net;

use crate::error::{CoreError, CoreResult};

pub fn parse_net(cidr: &str) -> CoreResult<Ipv4Net> {
    cidr.parse::<Ipv4Net>()
        .map_err(|e| CoreError::Invalid(format!("invalid CIDR {cidr:?}: {e}")))
}

pub fn pool_is_inside(parent: Ipv4Net, pool: Ipv4Net) -> bool {
    parent.contains(&pool.network()) && parent.contains(&pool.broadcast())
}

pub fn validate_pool(parent: Ipv4Net, pool: Ipv4Net) -> CoreResult<()> {
    if pool.prefix_len() < parent.prefix_len() {
        return Err(CoreError::Invalid(format!(
            "pool {pool} is wider than parent {parent}"
        )));
    }
    if !pool_is_inside(parent, pool) {
        return Err(CoreError::Invalid(format!(
            "pool {pool} is not inside {parent}"
        )));
    }
    Ok(())
}

pub fn usable_hosts(pool: Ipv4Net) -> Vec<Ipv4Addr> {
    if pool.prefix_len() >= 31 {
        return vec![pool.addr()];
    }
    let network = u32::from(pool.network());
    let broadcast = u32::from(pool.broadcast());
    (network + 1..broadcast).map(Ipv4Addr::from).collect()
}

pub fn allocate_ip(
    pool: Ipv4Net,
    used: &HashSet<Ipv4Addr>,
    seed: u64,
    reserved: &[Ipv4Addr],
) -> CoreResult<Ipv4Addr> {
    let hosts = usable_hosts(pool);
    if hosts.is_empty() {
        return Err(CoreError::Conflict(format!(
            "pool {pool} has no usable hosts"
        )));
    }
    let reserved: HashSet<Ipv4Addr> = reserved.iter().copied().collect();
    let start = (seed % hosts.len() as u64) as usize;
    for step in 0..hosts.len() {
        let candidate = hosts[(start + step) % hosts.len()];
        if !used.contains(&candidate) && !reserved.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(CoreError::Conflict(format!("pool {pool} is exhausted")))
}

pub fn address_with_prefix(ip: Ipv4Addr, pool: Ipv4Net) -> String {
    format!("{ip}/{}", pool.prefix_len())
}

pub fn seed_from_uuid(id: uuid::Uuid) -> u64 {
    let b = id.as_bytes();
    u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn net(cidr: &str) -> Ipv4Net {
        cidr.parse().unwrap()
    }

    #[test]
    fn validates_nested_pools() {
        let parent = net("10.0.0.1/14");
        assert!(validate_pool(parent, net("10.1.0.1/24")).is_ok());
        assert!(validate_pool(parent, net("10.2.0.1/14")).is_ok());
        assert!(validate_pool(parent, net("11.0.0.0/24")).is_err());
        assert!(validate_pool(parent, net("10.0.0.0/8")).is_err());
    }

    #[test]
    fn allocation_is_unique() {
        let pool = net("10.1.0.0/24");
        let mut used = HashSet::new();
        for i in 0..20u64 {
            let ip = allocate_ip(pool, &used, i * 7 + 1, &[]).unwrap();
            assert!(!used.contains(&ip));
            used.insert(ip);
        }
        assert_eq!(used.len(), 20);
    }

    #[test]
    fn allocation_skips_reserved_boundaries() {
        let pool = net("10.1.0.0/29");
        let used = HashSet::new();
        let reserved = vec![Ipv4Addr::new(10, 1, 0, 1), Ipv4Addr::new(10, 1, 0, 2)];
        let ip = allocate_ip(pool, &used, 0, &reserved).unwrap();
        assert!(!reserved.contains(&ip));
        assert_ne!(ip, Ipv4Addr::new(10, 1, 0, 0));
        assert_ne!(ip, Ipv4Addr::new(10, 1, 0, 7));
    }

    #[test]
    fn exhaustion_is_reported() {
        let pool = net("10.1.0.0/30");
        let mut used = HashSet::new();
        used.insert(Ipv4Addr::new(10, 1, 0, 1));
        used.insert(Ipv4Addr::new(10, 1, 0, 2));
        assert!(allocate_ip(pool, &used, 0, &[]).is_err());
    }
}
