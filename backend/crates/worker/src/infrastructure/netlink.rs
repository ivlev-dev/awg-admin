use std::net::IpAddr;
use std::process::Command;

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use genetlink::new_connection;
use netlink_packet_amnezia_wireguard::{
    AmneziaWireguardAddressFamily, AmneziaWireguardAllowedIp, AmneziaWireguardAllowedIpAttr,
    AmneziaWireguardAttribute, AmneziaWireguardCmd, AmneziaWireguardMessage, AmneziaWireguardPeer,
    AmneziaWireguardPeerAttribute,
};
use netlink_packet_core::{NLM_F_ACK, NLM_F_DUMP, NLM_F_REQUEST, NetlinkMessage, NetlinkPayload};
use netlink_packet_generic::GenlMessage;

use crate::application::AwgControl;
use crate::domain::{DesiredInterface, DesiredPeer, InterfaceRuntime, PeerRuntime};

const REPLACE_PEERS: u32 = 1;

pub struct NetlinkAwg {
    dry_run: bool,
}

impl NetlinkAwg {
    pub fn new(dry_run: bool) -> Self {
        Self { dry_run }
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
            AmneziaWireguardAttribute::Flags(REPLACE_PEERS),
            AmneziaWireguardAttribute::Peers(
                interface
                    .peers
                    .iter()
                    .map(peer_attributes)
                    .collect::<Result<Vec<_>>>()?,
            ),
        ];
        if !interface.obf.header_protection_key.is_empty() {
            attributes.push(AmneziaWireguardAttribute::HeaderProtectionKey(decode_key(
                &interface.obf.header_protection_key,
            )?));
        }

        let msg = AmneziaWireguardMessage {
            cmd: AmneziaWireguardCmd::SetDevice,
            attributes,
        };
        send(msg).await.map(|_| ())
    }

    async fn teardown(&self, name: &str) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: ip link del dev {name}");
            return Ok(());
        }
        let _ = self.run("ip", &["link", "del", "dev", name]);
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

fn peer_attributes(peer: &DesiredPeer) -> Result<AmneziaWireguardPeer> {
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
}
