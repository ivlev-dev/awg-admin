use std::net::IpAddr;
use std::process::Stdio;

use anyhow::{Context, Result, anyhow, bail};
use async_trait::async_trait;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::application::ForwardingControl;
use crate::domain::DesiredInterface;
use crate::infrastructure::tc::{fnv1a64, ifb_name};

const TABLE: &str = "awg_admin";
const MAX_INTERFACE_NAME: usize = 15;

pub struct NftForwarding {
    dry_run: bool,
}

impl NftForwarding {
    pub fn new(dry_run: bool) -> Self {
        Self { dry_run }
    }

    async fn run(&self, args: &[&str]) -> Result<std::process::Output> {
        Command::new("nft")
            .args(args)
            .output()
            .await
            .context("failed to spawn nft")
    }

    async fn table_exists(&self) -> Result<bool> {
        Ok(self
            .run(&["list", "table", "inet", TABLE])
            .await?
            .status
            .success())
    }

    async fn chain_exists(&self, chain: &str) -> Result<bool> {
        Ok(self
            .run(&["list", "chain", "inet", TABLE, chain])
            .await?
            .status
            .success())
    }

    async fn batch(&self, script: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: nft -f -\n{script}");
            return Ok(());
        }
        let mut child = Command::new("nft")
            .args(["-f", "-"])
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn nft")?;
        let mut stdin = child.stdin.take().context("nft stdin is unavailable")?;
        stdin
            .write_all(script.as_bytes())
            .await
            .context("failed to write nft rules")?;
        // Closing stdin is what makes nft execute the batch.
        drop(stdin);
        let output = child
            .wait_with_output()
            .await
            .context("failed to wait for nft")?;
        if !output.status.success() {
            return Err(anyhow!(
                "nft batch failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
}

#[async_trait]
impl ForwardingControl for NftForwarding {
    async fn apply(&self, interface: &DesiredInterface) -> Result<()> {
        validate_interface_name(&interface.name)?;
        let chain = chain_name(&interface.name);

        if self.dry_run {
            let script = forward_script(interface, true, true)?;
            tracing::info!("dry-run: nft -f -\n{script}");
            return Ok(());
        }

        // `add table`/`add chain` fail when the object already exists and abort
        // the whole batch, so existence is checked first and the batch only
        // contains the statements that are safe for the current state.
        let table_exists = self.table_exists().await?;
        let chain_exists = if table_exists {
            self.chain_exists(&chain).await?
        } else {
            false
        };
        let script = forward_script(interface, table_exists, chain_exists)?;
        self.batch(&script).await
    }

    async fn clear(&self, name: &str) -> Result<()> {
        let chain = chain_name(name);
        if self.dry_run {
            tracing::info!("dry-run: nft delete chain inet {TABLE} {chain}");
            return Ok(());
        }
        if !self.table_exists().await? || !self.chain_exists(&chain).await? {
            return Ok(());
        }
        self.batch(&format!(
            "flush chain inet {TABLE} {chain}\ndelete chain inet {TABLE} {chain}\n"
        ))
        .await
    }
}

fn validate_interface_name(name: &str) -> Result<()> {
    if name.is_empty() {
        bail!("interface name must not be empty");
    }
    if name.len() > MAX_INTERFACE_NAME {
        bail!("interface name {name:?} is longer than {MAX_INTERFACE_NAME} characters");
    }
    if name == "." || name == ".." {
        bail!("interface name {name:?} is reserved");
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '@'))
    {
        bail!("interface name {name:?} contains characters that are unsafe for nft rules");
    }
    Ok(())
}

pub fn chain_name(interface: &str) -> String {
    let sanitized: String = interface
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
        .take(20)
        .collect();
    let hash = fnv1a64(interface.as_bytes()) & 0xff_ffff;
    format!("fwd_{sanitized}_{hash:06x}")
}

fn forward_script(
    interface: &DesiredInterface,
    table_exists: bool,
    chain_exists: bool,
) -> Result<String> {
    validate_interface_name(&interface.name)?;
    let chain = chain_name(&interface.name);
    let ifb = ifb_name(&interface.name);
    let ingress = format!("iifname {{ \"{}\", \"{}\" }}", interface.name, ifb);
    let egress = format!("oifname \"{}\"", interface.name);

    let mut script = String::new();
    if !table_exists {
        script.push_str(&format!("add table inet {TABLE}\n"));
    }
    if !chain_exists {
        script.push_str(&format!(
            "add chain inet {TABLE} {chain} {{ type filter hook forward priority 10; }}\n"
        ));
    }
    script.push_str(&format!("flush chain inet {TABLE} {chain}\n"));

    for rule in &interface.forwarding {
        let from = rule.from_ip.trim();
        let to = rule.to_ip.trim();
        // An empty address means the rule is not ready yet. Skipping it fails
        // closed: the trailing drop rule still blocks forwarding.
        if from.is_empty() || to.is_empty() {
            tracing::warn!(
                interface = %interface.name,
                from_ip = %rule.from_ip,
                to_ip = %rule.to_ip,
                "skipping forwarding rule without both addresses"
            );
            continue;
        }
        let from_ip: IpAddr = from.parse().with_context(|| {
            format!(
                "interface {} has invalid forwarding from_ip {:?}",
                interface.name, rule.from_ip
            )
        })?;
        let to_ip: IpAddr = to.parse().with_context(|| {
            format!(
                "interface {} has invalid forwarding to_ip {:?}",
                interface.name, rule.to_ip
            )
        })?;
        // Normalised formatting keeps the text free of anything an address
        // parser would not produce (no quotes, semicolons or newlines).
        let (family, from_ip, to_ip) = match (from_ip, to_ip) {
            (IpAddr::V4(from), IpAddr::V4(to)) => ("ip", from.to_string(), to.to_string()),
            (IpAddr::V6(from), IpAddr::V6(to)) => ("ip6", from.to_string(), to.to_string()),
            _ => bail!(
                "interface {} forwarding rule mixes IPv4 and IPv6 addresses",
                interface.name
            ),
        };
        script.push_str(&format!(
            "add rule inet {TABLE} {chain} {ingress} {egress} {family} saddr {to_ip} {family} daddr {from_ip} ct state established,related counter accept\n"
        ));
        script.push_str(&format!(
            "add rule inet {TABLE} {chain} {ingress} {egress} {family} saddr {from_ip} {family} daddr {to_ip} counter accept\n"
        ));
    }

    script.push_str(&format!(
        "add rule inet {TABLE} {chain} {ingress} {egress} counter drop\n"
    ));
    Ok(script)
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

    fn script(iface: &DesiredInterface) -> String {
        forward_script(iface, true, true).expect("script")
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
        let script = script(&iface);
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
        let script = script(&iface);
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
        let script = script(&iface);
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
            let script = script(&iface);
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
        let script = script(&iface);
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
        let script = script(&interface("awg0", vec![]));
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
        let script = script(&iface);
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
    fn long_interface_name_uses_shared_hashed_ifb_name() {
        let name = "verylongifacenm";
        let iface = interface(name, vec![rule("10.0.0.2", "10.0.0.3")]);
        let script = script(&iface);
        let ifb = ifb_name(name);
        assert_eq!(lines(&script).len(), 4);
        for line in lines(&script).iter().skip(1) {
            assert!(line.contains(&format!("iifname {{ \"{name}\", \"{ifb}\" }}")));
            assert!(line.contains(&format!("oifname \"{name}\"")));
        }
    }

    #[test]
    fn interface_names_keep_their_case() {
        let iface = interface("AwG-Lan0", vec![rule("10.0.0.2", "10.0.0.3")]);
        let script = script(&iface);
        assert!(script.contains("iifname { \"AwG-Lan0\", \"ifb-"));
        assert!(script.contains("oifname \"AwG-Lan0\""));
    }

    #[test]
    fn invalid_interface_names_never_reach_the_script() {
        for name in [
            "awg0;flush ruleset",
            "awg\"0",
            "awg 0",
            "awg0\nflush ruleset",
            "awg0)`id`{",
            "verylonginterfacename",
            "",
        ] {
            let iface = interface(name, vec![rule("10.0.0.2", "10.0.0.3")]);
            assert!(
                forward_script(&iface, true, true).is_err(),
                "name {name:?} must be rejected"
            );
        }
    }

    #[test]
    fn invalid_forwarding_ip_is_an_error() {
        let iface = interface(
            "awg0",
            vec![rule(
                "10.0.0.2\" accept\nadd rule inet awg_admin fwd_awg0 counter accept",
                "10.0.0.3",
            )],
        );
        let error = forward_script(&iface, true, true).expect_err("must reject");
        assert!(format!("{error:#}").contains("from_ip"), "{error:#}");
    }

    #[test]
    fn ipv6_rules_use_the_ip6_family() {
        let iface = interface("awg0", vec![rule("fd00::2", "fd00::3")]);
        let script = script(&iface);
        assert!(script.contains("ip6 saddr fd00::3 ip6 daddr fd00::2"));
        assert!(script.contains("ip6 saddr fd00::2 ip6 daddr fd00::3"));
    }

    #[test]
    fn mixed_families_are_rejected() {
        let iface = interface("awg0", vec![rule("10.0.0.2", "fd00::3")]);
        assert!(forward_script(&iface, true, true).is_err());
    }

    #[test]
    fn missing_table_and_chain_are_created_in_the_same_batch() {
        let iface = interface("awg0", vec![]);
        let script = forward_script(&iface, false, false).expect("script");
        let chain = chain_name("awg0");
        assert_eq!(lines(&script)[0], "add table inet awg_admin".to_string());
        assert_eq!(
            lines(&script)[1],
            format!("add chain inet awg_admin {chain} {{ type filter hook forward priority 10; }}")
        );
        assert_eq!(
            lines(&script)[2],
            format!("flush chain inet awg_admin {chain}")
        );
    }

    #[test]
    fn existing_objects_are_only_flushed() {
        let iface = interface("awg0", vec![]);
        let script = forward_script(&iface, true, true).expect("script");
        assert!(!script.contains("add table"));
        assert!(!script.contains("add chain"));
        assert!(script.starts_with(&format!(
            "flush chain inet awg_admin {}",
            chain_name("awg0")
        )));
    }

    #[test]
    fn chain_names_are_collision_free() {
        assert_ne!(chain_name("awg-1"), chain_name("awg_1"));
        assert_ne!(chain_name("awg0"), chain_name("awg1"));
        assert!(chain_name("awg0").starts_with("fwd_awg0_"));
    }
}
