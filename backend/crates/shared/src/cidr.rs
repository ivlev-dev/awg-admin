use std::collections::HashSet;
use std::net::Ipv4Addr;

use ipnet::Ipv4Net;

use crate::error::{CoreError, CoreResult};

/// Widest pool accepted by [`validate_pool_prefix`]. Pools wider than `/16`
/// are rejected so a single pool can never describe millions of addresses.
pub const MIN_POOL_PREFIX_LEN: u8 = 16;

/// Cap on how many candidates `allocate_ip` visits in one call. A `/16` pool
/// is always walked completely; the cap only protects callers that ignore
/// [`validate_pool_prefix`] and hand over a truly huge pool (a `/8` is never
/// walked in full). Ending the walk early is reported as `Conflict`.
const MAX_POOL_WALK: u64 = 1_000_000;

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

/// Rejects pools wider than [`MIN_POOL_PREFIX_LEN`].
pub fn validate_pool_prefix(pool: Ipv4Net) -> CoreResult<()> {
    if pool.prefix_len() < MIN_POOL_PREFIX_LEN {
        return Err(CoreError::Invalid(format!(
            "pool {pool} is wider than /{MIN_POOL_PREFIX_LEN}"
        )));
    }
    Ok(())
}

/// Number of usable host addresses in `pool`, computed without allocation.
///
/// `/31` is a point-to-point link (RFC 3021) with two usable addresses and a
/// `/32` has exactly one. Every wider prefix keeps the network and broadcast
/// addresses reserved.
pub fn usable_host_count(pool: Ipv4Net) -> u64 {
    match pool.prefix_len() {
        31 => 2,
        32 => 1,
        prefix => (1u64 << (32 - prefix)) - 2,
    }
}

/// Returns the usable address at `index`, or `None` when the index is out of
/// range. For `/31` and `/32` the whole block is usable.
pub fn host_at(pool: Ipv4Net, index: u64) -> Option<Ipv4Addr> {
    let count = usable_host_count(pool);
    if index >= count {
        return None;
    }
    let base = u64::from(u32::from(pool.network()));
    let offset = match pool.prefix_len() {
        31 | 32 => index,
        _ => index + 1,
    };
    Some(Ipv4Addr::from((base + offset) as u32))
}

/// Materializes every usable address of `pool`.
///
/// Kept for compatibility with callers and tests that need a small slice of a
/// pool. Production code must use [`usable_host_count`] and [`host_at`]:
/// filling this vector for a `/8` would allocate ~16 million addresses.
pub fn usable_hosts(pool: Ipv4Net) -> Vec<Ipv4Addr> {
    (0..usable_host_count(pool))
        .filter_map(|index| host_at(pool, index))
        .collect()
}

fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

/// Returns a stride coprime with `count` so that walking
/// `start + step * stride (mod count)` visits every candidate exactly once.
fn probe_stride(count: u64) -> u64 {
    if count <= 1 {
        return 1;
    }
    let mut stride = (2_654_435_761u64 % count).max(1);
    while gcd(stride, count) != 1 {
        stride += 1;
    }
    stride
}

pub fn allocate_ip(
    pool: Ipv4Net,
    used: &HashSet<Ipv4Addr>,
    seed: u64,
    reserved: &[Ipv4Addr],
) -> CoreResult<Ipv4Addr> {
    let count = usable_host_count(pool);
    if count == 0 {
        return Err(CoreError::Conflict(format!(
            "pool {pool} has no usable hosts"
        )));
    }
    let start = seed % count;
    let stride = probe_stride(count);
    let probes = count.min(MAX_POOL_WALK);
    for step in 0..probes {
        let index = (start + step * stride) % count;
        let Some(candidate) = host_at(pool, index) else {
            continue;
        };
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

    #[test]
    fn wide_pools_are_counted_without_allocation() {
        let pool = net("10.0.0.0/8");
        assert_eq!(usable_host_count(pool), 16_777_214);
        assert_eq!(
            host_at(pool, 0),
            Some(Ipv4Addr::new(10, 0, 0, 1)),
            "the network address is reserved"
        );
        assert_eq!(
            host_at(pool, usable_host_count(pool) - 1),
            Some(Ipv4Addr::new(10, 255, 255, 254)),
            "the broadcast address is reserved"
        );
        assert_eq!(host_at(pool, usable_host_count(pool)), None);
    }

    #[test]
    fn point_to_point_and_single_host_pools_are_fully_usable() {
        let pair = net("10.1.0.0/31");
        assert_eq!(usable_host_count(pair), 2);
        assert_eq!(host_at(pair, 0), Some(Ipv4Addr::new(10, 1, 0, 0)));
        assert_eq!(host_at(pair, 1), Some(Ipv4Addr::new(10, 1, 0, 1)));
        assert_eq!(host_at(pair, 2), None);

        let single = net("10.1.0.7/32");
        assert_eq!(usable_host_count(single), 1);
        assert_eq!(host_at(single, 0), Some(Ipv4Addr::new(10, 1, 0, 7)));
        assert_eq!(host_at(single, 1), None);
    }

    #[test]
    fn pool_prefix_limits_are_enforced() {
        assert!(validate_pool_prefix(net("10.0.0.0/16")).is_ok());
        assert!(validate_pool_prefix(net("10.0.0.0/24")).is_ok());
        assert!(validate_pool_prefix(net("10.0.0.0/15")).is_err());
        assert!(validate_pool_prefix(net("10.0.0.0/8")).is_err());
    }

    #[test]
    fn allocation_skips_a_long_run_of_used_addresses() {
        let pool = net("10.1.0.0/16");
        let used: HashSet<Ipv4Addr> = (0..5000)
            .map(|index| host_at(pool, index).expect("index is inside a /16"))
            .collect();

        let ip = allocate_ip(pool, &used, 0, &[]).expect("free addresses remain after 5000 used");
        assert!(!used.contains(&ip));
        assert!(pool.contains(&ip));
    }

    #[test]
    fn fully_occupied_pool_is_reported_as_exhausted() {
        let pool = net("10.1.0.0/24");
        let used: HashSet<Ipv4Addr> = (0..usable_host_count(pool))
            .map(|index| host_at(pool, index).expect("index is inside a /24"))
            .collect();

        let err = allocate_ip(pool, &used, 0, &[]).unwrap_err();
        assert!(matches!(err, CoreError::Conflict(_)));
    }

    #[test]
    fn allocation_in_a_wide_pool_does_not_materialize_it() {
        let pool = net("10.0.0.0/8");
        let used = HashSet::new();
        let ip = allocate_ip(pool, &used, 0, &[]).unwrap();
        assert_eq!(ip, Ipv4Addr::new(10, 0, 0, 1));
    }
}
