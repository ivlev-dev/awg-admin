use std::process::Command;

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use uuid::Uuid;

use crate::application::TrafficShaper;
use crate::domain::{DesiredInterface, DesiredPeer};

pub struct TcShaper {
    dry_run: bool,
}

struct PeerPlan<'a> {
    peer: &'a DesiredPeer,
    user_class: String,
    device_class: String,
    ip: String,
}

impl TcShaper {
    pub fn new(dry_run: bool) -> Self {
        Self { dry_run }
    }

    fn run(&self, args: &[&str]) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: tc {}", args.join(" "));
            return Ok(());
        }
        let output = Command::new("tc")
            .args(args)
            .output()
            .context("failed to spawn tc")?;
        if !output.status.success() {
            return Err(anyhow!(
                "tc {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }

    fn run_optional(&self, args: &[&str]) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: tc {}", args.join(" "));
            return Ok(());
        }
        let output = Command::new("tc")
            .args(args)
            .output()
            .context("failed to spawn tc")?;
        if !output.status.success() {
            tracing::debug!(
                "tc {} ignored: {}",
                args.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }

    fn run_owned(&self, args: &[String]) -> Result<()> {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        self.run(&refs)
    }

    fn run_owned_optional(&self, args: &[String]) -> Result<()> {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        self.run_optional(&refs)
    }

    fn run_ip(&self, args: &[&str]) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: ip {}", args.join(" "));
            return Ok(());
        }
        let output = Command::new("ip")
            .args(args)
            .output()
            .context("failed to spawn ip")?;
        if !output.status.success() {
            return Err(anyhow!(
                "ip {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }

    fn rate(value: u32) -> String {
        if value == 0 {
            "10gbit".to_string()
        } else {
            format!("{value}kbit")
        }
    }

    fn plan(interface: &DesiredInterface, direction: Direction) -> Vec<PeerPlan<'_>> {
        let mut users: Vec<Uuid> = interface.user_limits.iter().map(|u| u.user_id).collect();
        users.sort();
        users.dedup();
        interface
            .peers
            .iter()
            .filter_map(|peer| {
                let limit = match direction {
                    Direction::Down => peer.down_kbps,
                    Direction::Up => peer.up_kbps,
                };
                if limit == 0 {
                    return None;
                }
                let ip = peer.addresses.first()?.split('/').next()?.to_string();
                let user_index = users.iter().position(|u| *u == peer.user_id)?;
                Some(PeerPlan {
                    peer,
                    user_class: format!("1:{}", 100 + user_index),
                    device_class: format!(
                        "1:{}",
                        1000 + user_index * 100 + peer_index(interface, peer)
                    ),
                    ip,
                })
            })
            .collect()
    }

    fn root_rate(interface: &DesiredInterface, direction: Direction) -> String {
        let sum: u64 = interface
            .user_limits
            .iter()
            .map(|u| {
                let value = match direction {
                    Direction::Down => u.group_down_kbps,
                    Direction::Up => u.group_up_kbps,
                };
                value as u64
            })
            .sum();
        if sum == 0 {
            "10gbit".to_string()
        } else {
            format!("{sum}kbit")
        }
    }

    fn apply_egress(&self, interface: &DesiredInterface) -> Result<()> {
        let dev = &interface.name;
        let plans = Self::plan(interface, Direction::Down);
        if plans.is_empty() && interface.user_limits.is_empty() {
            return Ok(());
        }

        let reset = root_reset_commands(dev);
        self.run_owned_optional(&reset[0])?;
        self.run_owned(&reset[1])?;
        self.run(&[
            "class",
            "replace",
            "dev",
            dev,
            "parent",
            "1:",
            "classid",
            "1:1",
            "htb",
            "rate",
            &Self::root_rate(interface, Direction::Down),
            "ceil",
            &Self::root_rate(interface, Direction::Down),
        ])?;

        let mut seen_users = Vec::new();
        for limit in &interface.user_limits {
            if seen_users.contains(&limit.user_id) {
                continue;
            }
            seen_users.push(limit.user_id);
            let index = seen_users.len() - 1;
            self.run(&[
                "class",
                "replace",
                "dev",
                dev,
                "parent",
                "1:1",
                "classid",
                &format!("1:{}", 100 + index),
                "htb",
                "rate",
                &Self::rate(limit.group_down_kbps),
                "ceil",
                &Self::rate(limit.group_down_kbps),
            ])?;
        }

        for plan in &plans {
            self.run(&[
                "class",
                "replace",
                "dev",
                dev,
                "parent",
                &plan.user_class,
                "classid",
                &plan.device_class,
                "htb",
                "rate",
                &Self::rate(plan.peer.down_kbps),
                "ceil",
                &Self::rate(plan.peer.down_kbps),
            ])?;
            self.run(&[
                "filter",
                "add",
                "dev",
                dev,
                "protocol",
                "ip",
                "parent",
                "1:",
                "prio",
                "1",
                "u32",
                "match",
                "ip",
                "dst",
                &format!("{}/32", plan.ip),
                "flowid",
                &plan.device_class,
            ])?;
        }
        Ok(())
    }

    fn apply_ingress(&self, interface: &DesiredInterface) -> Result<()> {
        let dev = &interface.name;
        let ifb = ifb_name(dev);
        let plans = Self::plan(interface, Direction::Up);
        if plans.is_empty() && interface.user_limits.is_empty() {
            return Ok(());
        }

        if !self.dry_run {
            let _ = Command::new("modprobe").arg("ifb").output();
            let exists = Command::new("ip")
                .args(["link", "show", &ifb])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if !exists {
                self.run_ip(&["link", "add", &ifb, "type", "ifb"])?;
            }
        } else {
            self.run_ip(&["link", "add", &ifb, "type", "ifb"])?;
        }
        self.run_ip(&["link", "set", "dev", &ifb, "up"])?;

        let ingress = ingress_reset_commands(dev);
        self.run_owned_optional(&ingress[0])?;
        self.run_owned(&ingress[1])?;
        self.run(&[
            "filter", "add", "dev", dev, "parent", "ffff:", "protocol", "ip", "u32", "match",
            "u32", "0", "0", "action", "mirred", "egress", "redirect", "dev", &ifb,
        ])?;

        let ifb_reset = root_reset_commands(&ifb);
        self.run_owned_optional(&ifb_reset[0])?;
        self.run_owned(&ifb_reset[1])?;
        self.run(&[
            "class",
            "replace",
            "dev",
            &ifb,
            "parent",
            "1:",
            "classid",
            "1:1",
            "htb",
            "rate",
            &Self::root_rate(interface, Direction::Up),
            "ceil",
            &Self::root_rate(interface, Direction::Up),
        ])?;

        let mut seen_users = Vec::new();
        for limit in &interface.user_limits {
            if seen_users.contains(&limit.user_id) {
                continue;
            }
            seen_users.push(limit.user_id);
            let index = seen_users.len() - 1;
            self.run(&[
                "class",
                "replace",
                "dev",
                &ifb,
                "parent",
                "1:1",
                "classid",
                &format!("1:{}", 100 + index),
                "htb",
                "rate",
                &Self::rate(limit.group_up_kbps),
                "ceil",
                &Self::rate(limit.group_up_kbps),
            ])?;
        }

        for plan in &plans {
            self.run(&[
                "class",
                "replace",
                "dev",
                &ifb,
                "parent",
                &plan.user_class,
                "classid",
                &plan.device_class,
                "htb",
                "rate",
                &Self::rate(plan.peer.up_kbps),
                "ceil",
                &Self::rate(plan.peer.up_kbps),
            ])?;
            self.run(&[
                "filter",
                "add",
                "dev",
                &ifb,
                "protocol",
                "ip",
                "parent",
                "1:",
                "prio",
                "1",
                "u32",
                "match",
                "ip",
                "src",
                &format!("{}/32", plan.ip),
                "flowid",
                &plan.device_class,
            ])?;
        }
        Ok(())
    }
}

#[async_trait]
impl TrafficShaper for TcShaper {
    async fn apply(&self, interface: &DesiredInterface) -> Result<()> {
        let needed = !interface.user_limits.is_empty()
            || interface
                .peers
                .iter()
                .any(|p| p.down_kbps > 0 || p.up_kbps > 0);
        if !needed {
            return Ok(());
        }
        self.apply_egress(interface)?;
        self.apply_ingress(interface)
    }

    async fn clear(&self, name: &str) -> Result<()> {
        let _ = self.run(&["qdisc", "del", "dev", name, "root"]);
        let _ = self.run(&["qdisc", "del", "dev", name, "ingress"]);
        let ifb = ifb_name(name);
        let _ = self.run(&["qdisc", "del", "dev", &ifb, "root"]);
        let _ = self.run_ip(&["link", "del", &ifb]);
        Ok(())
    }
}

enum Direction {
    Down,
    Up,
}

fn peer_index(interface: &DesiredInterface, peer: &DesiredPeer) -> usize {
    interface
        .peers
        .iter()
        .position(|p| p.device_id == peer.device_id)
        .unwrap_or(0)
}

fn ifb_name(name: &str) -> String {
    let mut out = String::from("ifb-");
    for ch in name.chars() {
        if out.len() >= 15 {
            break;
        }
        out.push(ch);
    }
    out
}

fn strings(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| part.to_string()).collect()
}

fn root_reset_commands(dev: &str) -> [Vec<String>; 2] {
    [
        strings(&["qdisc", "del", "dev", dev, "root"]),
        strings(&[
            "qdisc", "add", "dev", dev, "root", "handle", "1:", "htb", "default", "1",
        ]),
    ]
}

fn ingress_reset_commands(dev: &str) -> [Vec<String>; 2] {
    [
        strings(&["qdisc", "del", "dev", dev, "ingress"]),
        strings(&["qdisc", "add", "dev", dev, "handle", "ffff:", "ingress"]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_qdisc_is_recreated_without_replace() {
        let [delete, add] = root_reset_commands("awg0");
        assert_eq!(delete, strings(&["qdisc", "del", "dev", "awg0", "root"]));
        assert_eq!(
            add,
            strings(&[
                "qdisc", "add", "dev", "awg0", "root", "handle", "1:", "htb", "default", "1",
            ])
        );
        assert!(
            root_reset_commands("awg0")
                .iter()
                .flatten()
                .all(|arg| arg != "replace" && arg != "change"),
            "htb root does not support change/replace, so both must be avoided"
        );
    }

    #[test]
    fn ingress_qdisc_is_recreated_without_replace() {
        let [delete, add] = ingress_reset_commands("awg0");
        assert_eq!(delete, strings(&["qdisc", "del", "dev", "awg0", "ingress"]));
        assert_eq!(
            add,
            strings(&["qdisc", "add", "dev", "awg0", "handle", "ffff:", "ingress"])
        );
    }

    #[test]
    fn ifb_name_fits_kernel_limit() {
        assert_eq!(ifb_name("awg0"), "ifb-awg0");
        assert_eq!(ifb_name("verylongifacename"), "ifb-verylongifa");
        assert!(ifb_name("verylongifacename").len() <= 15);
    }
}
