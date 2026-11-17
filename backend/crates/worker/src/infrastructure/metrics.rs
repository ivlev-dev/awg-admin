use std::fs;

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone, PartialEq)]
pub struct NodeMetrics {
    pub cpu_load: f64,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
    pub kernel_version: String,
    pub worker_version: String,
    pub uptime_secs: u64,
}

pub fn collect() -> Result<NodeMetrics> {
    let loadavg = fs::read_to_string("/proc/loadavg").context("failed to read /proc/loadavg")?;
    let meminfo = fs::read_to_string("/proc/meminfo").context("failed to read /proc/meminfo")?;
    let kernel = fs::read_to_string("/proc/sys/kernel/osrelease")
        .context("failed to read /proc/sys/kernel/osrelease")?;
    let uptime = fs::read_to_string("/proc/uptime").context("failed to read /proc/uptime")?;

    let cpu_load = parse_loadavg(&loadavg)?;
    let (mem_used_bytes, mem_total_bytes) = parse_meminfo(&meminfo)?;
    let kernel_version = parse_kernel_version(&kernel)?;
    let uptime_secs = parse_uptime(&uptime)?;

    Ok(NodeMetrics {
        cpu_load,
        mem_used_bytes,
        mem_total_bytes,
        kernel_version,
        worker_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_secs,
    })
}

pub fn parse_loadavg(raw: &str) -> Result<f64> {
    let first = raw.split_whitespace().next().context("loadavg is empty")?;
    let value: f64 = first.parse().context("loadavg is not a number")?;
    if !value.is_finite() || value < 0.0 {
        bail!("loadavg is out of range");
    }
    Ok(value)
}

pub fn parse_meminfo(raw: &str) -> Result<(u64, u64)> {
    let total_kib = meminfo_value(raw, "MemTotal")?;
    let available_kib = meminfo_value(raw, "MemAvailable")?;
    let used_kib = total_kib.saturating_sub(available_kib);
    Ok((
        used_kib.saturating_mul(1024),
        total_kib.saturating_mul(1024),
    ))
}

pub fn parse_kernel_version(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.is_empty() {
        bail!("kernel version is empty");
    }
    Ok(value.to_string())
}

pub fn parse_uptime(raw: &str) -> Result<u64> {
    let first = raw.split_whitespace().next().context("uptime is empty")?;
    let value: f64 = first.parse().context("uptime is not a number")?;
    if !value.is_finite() || value < 0.0 {
        bail!("uptime is out of range");
    }
    Ok(value.floor() as u64)
}

fn meminfo_value(raw: &str, key: &str) -> Result<u64> {
    for line in raw.lines() {
        let Some((name, rest)) = line.split_once(':') else {
            continue;
        };
        if name.trim() != key {
            continue;
        }
        let amount = rest
            .split_whitespace()
            .next()
            .with_context(|| format!("{key} has no value"))?;
        let value: u64 = amount
            .parse()
            .with_context(|| format!("{key} is not a number"))?;
        return Ok(value);
    }
    bail!("{key} is missing")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_loadavg() {
        let value = parse_loadavg("0.42 0.30 0.15 1/234 5678\n").unwrap();
        assert!((value - 0.42).abs() < f64::EPSILON);
    }

    #[test]
    fn rejects_broken_loadavg() {
        assert!(parse_loadavg("").is_err());
        assert!(parse_loadavg("oops 0.1").is_err());
        assert!(parse_loadavg("-1.0").is_err());
        assert!(parse_loadavg("NaN").is_err());
    }

    #[test]
    fn parses_meminfo() {
        let raw = "MemTotal:       16384000 kB\nMemFree:         1024000 kB\nMemAvailable:    8192000 kB\n";
        let (used, total) = parse_meminfo(raw).unwrap();
        assert_eq!(total, 16384000 * 1024);
        assert_eq!(used, (16384000 - 8192000) * 1024);
    }

    #[test]
    fn clamps_meminfo_when_available_exceeds_total() {
        let raw = "MemTotal:       1024 kB\nMemAvailable:   2048 kB\n";
        let (used, total) = parse_meminfo(raw).unwrap();
        assert_eq!(used, 0);
        assert_eq!(total, 1024 * 1024);
    }

    #[test]
    fn rejects_broken_meminfo() {
        assert!(parse_meminfo("").is_err());
        assert!(parse_meminfo("MemTotal: 1024 kB\n").is_err());
        assert!(parse_meminfo("MemTotal: abc kB\nMemAvailable: 10 kB\n").is_err());
        assert!(parse_meminfo("MemTotal:\nMemAvailable: 10 kB\n").is_err());
    }

    #[test]
    fn parses_kernel_version() {
        assert_eq!(
            parse_kernel_version("6.8.0-45-generic\n").unwrap(),
            "6.8.0-45-generic"
        );
        assert!(parse_kernel_version("   ").is_err());
    }

    #[test]
    fn parses_uptime() {
        assert_eq!(parse_uptime("12345.67 98765.43\n").unwrap(), 12345);
        assert!(parse_uptime("").is_err());
        assert!(parse_uptime("soon").is_err());
        assert!(parse_uptime("-3").is_err());
    }
}
