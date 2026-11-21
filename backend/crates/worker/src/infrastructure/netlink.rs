use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::Mutex;

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use genetlink::{GenetlinkHandle, new_connection};
use netlink_packet_amnezia_wireguard::constants::{
    WGPEER_F_REMOVE_ME, WGPEER_F_REPLACE_ALLOWEDIPS,
};
use netlink_packet_amnezia_wireguard::{
    AmneziaWireguardAddressFamily, AmneziaWireguardAllowedIp, AmneziaWireguardAllowedIpAttr,
    AmneziaWireguardAttribute, AmneziaWireguardCmd, AmneziaWireguardMessage, AmneziaWireguardPeer,
    AmneziaWireguardPeerAttribute,
};
use netlink_packet_core::{NLM_F_ACK, NLM_F_DUMP, NLM_F_REQUEST, NetlinkMessage, NetlinkPayload};
use netlink_packet_generic::GenlMessage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::process::Command;
use tokio::task::JoinHandle;

use crate::application::AwgControl;
use crate::domain::{DesiredInterface, DesiredPeer, InterfaceRuntime, PeerRuntime};

const PSK_STATE_VERSION: u32 = 1;

pub struct NetlinkAwg {
    dry_run: bool,
    psk: Mutex<PskStore>,
    netlink: tokio::sync::Mutex<Option<NetlinkConnection>>,
}

struct NetlinkConnection {
    handle: GenetlinkHandle,
    task: JoinHandle<()>,
}

struct PeerDelta<'a> {
    upserts: Vec<&'a DesiredPeer>,
    removes: Vec<String>,
}

impl PeerDelta<'_> {
    fn is_empty(&self) -> bool {
        self.upserts.is_empty() && self.removes.is_empty()
    }
}

impl NetlinkAwg {
    pub fn new(dry_run: bool) -> Self {
        Self::with_psk_state(dry_run, None)
    }

    /// `psk_path` is the persistence file for applied PSKs (hashes only).
    pub fn with_psk_state(dry_run: bool, psk_path: Option<PathBuf>) -> Self {
        Self {
            dry_run,
            psk: Mutex::new(PskStore::load(psk_path)),
            netlink: tokio::sync::Mutex::new(None),
        }
    }

    fn log_dry_run(&self, program: &str, args: &[&str]) -> bool {
        if !self.dry_run {
            return false;
        }
        tracing::info!("dry-run: {program} {}", args.join(" "));
        true
    }

    async fn command(&self, program: &str, args: &[&str]) -> Result<Output> {
        Command::new(program)
            .args(args)
            .output()
            .await
            .with_context(|| format!("failed to spawn {program}"))
    }

    async fn run(&self, program: &str, args: &[&str]) -> Result<()> {
        if self.log_dry_run(program, args) {
            return Ok(());
        }
        let output = self.command(program, args).await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{} {} failed: {}",
                program,
                args.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }

    async fn capture(&self, program: &str, args: &[&str]) -> Result<String> {
        if self.log_dry_run(program, args) {
            return Ok(String::new());
        }
        let output = self.command(program, args).await?;
        if !output.status.success() {
            return Err(anyhow!(
                "{} {} failed: {}",
                program,
                args.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    async fn interface_exists(&self, name: &str) -> Result<bool> {
        if self.dry_run {
            self.log_dry_run("ip", &["link", "show", name]);
            return Ok(false);
        }
        let output = self.command("ip", &["link", "show", name]).await?;
        Ok(output.status.success())
    }

    async fn netlink_handle(&self) -> Result<GenetlinkHandle> {
        let mut guard = self.netlink.lock().await;
        if let Some(connection) = guard.as_ref()
            && !connection.task.is_finished()
        {
            return Ok(connection.handle.clone());
        }
        if let Some(stale) = guard.take() {
            stale.task.abort();
        }
        let (connection, handle, _) = new_connection().context("open netlink connection")?;
        let task = tokio::spawn(connection);
        *guard = Some(NetlinkConnection {
            handle: handle.clone(),
            task,
        });
        Ok(handle)
    }

    async fn reset_netlink(&self) {
        if let Some(connection) = self.netlink.lock().await.take() {
            connection.task.abort();
        }
    }

    /// Reuses one generic netlink connection instead of opening (and
    /// detaching) one socket per request.
    async fn request(
        &self,
        nlmsg: NetlinkMessage<GenlMessage<AmneziaWireguardMessage>>,
    ) -> Result<Vec<AmneziaWireguardMessage>> {
        let mut handle = self.netlink_handle().await?;
        match request_with(&mut handle, nlmsg).await {
            Ok(messages) => Ok(messages),
            Err(error) => {
                self.reset_netlink().await;
                Err(error)
            }
        }
    }

    async fn reconcile_addresses(&self, interface: &DesiredInterface) -> Result<()> {
        let current = self
            .capture("ip", &["-o", "addr", "show", "dev", &interface.name])
            .await?;
        let desired: HashSet<String> = interface
            .addresses
            .iter()
            .map(|address| normalize_cidr(address))
            .collect();
        for address in parse_ip_addresses(&current) {
            if is_link_local_cidr(&address) || desired.contains(&normalize_cidr(&address)) {
                continue;
            }
            tracing::info!(
                interface = %interface.name,
                address = %address,
                "removing address that is no longer desired"
            );
            self.run("ip", &["addr", "del", &address, "dev", &interface.name])
                .await?;
        }
        for address in &interface.addresses {
            self.run("ip", &["addr", "replace", address, "dev", &interface.name])
                .await?;
        }
        Ok(())
    }
}

#[async_trait]
impl AwgControl for NetlinkAwg {
    async fn ensure_interface(&self, interface: &DesiredInterface) -> Result<()> {
        let exists = self.interface_exists(&interface.name).await?;
        if !exists {
            self.run(
                "ip",
                &["link", "add", "dev", &interface.name, "type", "amneziawg"],
            )
            .await?;
        }
        if self.dry_run {
            tracing::info!(
                "dry-run: configure {} mtu {} addresses {:?}",
                interface.name,
                interface.mtu,
                interface.addresses
            );
            return Ok(());
        }
        self.run(
            "ip",
            &[
                "link",
                "set",
                "dev",
                &interface.name,
                "mtu",
                &interface.mtu.to_string(),
            ],
        )
        .await?;
        self.reconcile_addresses(interface).await?;
        self.run("ip", &["link", "set", "dev", &interface.name, "up"])
            .await?;
        Ok(())
    }

    async fn apply_interface(&self, interface: &DesiredInterface) -> Result<()> {
        if self.dry_run {
            tracing::info!(
                "dry-run: netlink set {} peers={}",
                interface.name,
                interface.peers.len()
            );
            return Ok(());
        }
        let private_key = decode_key(&interface.private_key)?;
        let applied_psk = self
            .psk
            .lock()
            .expect("applied psk lock")
            .for_interface(&interface.name);

        let (delta, existing, replace_all_allowed_ips) = match dump(self, &interface.name).await {
            Ok(messages) => {
                let runtime = interface_runtime(&messages, &interface.name).unwrap_or_default();
                let existing: HashSet<String> = runtime
                    .peers
                    .iter()
                    .map(|peer| peer.public_key.clone())
                    .collect();
                (
                    peer_delta(&interface.peers, &runtime.peers, Some(&applied_psk)),
                    existing,
                    false,
                )
            }
            Err(error) => {
                tracing::warn!(
                    interface = %interface.name,
                    %error,
                    "netlink dump failed, upserting every desired peer"
                );
                (
                    PeerDelta {
                        upserts: interface.peers.iter().collect(),
                        removes: Vec::new(),
                    },
                    HashSet::new(),
                    true,
                )
            }
        };

        let mut attributes = vec![
            AmneziaWireguardAttribute::IfName(interface.name.clone()),
            AmneziaWireguardAttribute::PrivateKey(private_key),
            AmneziaWireguardAttribute::ListenPort(interface.listen_port),
            AmneziaWireguardAttribute::Fwmark(0),
            AmneziaWireguardAttribute::S1(interface.obf.s1),
            AmneziaWireguardAttribute::S2(interface.obf.s2),
            AmneziaWireguardAttribute::S3(interface.obf.s3),
            AmneziaWireguardAttribute::S4(interface.obf.s4),
            AmneziaWireguardAttribute::H1Range(pack_range(&interface.obf.h1)?),
            AmneziaWireguardAttribute::H2Range(pack_range(&interface.obf.h2)?),
            AmneziaWireguardAttribute::H3Range(pack_range(&interface.obf.h3)?),
            AmneziaWireguardAttribute::H4Range(pack_range(&interface.obf.h4)?),
            AmneziaWireguardAttribute::RandomTrailers(interface.obf.random_trailers),
        ];
        if !interface.obf.header_protection_key.is_empty() {
            attributes.push(AmneziaWireguardAttribute::HeaderProtectionKey(decode_key(
                &interface.obf.header_protection_key,
            )?));
        }
        if !delta.is_empty() {
            attributes.push(AmneziaWireguardAttribute::Peers(peer_updates(
                &delta,
                &existing,
                replace_all_allowed_ips,
            )?));
        }

        let msg = AmneziaWireguardMessage {
            cmd: AmneziaWireguardCmd::SetDevice,
            attributes,
        };
        self.request(netlink_set_message(msg)).await?;

        let snapshot: Vec<(String, String)> = interface
            .peers
            .iter()
            .map(|peer| (peer.public_key.clone(), psk_hash(&peer.preshared_key)))
            .collect();
        {
            // Persist hashes (never the PSK itself) so a rotated or removed
            // key is still detected after a worker restart.
            let mut store = self.psk.lock().expect("applied psk lock");
            store.replace_interface(&interface.name, &snapshot);
            if let Err(error) = store.persist() {
                tracing::warn!(
                    interface = %interface.name,
                    %error,
                    "failed to persist applied PSK state; PSK rotation may be missed after restart"
                );
            }
        }
        Ok(())
    }

    async fn teardown(&self, name: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: ip link del dev {name}");
            return Ok(());
        }
        let output = self.command("ip", &["link", "del", "dev", name]).await?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !device_is_missing(&stderr) {
                return Err(anyhow!("ip link del dev {name} failed: {stderr}"));
            }
            tracing::debug!(interface = %name, "interface is already gone");
        }
        {
            let mut store = self.psk.lock().expect("applied psk lock");
            store.remove_interface(name);
            if let Err(error) = store.persist() {
                tracing::warn!(interface = %name, %error, "failed to persist PSK state");
            }
        }
        Ok(())
    }

    async fn read_interface(&self, interface: &DesiredInterface) -> Result<InterfaceRuntime> {
        if self.dry_run {
            return Ok(InterfaceRuntime::default());
        }
        let messages = dump(self, &interface.name).await?;
        interface_runtime(&messages, &interface.name)
            .ok_or_else(|| anyhow!("netlink dump returned no device for {}", interface.name))
    }

    async fn list_interfaces(&self) -> Result<Vec<String>> {
        // Read-only, so it also runs in dry-run: ReconcileService then logs
        // the interfaces it would delete (teardown is a dry-run no-op).
        let output = self
            .command("ip", &["-o", "-d", "link", "show", "type", "amneziawg"])
            .await?;
        if !output.status.success() {
            // The module may not be loaded yet on a fresh node; there is
            // nothing to clean up in that case.
            tracing::debug!(
                error = %String::from_utf8_lossy(&output.stderr).trim(),
                "no amneziawg interfaces discovered"
            );
            return Ok(Vec::new());
        }
        Ok(parse_amneziawg_links(&String::from_utf8_lossy(
            &output.stdout,
        )))
    }
}

fn netlink_set_message(
    msg: AmneziaWireguardMessage,
) -> NetlinkMessage<GenlMessage<AmneziaWireguardMessage>> {
    let mut nlmsg = NetlinkMessage::from(GenlMessage::from_payload(msg));
    nlmsg.header.flags = NLM_F_REQUEST | NLM_F_ACK;
    nlmsg
}

async fn dump(awg: &NetlinkAwg, name: &str) -> Result<Vec<AmneziaWireguardMessage>> {
    awg.request(get_device_request(name)).await
}

fn get_device_request(name: &str) -> NetlinkMessage<GenlMessage<AmneziaWireguardMessage>> {
    let msg = AmneziaWireguardMessage {
        cmd: AmneziaWireguardCmd::GetDevice,
        attributes: vec![AmneziaWireguardAttribute::IfName(name.to_string())],
    };
    let mut nlmsg = NetlinkMessage::from(GenlMessage::from_payload(msg));
    nlmsg.header.flags = NLM_F_REQUEST | NLM_F_DUMP;
    nlmsg
}

async fn request_with(
    handle: &mut GenetlinkHandle,
    nlmsg: NetlinkMessage<GenlMessage<AmneziaWireguardMessage>>,
) -> Result<Vec<AmneziaWireguardMessage>> {
    let mut stream = handle
        .request(nlmsg)
        .await
        .map_err(|e| anyhow!("netlink request failed: {e}"))?;

    let mut messages = Vec::new();
    while let Some(packet) = stream.next().await {
        let packet = packet.map_err(|e| anyhow!("netlink response error: {e}"))?;
        match packet.payload {
            NetlinkPayload::InnerMessage(genl) => messages.push(genl.payload),
            NetlinkPayload::Done(_) => break,
            NetlinkPayload::Error(error) => {
                let io = error.to_io();
                if io.raw_os_error() == Some(0) {
                    continue;
                }
                return Err(anyhow!("kernel rejected request: {io}"));
            }
            NetlinkPayload::Overrun(_) => {
                return Err(anyhow!("netlink dump overrun: response truncated"));
            }
            _ => continue,
        }
    }
    Ok(messages)
}

fn parse_amneziawg_links(output: &str) -> Vec<String> {
    let mut names: Vec<String> = output
        .lines()
        .filter(|line| line.contains("amneziawg"))
        .filter_map(|line| {
            let (_, rest) = line.split_once(':')?;
            let name = rest.trim_start().split(':').next()?.trim();
            let name = name.split('@').next()?;
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect();
    names.sort();
    names.dedup();
    names
}

fn parse_ip_addresses(output: &str) -> Vec<String> {
    let mut addresses = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        for (index, token) in tokens.iter().enumerate() {
            if (*token == "inet" || *token == "inet6")
                && let Some(cidr) = tokens.get(index + 1)
            {
                addresses.push((*cidr).to_string());
            }
        }
    }
    addresses.sort();
    addresses.dedup();
    addresses
}

fn is_link_local_cidr(cidr: &str) -> bool {
    let Some((address, _)) = cidr.split_once('/') else {
        return false;
    };
    match address.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => v4.is_link_local(),
        Ok(IpAddr::V6(v6)) => v6.is_unicast_link_local(),
        Err(_) => false,
    }
}

fn device_is_missing(stderr: &str) -> bool {
    let stderr = stderr.to_ascii_lowercase();
    stderr.contains("cannot find device")
        || stderr.contains("does not exist")
        || stderr.contains("no such device")
}

fn interface_runtime(messages: &[AmneziaWireguardMessage], name: &str) -> Option<InterfaceRuntime> {
    let mut runtime = InterfaceRuntime::default();
    let mut current: Option<&str> = None;
    let mut matched = false;

    for message in messages {
        for attribute in &message.attributes {
            if let AmneziaWireguardAttribute::IfName(ifname) = attribute {
                current = Some(ifname);
            }
        }
        if current.is_some_and(|ifname| ifname != name) {
            continue;
        }
        matched = true;
        for attribute in &message.attributes {
            let AmneziaWireguardAttribute::Peers(list) = attribute else {
                continue;
            };
            for peer in list {
                if let Some(peer) = peer_runtime(peer) {
                    runtime.peers.push(peer);
                }
            }
        }
    }

    matched.then_some(runtime)
}

fn peer_runtime(peer: &AmneziaWireguardPeer) -> Option<PeerRuntime> {
    let mut runtime = PeerRuntime::default();
    for attribute in &peer.0 {
        match attribute {
            AmneziaWireguardPeerAttribute::PublicKey(key) => {
                runtime.public_key = STANDARD.encode(key);
            }
            AmneziaWireguardPeerAttribute::AllowedIps(list) => {
                runtime.allowed_ips = list.iter().filter_map(allowed_ip_cidr).collect();
            }
            AmneziaWireguardPeerAttribute::RxBytes(value) => runtime.rx_bytes = *value,
            AmneziaWireguardPeerAttribute::TxBytes(value) => runtime.tx_bytes = *value,
            AmneziaWireguardPeerAttribute::LastHandshake(time) => {
                runtime.last_handshake = time.seconds;
            }
            _ => {}
        }
    }
    (!runtime.public_key.is_empty()).then_some(runtime)
}

fn allowed_ip_cidr(allowed: &AmneziaWireguardAllowedIp) -> Option<String> {
    let mut address = None;
    let mut cidr = None;
    for attribute in &allowed.0 {
        match attribute {
            AmneziaWireguardAllowedIpAttr::IpAddr(value) => address = Some(*value),
            AmneziaWireguardAllowedIpAttr::Cidr(value) => cidr = Some(*value),
            _ => {}
        }
    }
    Some(format!("{}/{}", address?, cidr?))
}

fn peer_delta<'a>(
    desired: &'a [DesiredPeer],
    runtime: &[PeerRuntime],
    applied_psk: Option<&HashMap<String, String>>,
) -> PeerDelta<'a> {
    let mut current: HashMap<&str, &PeerRuntime> = HashMap::new();
    for peer in runtime {
        current.entry(peer.public_key.as_str()).or_insert(peer);
    }
    let desired_keys: HashSet<&str> = desired
        .iter()
        .map(|peer| peer.public_key.as_str())
        .collect();

    let mut upserts = Vec::new();
    for peer in desired {
        let needs_upsert = match current.get(peer.public_key.as_str()) {
            None => true,
            Some(runtime_peer) => {
                !same_allowed_ips(&peer.allowed_ips, &runtime_peer.allowed_ips)
                    || applied_psk
                        .and_then(|map| map.get(&peer.public_key))
                        .is_some_and(|known| known != &psk_hash(&peer.preshared_key))
            }
        };
        if needs_upsert {
            upserts.push(peer);
        }
    }

    let mut seen = HashSet::new();
    let mut removes = Vec::new();
    for peer in runtime {
        if desired_keys.contains(peer.public_key.as_str()) {
            continue;
        }
        if seen.insert(peer.public_key.as_str()) {
            removes.push(peer.public_key.clone());
        }
    }

    PeerDelta { upserts, removes }
}

fn same_allowed_ips(left: &[String], right: &[String]) -> bool {
    let left: HashSet<String> = left.iter().map(|cidr| normalize_cidr(cidr)).collect();
    let right: HashSet<String> = right.iter().map(|cidr| normalize_cidr(cidr)).collect();
    left == right
}

fn normalize_cidr(cidr: &str) -> String {
    let value = cidr.trim();
    let Some((address, prefix)) = value.split_once('/') else {
        return value.to_string();
    };
    let (Ok(address), Ok(prefix)) = (address.parse::<IpAddr>(), prefix.parse::<u8>()) else {
        return value.to_string();
    };
    let masked = match address {
        IpAddr::V4(v4) => IpAddr::V4(Ipv4Addr::from(u32::from(v4) & prefix_mask_v4(prefix))),
        IpAddr::V6(v6) => IpAddr::V6(Ipv6Addr::from(u128::from(v6) & prefix_mask_v6(prefix))),
    };
    format!("{masked}/{prefix}")
}

fn prefix_mask_v4(prefix: u8) -> u32 {
    let prefix = prefix.min(32);
    if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix as u32)
    }
}

fn prefix_mask_v6(prefix: u8) -> u128 {
    let prefix = prefix.min(128);
    if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix as u32)
    }
}

fn peer_updates(
    delta: &PeerDelta<'_>,
    existing: &HashSet<String>,
    replace_all_allowed_ips: bool,
) -> Result<Vec<AmneziaWireguardPeer>> {
    let mut peers = Vec::with_capacity(delta.upserts.len() + delta.removes.len());
    for peer in &delta.upserts {
        let replace_allowed_ips = replace_all_allowed_ips || existing.contains(&peer.public_key);
        peers.push(peer_attributes(peer, replace_allowed_ips)?);
    }
    for public_key in &delta.removes {
        peers.push(AmneziaWireguardPeer(vec![
            AmneziaWireguardPeerAttribute::PublicKey(decode_key(public_key)?),
            AmneziaWireguardPeerAttribute::Flags(WGPEER_F_REMOVE_ME),
        ]));
    }
    Ok(peers)
}

fn peer_attributes(peer: &DesiredPeer, replace_allowed_ips: bool) -> Result<AmneziaWireguardPeer> {
    let public_key = decode_key(&peer.public_key)?;
    // An explicit all-zero PSK is required to remove an existing key: omitting
    // the attribute leaves the old PSK in the kernel.
    let preshared_key = if peer.preshared_key.trim().is_empty() {
        [0u8; 32]
    } else {
        decode_key(&peer.preshared_key)?
    };
    let mut attributes = vec![
        AmneziaWireguardPeerAttribute::PublicKey(public_key),
        AmneziaWireguardPeerAttribute::AllowedIps(
            peer.allowed_ips
                .iter()
                .map(|cidr| allowed_ip(cidr))
                .collect::<Result<Vec<_>>>()?,
        ),
        AmneziaWireguardPeerAttribute::PersistentKeepaliveRange(25 | (25 << 16)),
        AmneziaWireguardPeerAttribute::PresharedKey(preshared_key),
    ];
    if replace_allowed_ips {
        attributes.push(AmneziaWireguardPeerAttribute::Flags(
            WGPEER_F_REPLACE_ALLOWEDIPS,
        ));
    }
    Ok(AmneziaWireguardPeer(attributes))
}

fn allowed_ip(cidr: &str) -> Result<AmneziaWireguardAllowedIp> {
    let (address, prefix) = cidr
        .split_once('/')
        .ok_or_else(|| anyhow!("allowed ip {cidr:?} has no prefix"))?;
    let ip: IpAddr = address
        .parse()
        .with_context(|| format!("invalid allowed ip {cidr:?}"))?;
    let cidr_len: u8 = prefix.parse().context("invalid CIDR prefix")?;
    let (family, ip) = match ip {
        IpAddr::V4(v4) => (AmneziaWireguardAddressFamily::Ipv4, IpAddr::V4(v4)),
        IpAddr::V6(v6) => (AmneziaWireguardAddressFamily::Ipv6, IpAddr::V6(v6)),
    };
    Ok(AmneziaWireguardAllowedIp(vec![
        AmneziaWireguardAllowedIpAttr::Family(family),
        AmneziaWireguardAllowedIpAttr::IpAddr(ip),
        AmneziaWireguardAllowedIpAttr::Cidr(cidr_len),
    ]))
}

fn decode_key(value: &str) -> Result<[u8; 32]> {
    let bytes = STANDARD
        .decode(value.trim())
        .with_context(|| "key is not valid base64")?;
    bytes
        .try_into()
        .map_err(|_| anyhow!("key must be exactly 32 bytes"))
}

fn psk_hash(preshared_key: &str) -> String {
    let digest = Sha256::digest(preshared_key.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn pack_range(spec: &str) -> Result<u64> {
    let (lo, hi) = match spec.split_once('-') {
        Some((lo, hi)) => (
            lo.parse::<u32>().context("invalid H range start")?,
            hi.parse::<u32>().context("invalid H range end")?,
        ),
        None => {
            let v = spec.parse::<u32>().context("invalid H value")?;
            (v, v)
        }
    };
    Ok(lo as u64 | ((hi as u64) << 32))
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AppliedPskFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    hashes: HashMap<String, String>,
}

/// Persisted knowledge of the PSKs the kernel holds: `"<ifname>|<pubkey>"` →
/// SHA-256 of the PSK. The kernel never reports PSKs, so without this file a
/// rotation or removal made while the worker was down would be missed.
struct PskStore {
    path: Option<PathBuf>,
    hashes: HashMap<String, String>,
}

impl PskStore {
    fn load(path: Option<PathBuf>) -> Self {
        let mut store = Self {
            path,
            hashes: HashMap::new(),
        };
        store.read();
        store
    }

    fn read(&mut self) {
        let Some(path) = &self.path else {
            return;
        };
        let data = match fs::read(path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "failed to read persisted PSK state");
                return;
            }
        };
        match serde_json::from_slice::<AppliedPskFile>(&data) {
            Ok(file) => self.hashes = file.hashes,
            Err(error) => {
                tracing::warn!(
                    path = %path.display(),
                    %error,
                    "failed to parse persisted PSK state, starting empty"
                );
            }
        }
    }

    fn for_interface(&self, name: &str) -> HashMap<String, String> {
        let prefix = format!("{name}|");
        self.hashes
            .iter()
            .filter_map(|(key, hash)| {
                key.strip_prefix(&prefix)
                    .map(|public_key| (public_key.to_string(), hash.clone()))
            })
            .collect()
    }

    fn replace_interface(&mut self, name: &str, peers: &[(String, String)]) {
        let prefix = format!("{name}|");
        self.hashes.retain(|key, _| !key.starts_with(&prefix));
        for (public_key, hash) in peers {
            self.hashes
                .insert(format!("{name}|{public_key}"), hash.clone());
        }
    }

    fn remove_interface(&mut self, name: &str) {
        let prefix = format!("{name}|");
        self.hashes.retain(|key, _| !key.starts_with(&prefix));
    }

    fn persist(&self) -> Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let file = AppliedPskFile {
            version: PSK_STATE_VERSION,
            hashes: self.hashes.clone(),
        };
        let data = serde_json::to_vec(&file)?;
        let tmp = tmp_path(path);
        let mut handle =
            File::create(&tmp).with_context(|| format!("failed to create {}", tmp.display()))?;
        handle
            .write_all(&data)
            .with_context(|| format!("failed to write {}", tmp.display()))?;
        handle
            .sync_all()
            .with_context(|| format!("failed to fsync {}", tmp.display()))?;
        drop(handle);
        fs::rename(&tmp, path).with_context(|| format!("failed to replace {}", path.display()))?;
        Ok(())
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    PathBuf::from(tmp)
}

#[cfg(test)]
mod tests {
    use netlink_packet_amnezia_wireguard::AmneziaWireguardTimeSpec;
    use std::sync::atomic::{AtomicU64, Ordering};
    use uuid::Uuid;

    use super::*;

    fn temp_path() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("awg-worker-psk-{}-{unique}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join("applied-psks.json")
    }

    fn peer(key: u8, rx: u64, tx: u64, handshake: i64) -> AmneziaWireguardPeer {
        AmneziaWireguardPeer(vec![
            AmneziaWireguardPeerAttribute::PublicKey([key; 32]),
            AmneziaWireguardPeerAttribute::RxBytes(rx),
            AmneziaWireguardPeerAttribute::TxBytes(tx),
            AmneziaWireguardPeerAttribute::LastHandshake(AmneziaWireguardTimeSpec {
                seconds: handshake,
                nano_seconds: 0,
            }),
        ])
    }

    fn device(name: &str, peers: Vec<AmneziaWireguardPeer>) -> AmneziaWireguardMessage {
        AmneziaWireguardMessage {
            cmd: AmneziaWireguardCmd::GetDevice,
            attributes: vec![
                AmneziaWireguardAttribute::IfIndex(7),
                AmneziaWireguardAttribute::IfName(name.to_string()),
                AmneziaWireguardAttribute::Peers(peers),
            ],
        }
    }

    fn continuation(peers: Vec<AmneziaWireguardPeer>) -> AmneziaWireguardMessage {
        AmneziaWireguardMessage {
            cmd: AmneziaWireguardCmd::GetDevice,
            attributes: vec![AmneziaWireguardAttribute::Peers(peers)],
        }
    }

    #[test]
    fn get_device_request_uses_dump_and_name_only() {
        let nlmsg = get_device_request("awg0");
        assert_eq!(nlmsg.header.flags, NLM_F_REQUEST | NLM_F_DUMP);
        assert_ne!(nlmsg.header.flags & NLM_F_DUMP, 0);

        let NetlinkPayload::InnerMessage(genl) = nlmsg.payload else {
            panic!("expected generic netlink payload");
        };
        assert_eq!(genl.payload.cmd, AmneziaWireguardCmd::GetDevice);
        assert_eq!(
            genl.payload.attributes,
            vec![AmneziaWireguardAttribute::IfName("awg0".to_string())]
        );
        assert!(
            !genl
                .payload
                .attributes
                .iter()
                .any(|a| matches!(a, AmneziaWireguardAttribute::IfIndex(_))),
            "kernel rejects requests that set both ifname and ifindex"
        );
    }

    #[test]
    fn runtime_merges_multipart_dump_without_losing_peers() {
        let messages = vec![
            device("awg0", vec![peer(1, 100, 200, 1_700)]),
            continuation(vec![peer(2, 300, 400, 1_800), peer(3, 500, 600, 0)]),
        ];

        let runtime = interface_runtime(&messages, "awg0").expect("device found");
        assert_eq!(runtime.peers.len(), 3);
        assert_eq!(runtime.peers[0].public_key, STANDARD.encode([1u8; 32]));
        assert_eq!(runtime.peers[0].rx_bytes, 100);
        assert_eq!(runtime.peers[0].tx_bytes, 200);
        assert_eq!(runtime.peers[0].last_handshake, 1_700);
        assert_eq!(runtime.peers[2].public_key, STANDARD.encode([3u8; 32]));
        assert_eq!(runtime.peers[2].rx_bytes, 500);
        assert_eq!(runtime.peers[2].tx_bytes, 600);
        assert_eq!(runtime.peers[2].last_handshake, 0);
    }

    #[test]
    fn runtime_skips_devices_with_another_name() {
        let messages = vec![device("awg1", vec![peer(1, 1, 1, 0)])];
        assert!(interface_runtime(&messages, "awg0").is_none());
        assert!(interface_runtime(&[], "awg0").is_none());
    }

    #[test]
    fn runtime_skips_peers_without_public_key() {
        let bare = AmneziaWireguardPeer(vec![AmneziaWireguardPeerAttribute::RxBytes(9)]);
        let messages = vec![device("awg0", vec![bare, peer(4, 7, 8, 9)])];
        let runtime = interface_runtime(&messages, "awg0").expect("device found");
        assert_eq!(runtime.peers.len(), 1);
        assert_eq!(runtime.peers[0].public_key, STANDARD.encode([4u8; 32]));
    }

    fn desired(key: &str, allowed: &[&str], psk: &str) -> DesiredPeer {
        DesiredPeer {
            peer_id: Uuid::nil(),
            device_id: Uuid::nil(),
            user_id: Uuid::nil(),
            public_key: key.to_string(),
            preshared_key: psk.to_string(),
            allowed_ips: allowed.iter().map(|value| value.to_string()).collect(),
            addresses: Vec::new(),
            down_kbps: 0,
            up_kbps: 0,
        }
    }

    fn runtime_peer(key: &str, allowed: &[&str]) -> PeerRuntime {
        PeerRuntime {
            public_key: key.to_string(),
            allowed_ips: allowed.iter().map(|value| value.to_string()).collect(),
            ..PeerRuntime::default()
        }
    }

    fn flags_of(peer: &AmneziaWireguardPeer) -> Option<u32> {
        peer.0.iter().find_map(|attribute| match attribute {
            AmneziaWireguardPeerAttribute::Flags(value) => Some(*value),
            _ => None,
        })
    }

    fn psk_of(peer: &AmneziaWireguardPeer) -> Option<[u8; 32]> {
        peer.0.iter().find_map(|attribute| match attribute {
            AmneziaWireguardPeerAttribute::PresharedKey(value) => Some(*value),
            _ => None,
        })
    }

    #[test]
    fn delta_is_empty_for_identical_peers() {
        let desired_peers = vec![desired("alice", &["10.0.0.2/32"], "psk")];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];
        let psk = HashMap::from([("alice".to_string(), psk_hash("psk"))]);

        let delta = peer_delta(&desired_peers, &runtime, Some(&psk));
        assert!(delta.is_empty());
        assert!(delta.upserts.is_empty());
        assert!(delta.removes.is_empty());
    }

    #[test]
    fn delta_upserts_new_peer() {
        let desired_peers = vec![
            desired("alice", &["10.0.0.2/32"], ""),
            desired("bob", &["10.0.0.3/32"], ""),
        ];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];

        let delta = peer_delta(&desired_peers, &runtime, None);
        assert_eq!(delta.upserts.len(), 1);
        assert_eq!(delta.upserts[0].public_key, "bob");
        assert!(delta.removes.is_empty());
    }

    #[test]
    fn delta_removes_peer_missing_in_desired() {
        let desired_peers = vec![desired("alice", &["10.0.0.2/32"], "")];
        let runtime = vec![
            runtime_peer("alice", &["10.0.0.2/32"]),
            runtime_peer("bob", &["10.0.0.3/32"]),
        ];

        let delta = peer_delta(&desired_peers, &runtime, None);
        assert!(delta.upserts.is_empty());
        assert_eq!(delta.removes, vec!["bob".to_string()]);
    }

    #[test]
    fn delta_removes_every_peer_for_empty_desired() {
        let runtime = vec![
            runtime_peer("alice", &["10.0.0.2/32"]),
            runtime_peer("bob", &["10.0.0.3/32"]),
        ];

        let delta = peer_delta(&[], &runtime, None);
        assert!(delta.upserts.is_empty());
        assert_eq!(delta.removes, vec!["alice".to_string(), "bob".to_string()]);
    }

    #[test]
    fn delta_upserts_when_allowed_ips_change() {
        let desired_peers = vec![desired("alice", &["10.0.0.2/32", "10.10.0.0/24"], "")];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];

        let delta = peer_delta(&desired_peers, &runtime, None);
        assert_eq!(delta.upserts.len(), 1);
        assert_eq!(delta.upserts[0].public_key, "alice");
        assert!(delta.removes.is_empty());
    }

    #[test]
    fn delta_ignores_allowed_ips_order_and_duplicates() {
        let desired_peers = vec![desired(
            "alice",
            &["10.10.0.0/24", "10.0.0.2/32", "10.10.0.0/24"],
            "",
        )];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32", "10.10.0.0/24"])];

        let delta = peer_delta(&desired_peers, &runtime, None);
        assert!(delta.is_empty());
    }

    #[test]
    fn delta_ignores_host_bits_in_allowed_ips() {
        let desired_peers = vec![desired("alice", &["10.10.0.42/24"], "")];
        let runtime = vec![runtime_peer("alice", &["10.10.0.0/24"])];

        let delta = peer_delta(&desired_peers, &runtime, None);
        assert!(delta.is_empty());
    }

    #[test]
    fn delta_upserts_when_preshared_key_changes_after_first_apply() {
        let desired_peers = vec![desired("alice", &["10.0.0.2/32"], "new")];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];
        let psk = HashMap::from([("alice".to_string(), psk_hash("old"))]);

        let delta = peer_delta(&desired_peers, &runtime, Some(&psk));
        assert_eq!(delta.upserts.len(), 1);
        assert_eq!(delta.upserts[0].public_key, "alice");
    }

    #[test]
    fn delta_keeps_preshared_key_unknown_on_first_apply() {
        let desired_peers = vec![desired("alice", &["10.0.0.2/32"], "new")];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];

        let delta = peer_delta(&desired_peers, &runtime, None);
        assert!(delta.is_empty());
    }

    #[test]
    fn delta_deduplicates_duplicate_runtime_peers() {
        let runtime = vec![
            runtime_peer("alice", &["10.0.0.2/32"]),
            runtime_peer("alice", &["10.0.0.2/32"]),
        ];

        let delta = peer_delta(&[], &runtime, None);
        assert_eq!(delta.removes, vec!["alice".to_string()]);

        let desired_peers = vec![desired("alice", &["10.0.0.2/32"], "")];
        let delta = peer_delta(&desired_peers, &runtime, None);
        assert!(delta.is_empty());
    }

    #[test]
    fn peer_updates_flag_existing_upserts_for_allowed_ips_replacement() {
        let existing_key = STANDARD.encode([1u8; 32]);
        let desired_peers = vec![desired(&existing_key, &["10.0.0.2/32"], "")];
        let runtime = vec![runtime_peer(&existing_key, &["10.0.0.9/32"])];

        let delta = peer_delta(&desired_peers, &runtime, None);
        let existing = HashSet::from([existing_key]);
        let peers = peer_updates(&delta, &existing, false).expect("peer attributes");
        assert_eq!(peers.len(), 1);
        assert_eq!(flags_of(&peers[0]), Some(WGPEER_F_REPLACE_ALLOWEDIPS));
    }

    #[test]
    fn peer_updates_do_not_flag_new_peers() {
        let key = STANDARD.encode([2u8; 32]);
        let desired_peers = vec![desired(&key, &["10.0.0.2/32"], "")];

        let delta = peer_delta(&desired_peers, &[], None);
        let peers = peer_updates(&delta, &HashSet::new(), false).expect("peer attributes");
        assert_eq!(peers.len(), 1);
        assert_eq!(flags_of(&peers[0]), None);
    }

    #[test]
    fn peer_updates_mark_removed_peers_with_remove_flag_only() {
        let key = STANDARD.encode([3u8; 32]);
        let runtime = vec![runtime_peer(&key, &["10.0.0.2/32"])];

        let delta = peer_delta(&[], &runtime, None);
        let peers = peer_updates(&delta, &HashSet::new(), false).expect("peer attributes");
        assert_eq!(peers.len(), 1);
        assert_eq!(flags_of(&peers[0]), Some(WGPEER_F_REMOVE_ME));
        assert_eq!(
            peers[0].0,
            vec![
                AmneziaWireguardPeerAttribute::PublicKey([3u8; 32]),
                AmneziaWireguardPeerAttribute::Flags(WGPEER_F_REMOVE_ME),
            ]
        );
    }

    #[test]
    fn peer_updates_force_allowed_ips_replacement_on_dump_failure() {
        let key = STANDARD.encode([4u8; 32]);
        let desired_peers = vec![desired(&key, &["10.0.0.2/32"], "")];

        let delta = peer_delta(&desired_peers, &[], None);
        let peers = peer_updates(&delta, &HashSet::new(), true).expect("peer attributes");
        assert_eq!(peers.len(), 1);
        assert_eq!(flags_of(&peers[0]), Some(WGPEER_F_REPLACE_ALLOWEDIPS));
    }

    #[test]
    fn empty_preshared_key_is_sent_as_explicit_zero_key() {
        let key = STANDARD.encode([9u8; 32]);
        let peer = desired(&key, &["10.0.0.2/32"], "");
        let attributes = peer_attributes(&peer, false).expect("peer attributes");
        assert_eq!(psk_of(&attributes), Some([0u8; 32]));
    }

    #[test]
    fn psk_state_survives_restart_and_detects_rotation() {
        let path = temp_path();
        let mut store = PskStore::load(Some(path.clone()));
        store.replace_interface("awg0", &[("alice".to_string(), psk_hash("old"))]);
        store.persist().expect("persist");
        assert!(!tmp_path(&path).exists(), "tmp file must be renamed");
        drop(store);

        // Fresh process: in-memory map is empty, state comes from disk.
        let restarted = PskStore::load(Some(path.clone()));
        let applied = restarted.for_interface("awg0");
        assert_eq!(applied.len(), 1);

        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];
        let rotated = vec![desired("alice", &["10.0.0.2/32"], "new")];
        let delta = peer_delta(&rotated, &runtime, Some(&applied));
        assert_eq!(
            delta.upserts.len(),
            1,
            "rotation must be applied after restart"
        );

        let unchanged = vec![desired("alice", &["10.0.0.2/32"], "old")];
        let delta = peer_delta(&unchanged, &runtime, Some(&applied));
        assert!(delta.is_empty(), "unchanged PSK must not be re-applied");

        let removed = vec![desired("alice", &["10.0.0.2/32"], "")];
        let delta = peer_delta(&removed, &runtime, Some(&applied));
        assert_eq!(
            delta.upserts.len(),
            1,
            "removed PSK must be applied after restart"
        );
    }

    #[test]
    fn psk_state_never_contains_the_plain_key() {
        let path = temp_path();
        let mut store = PskStore::load(Some(path.clone()));
        store.replace_interface("awg0", &[("alice".to_string(), psk_hash("secret"))]);
        store.persist().expect("persist");
        let raw = fs::read_to_string(&path).expect("state file");
        assert!(
            !raw.contains("secret"),
            "PSK must not be stored in plain text"
        );
        assert!(raw.contains(&psk_hash("secret")));
    }

    #[test]
    fn psk_store_removes_interface_entries() {
        let mut store = PskStore::load(None);
        store.replace_interface("awg0", &[("alice".to_string(), psk_hash("a"))]);
        store.replace_interface("awg1", &[("bob".to_string(), psk_hash("b"))]);
        store.remove_interface("awg0");
        assert!(store.for_interface("awg0").is_empty());
        assert_eq!(store.for_interface("awg1").len(), 1);
    }

    #[test]
    fn runtime_parses_allowed_ips() {
        let peer = AmneziaWireguardPeer(vec![
            AmneziaWireguardPeerAttribute::PublicKey([5u8; 32]),
            AmneziaWireguardPeerAttribute::AllowedIps(vec![
                AmneziaWireguardAllowedIp(vec![
                    AmneziaWireguardAllowedIpAttr::Family(AmneziaWireguardAddressFamily::Ipv4),
                    AmneziaWireguardAllowedIpAttr::IpAddr("10.0.0.5".parse().expect("ip")),
                    AmneziaWireguardAllowedIpAttr::Cidr(32),
                ]),
                AmneziaWireguardAllowedIp(vec![
                    AmneziaWireguardAllowedIpAttr::Family(AmneziaWireguardAddressFamily::Ipv6),
                    AmneziaWireguardAllowedIpAttr::IpAddr("fd00::1".parse().expect("ip")),
                    AmneziaWireguardAllowedIpAttr::Cidr(128),
                ]),
            ]),
        ]);

        let runtime = peer_runtime(&peer).expect("peer runtime");
        assert_eq!(runtime.allowed_ips, vec!["10.0.0.5/32", "fd00::1/128"]);
    }

    #[test]
    fn parses_amneziawg_links_only() {
        let output = "\
7: awg-branch-01: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/none amneziawg addrgenmode none
8: awg-branch-02: <POINTOPOINT,NOARP> mtu 1280 qdisc noop state DOWN mode DEFAULT group default qlen 1000\\    link/none amneziawg addrgenmode none
9: eth0.10@eth0: <BROADCAST,MULTICAST,UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\\    link/ether addrgenmode eui64
";
        assert_eq!(
            parse_amneziawg_links(output),
            vec!["awg-branch-01", "awg-branch-02"]
        );
    }

    #[test]
    fn parses_addresses_from_ip_output() {
        let output = "\
7: awg0    inet 10.0.0.1/32 scope global awg0\\       valid_lft forever preferred_lft forever
7: awg0    inet6 fd00::1/64 scope global \\       valid_lft forever preferred_lft forever
7: awg0    inet6 fe80::1/64 scope link \\       valid_lft forever preferred_lft forever
";
        assert_eq!(
            parse_ip_addresses(output),
            vec!["10.0.0.1/32", "fd00::1/64", "fe80::1/64"]
        );
    }

    #[test]
    fn link_local_addresses_are_protected_from_removal() {
        assert!(is_link_local_cidr("fe80::1/64"));
        assert!(is_link_local_cidr("169.254.10.1/16"));
        assert!(!is_link_local_cidr("10.0.0.1/32"));
        assert!(!is_link_local_cidr("fd00::1/64"));
    }

    #[test]
    fn missing_device_errors_are_idempotent() {
        assert!(device_is_missing("Cannot find device \"awg0\""));
        assert!(device_is_missing("Device \"awg0\" does not exist."));
        assert!(!device_is_missing("Operation not permitted"));
    }
}
