use std::io::Write;
use std::process::{Command, Stdio};

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;

use crate::application::ForwardingControl;
use crate::domain::DesiredInterface;

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

        let mut script = format!("flush chain inet {TABLE} {chain}\n");
        for rule in &interface.forwarding {
            if rule.from_ip.is_empty() || rule.to_ip.is_empty() {
                continue;
            }
            script.push_str(&format!(
                "add rule inet {TABLE} {chain} iifname \"{}\" oifname \"{}\" ip saddr {} ip daddr {} accept\n",
                interface.name, interface.name, rule.from_ip, rule.to_ip
            ));
        }
        script.push_str(&format!(
            "add rule inet {TABLE} {chain} iifname \"{}\" oifname \"{}\" drop\n",
            interface.name, interface.name
        ));
        self.batch(&script)
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
