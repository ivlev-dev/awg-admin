use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use genetlink::new_connection;
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

use crate::application::AwgControl;
use crate::domain::{DesiredInterface, DesiredPeer, InterfaceRuntime, PeerRuntime};

pub struct NetlinkAwg {
    dry_run: bool,
    applied_psk: Mutex<HashMap<String, HashMap<String, String>>>,
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
        Self {
            dry_run,
            applied_psk: Mutex::new(HashMap::new()),
        }
    }

    fn run(&self, program: &str, args: &[&str]) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: {program} {}", args.join(" "));
            return Ok(());
        }
        let output = Command::new(program)
            .args(args)
            .output()
            .with_context(|| format!("failed to spawn {program}"))?;
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
}

#[async_trait]
impl AwgControl for NetlinkAwg {
    async fn ensure_interface(&self, interface: &DesiredInterface) -> Result<()> {
        let exists = Command::new("ip")
            .args(["link", "show", &interface.name])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !exists {
            let _ = self.run(
                "ip",
                &["link", "add", "dev", &interface.name, "type", "amneziawg"],
            );
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
        )?;
        for address in &interface.addresses {
            self.run("ip", &["addr", "replace", address, "dev", &interface.name])?;
        }
        self.run("ip", &["link", "set", "dev", &interface.name, "up"])?;
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
            .applied_psk
            .lock()
            .expect("applied psk lock")
            .get(&interface.name)
            .cloned();

        let (delta, existing, replace_all_allowed_ips) = match dump(&interface.name).await {
            Ok(messages) => {
                let runtime = interface_runtime(&messages, &interface.name).unwrap_or_default();
                let existing: HashSet<String> = runtime
                    .peers
                    .iter()
                    .map(|peer| peer.public_key.clone())
                    .collect();
                (
                    peer_delta(&interface.peers, &runtime.peers, applied_psk.as_ref()),
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
        send(msg).await?;

        let snapshot = interface
            .peers
            .iter()
            .map(|peer| (peer.public_key.clone(), peer.preshared_key.clone()))
            .collect();
        self.applied_psk
            .lock()
            .expect("applied psk lock")
            .insert(interface.name.clone(), snapshot);
        Ok(())
    }

    async fn teardown(&self, name: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: ip link del dev {name}");
            return Ok(());
        }
        let _ = self.run("ip", &["link", "del", "dev", name]);
        self.applied_psk
            .lock()
            .expect("applied psk lock")
            .remove(name);
        Ok(())
    }

    async fn read_interface(&self, interface: &DesiredInterface) -> Result<InterfaceRuntime> {
        if self.dry_run {
            return Ok(InterfaceRuntime::default());
        }
        let messages = dump(&interface.name).await?;
        interface_runtime(&messages, &interface.name)
            .ok_or_else(|| anyhow!("netlink dump returned no device for {}", interface.name))
    }
}

async fn send(msg: AmneziaWireguardMessage) -> Result<()> {
    let mut nlmsg = NetlinkMessage::from(GenlMessage::from_payload(msg));
    nlmsg.header.flags = NLM_F_REQUEST | NLM_F_ACK;
    request(nlmsg).await.map(|_| ())
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

async fn dump(name: &str) -> Result<Vec<AmneziaWireguardMessage>> {
    request(get_device_request(name)).await
}

async fn request(
    nlmsg: NetlinkMessage<GenlMessage<AmneziaWireguardMessage>>,
) -> Result<Vec<AmneziaWireguardMessage>> {
    let (connection, mut handle, _) = new_connection().context("open netlink connection")?;
    tokio::spawn(connection);

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
                        .is_some_and(|known| known != &peer.preshared_key)
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
    let mut attributes = vec![
        AmneziaWireguardPeerAttribute::PublicKey(public_key),
        AmneziaWireguardPeerAttribute::AllowedIps(
            peer.allowed_ips
                .iter()
                .map(|cidr| allowed_ip(cidr))
                .collect::<Result<Vec<_>>>()?,
        ),
        AmneziaWireguardPeerAttribute::PersistentKeepaliveRange(25 | (25 << 16)),
    ];
    if replace_allowed_ips {
        attributes.push(AmneziaWireguardPeerAttribute::Flags(
            WGPEER_F_REPLACE_ALLOWEDIPS,
        ));
    }
    if !peer.preshared_key.is_empty() {
        attributes.push(AmneziaWireguardPeerAttribute::PresharedKey(decode_key(
            &peer.preshared_key,
        )?));
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

#[cfg(test)]
mod tests {
    use netlink_packet_amnezia_wireguard::AmneziaWireguardTimeSpec;
    use uuid::Uuid;

    use super::*;

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

    #[test]
    fn delta_is_empty_for_identical_peers() {
        let desired_peers = vec![desired("alice", &["10.0.0.2/32"], "psk")];
        let runtime = vec![runtime_peer("alice", &["10.0.0.2/32"])];
        let psk = HashMap::from([("alice".to_string(), "psk".to_string())]);

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
        let psk = HashMap::from([("alice".to_string(), "old".to_string())]);

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
}
