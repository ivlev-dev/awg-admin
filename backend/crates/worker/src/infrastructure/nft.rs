use std::io::Write;
use std::process::{Command, Stdio};

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;

use crate::application::ForwardingControl;
use crate::domain::DesiredInterface;
use crate::infrastructure::tc::ifb_name;

const TABLE: &str = "awg_admin";

pub struct NftForwarding {
    dry_run: bool,
}

impl NftForwarding {
    pub fn new(dry_run: bool) -> Self {
        Self { dry_run }
    }

    fn run_ignore(&self, args: &[&str]) {
        if self.dry_run {
            tracing::info!("dry-run: nft {}", args.join(" "));
            return;
        }
        let _ = Command::new("nft").args(args).output();
    }

    fn batch(&self, script: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: nft batch\n{script}");
            return Ok(());
        }
        let mut child = Command::new("nft")
            .args(["-f", "-"])
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn nft")?;
        child
            .stdin
            .as_mut()
            .context("nft stdin is unavailable")?
            .write_all(script.as_bytes())
            .context("failed to write nft rules")?;
        let output = child.wait_with_output().context("failed to wait for nft")?;
        if !output.status.success() {
            return Err(anyhow!(
                "nft batch failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }

    fn ensure_chain(&self, chain: &str) {
        self.run_ignore(&["add", "table", "inet", TABLE]);
        let chain_spec =
            format!("add chain inet {TABLE} {chain} {{ type filter hook forward priority 10; }}");
        self.run_ignore(&[
            "add", "chain", "inet", TABLE, chain, "{", "type", "filter", "hook", "forward",
            "priority", "10;", "}",
        ]);
        let _ = chain_spec;
    }
}

#[async_trait]
impl ForwardingControl for NftForwarding {
    async fn apply(&self, interface: &DesiredInterface) -> Result<()> {
        let chain = chain_name(&interface.name);
        self.ensure_chain(&chain);
        self.batch(&forward_script(interface))
    }

    async fn clear(&self, name: &str) -> Result<()> {
        let chain = chain_name(name);
        self.run_ignore(&["flush", "chain", "inet", TABLE, &chain]);
        self.run_ignore(&["delete", "chain", "inet", TABLE, &chain]);
        Ok(())
    }
}

fn chain_name(interface: &str) -> String {
    let mut out = String::from("fwd_");
    for ch in interface.chars() {
        if out.len() >= 28 {
            break;
        }
        out.push(if ch.is_ascii_alphanumeric() || ch == '_' {
            ch
        } else {
            '_'
        });
    }
    out
}

fn forward_script(interface: &DesiredInterface) -> String {
    let chain = chain_name(&interface.name);
    let ifb = ifb_name(&interface.name);
    let ingress = format!("iifname {{ \"{}\", \"{}\" }}", interface.name, ifb);
    let egress = format!("oifname \"{}\"", interface.name);
    let mut script = format!("flush chain inet {TABLE} {chain}\n");
    for rule in &interface.forwarding {
        if rule.from_ip.is_empty() || rule.to_ip.is_empty() {
            continue;
        }
        script.push_str(&format!(
            "add rule inet {TABLE} {chain} {ingress} {egress} ip saddr {} ip daddr {} ct state established,related counter accept\n",
            rule.to_ip, rule.from_ip
        ));
        script.push_str(&format!(
            "add rule inet {TABLE} {chain} {ingress} {egress} ip saddr {} ip daddr {} counter accept\n",
            rule.from_ip, rule.to_ip
        ));
    }
    script.push_str(&format!(
        "add rule inet {TABLE} {chain} {ingress} {egress} counter drop\n"
    ));
    script
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ForwardingRule, WireObf};
    use uuid::Uuid;

    fn interface(name: &str, forwarding: Vec<ForwardingRule>) -> DesiredInterface {
        DesiredInterface {
            id: Uuid::nil(),
            name: name.to_string(),
            listen_port: 51820,
            mtu: 1420,
            private_key: String::new(),
            public_key: String::new(),
            enabled: true,
            obf: WireObf {
                h1: String::new(),
                h2: String::new(),
                h3: String::new(),
                h4: String::new(),
                s1: 0,
                s2: 0,
                s3: 0,
                s4: 0,
                header_protection_key: String::new(),
                random_trailers: false,
            },
            addresses: vec![],
            peers: vec![],
            group_down_kbps: 0,
            group_up_kbps: 0,
            user_limits: vec![],
            forwarding,
        }
    }

    fn rule(from_ip: &str, to_ip: &str) -> ForwardingRule {
        ForwardingRule {
            from_device_id: Uuid::nil(),
            to_device_id: Uuid::nil(),
            from_ip: from_ip.to_string(),
            to_ip: to_ip.to_string(),
        }
    }

    fn lines(script: &str) -> Vec<&str> {
        script.lines().collect()
    }

    fn flush_line(name: &str) -> String {
        format!("flush chain inet awg_admin {}", chain_name(name))
    }

    fn matcher(name: &str) -> String {
        let ifb = ifb_name(name);
        format!("iifname {{ \"{name}\", \"{ifb}\" }} oifname \"{name}\"")
    }

    fn established_line(name: &str, from_ip: &str, to_ip: &str) -> String {
        format!(
            "add rule inet awg_admin {} {} ip saddr {from_ip} ip daddr {to_ip} ct state established,related counter accept",
            chain_name(name),
            matcher(name)
        )
    }

    fn pair_line(name: &str, from_ip: &str, to_ip: &str) -> String {
        format!(
            "add rule inet awg_admin {} {} ip saddr {from_ip} ip daddr {to_ip} counter accept",
            chain_name(name),
            matcher(name)
        )
    }

    fn drop_line(name: &str) -> String {
        format!(
            "add rule inet awg_admin {} {} counter drop",
            chain_name(name),
            matcher(name)
        )
    }

    fn count_accepts(script: &str) -> usize {
        lines(script)
            .iter()
            .filter(|line| line.ends_with("counter accept"))
            .count()
    }

    #[test]
    fn each_pair_has_direct_accept_and_reverse_established() {
        let iface = interface("awg0", vec![rule("10.0.0.2", "10.0.0.3")]);
        let script = forward_script(&iface);
        let script_lines = lines(&script);
        assert_eq!(script_lines.len(), 4);
        assert_eq!(script_lines[0], flush_line("awg0"));
        assert_eq!(
            script_lines[1],
            established_line("awg0", "10.0.0.3", "10.0.0.2")
        );
        assert_eq!(script_lines[2], pair_line("awg0", "10.0.0.2", "10.0.0.3"));
        assert_eq!(script_lines[3], drop_line("awg0"));
        assert_eq!(count_accepts(&script), 2);
    }

    #[test]
    fn two_pairs_produce_four_accepts_before_drop() {
        let iface = interface(
            "awg0",
            vec![rule("10.0.0.2", "10.0.0.3"), rule("10.0.0.4", "10.0.0.5")],
        );
        let script = forward_script(&iface);
        let script_lines = lines(&script);
        assert_eq!(script_lines.len(), 6);
        assert_eq!(script_lines[0], flush_line("awg0"));
        assert_eq!(
            script_lines[1],
            established_line("awg0", "10.0.0.3", "10.0.0.2")
        );
        assert_eq!(script_lines[2], pair_line("awg0", "10.0.0.2", "10.0.0.3"));
        assert_eq!(
            script_lines[3],
            established_line("awg0", "10.0.0.5", "10.0.0.4")
        );
        assert_eq!(script_lines[4], pair_line("awg0", "10.0.0.4", "10.0.0.5"));
        assert_eq!(script_lines[5], drop_line("awg0"));
        assert_eq!(count_accepts(&script), 4);
    }

    #[test]
    fn pairs_keep_forwarding_order() {
        let iface = interface(
            "awg0",
            vec![
                rule("10.0.0.6", "10.0.0.7"),
                rule("10.0.0.2", "10.0.0.3"),
                rule("10.0.0.4", "10.0.0.5"),
            ],
        );
        let script = forward_script(&iface);
        assert_eq!(
            lines(&script),
            vec![
                flush_line("awg0").as_str(),
                established_line("awg0", "10.0.0.7", "10.0.0.6").as_str(),
                pair_line("awg0", "10.0.0.6", "10.0.0.7").as_str(),
                established_line("awg0", "10.0.0.3", "10.0.0.2").as_str(),
                pair_line("awg0", "10.0.0.2", "10.0.0.3").as_str(),
                established_line("awg0", "10.0.0.5", "10.0.0.4").as_str(),
                pair_line("awg0", "10.0.0.4", "10.0.0.5").as_str(),
                drop_line("awg0").as_str(),
            ]
        );
    }

    #[test]
    fn no_global_established_rule() {
        for iface in [
            interface("awg0", vec![]),
            interface("awg0", vec![rule("10.0.0.2", "10.0.0.3")]),
            interface(
                "awg0",
                vec![rule("10.0.0.2", "10.0.0.3"), rule("10.0.0.4", "10.0.0.5")],
            ),
        ] {
            let script = forward_script(&iface);
            for line in lines(&script) {
                if line.contains("ct state established,related") {
                    assert!(line.contains("ip saddr "), "global established: {line}");
                    assert!(line.contains("ip daddr "), "global established: {line}");
                    assert!(line.ends_with("counter accept"));
                    assert!(!line.ends_with("drop"));
                }
            }
        }
    }

    #[test]
    fn final_drop_is_last_and_counted() {
        let iface = interface("awg0", vec![rule("10.0.0.2", "10.0.0.3")]);
        let script = forward_script(&iface);
        let script_lines = lines(&script);
        let last = script_lines.last().copied().unwrap();
        assert_eq!(last, drop_line("awg0"));
        assert!(last.ends_with("counter drop"));
        assert_eq!(
            script_lines
                .iter()
                .filter(|line| line.ends_with("drop"))
                .count(),
            1
        );
    }

    #[test]
    fn empty_forwarding_produces_flush_and_drop() {
        let script = forward_script(&interface("awg0", vec![]));
        let expected = [flush_line("awg0"), drop_line("awg0")];
        let expected_refs: Vec<&str> = expected.iter().map(String::as_str).collect();
        assert_eq!(lines(&script), expected_refs);
        assert!(!script.contains("established"));
    }

    #[test]
    fn rules_with_empty_ip_are_skipped() {
        let iface = interface(
            "awg0",
            vec![
                rule("", "10.0.0.3"),
                rule("10.0.0.2", ""),
                rule("10.0.0.4", "10.0.0.5"),
            ],
        );
        let script = forward_script(&iface);
        let script_lines = lines(&script);
        assert_eq!(script_lines.len(), 4);
        assert_eq!(count_accepts(&script), 2);
        assert_eq!(
            script_lines[1],
            established_line("awg0", "10.0.0.5", "10.0.0.4")
        );
        assert_eq!(script_lines[2], pair_line("awg0", "10.0.0.4", "10.0.0.5"));
        assert!(!script.contains("ip saddr  ip daddr"));
        assert!(!script.contains("10.0.0.3"));
    }

    #[test]
    fn long_interface_name_uses_shared_ifb_name() {
        let name = "verylongifacename";
        let script = forward_script(&interface(name, vec![rule("10.0.0.2", "10.0.0.3")]));
        let ifb = crate::infrastructure::tc::ifb_name(name);
        assert_eq!(ifb, "ifb-verylongifa");
        assert_eq!(lines(&script).len(), 4);
        for line in lines(&script).iter().skip(1) {
            assert!(line.contains(&format!("iifname {{ \"{name}\", \"{ifb}\" }}")));
            assert!(line.contains(&format!("oifname \"{name}\"")));
        }
    }

    #[test]
    fn interface_names_keep_their_case() {
        let iface = interface("AwG-Lan0", vec![rule("10.0.0.2", "10.0.0.3")]);
        let script = forward_script(&iface);
        assert!(script.contains("iifname { \"AwG-Lan0\", \"ifb-AwG-Lan0\" }"));
        assert!(script.contains("oifname \"AwG-Lan0\""));
    }
}
