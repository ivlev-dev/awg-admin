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
use netlink_packet_core::{NLM_F_ACK, NLM_F_REQUEST, NetlinkMessage, NetlinkPayload};
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
        let msg = AmneziaWireguardMessage {
            cmd: AmneziaWireguardCmd::GetDevice,
            attributes: vec![AmneziaWireguardAttribute::IfName(interface.name.clone())],
        };
        let response = send(msg).await?;
        let mut peers = Vec::new();
        for attribute in response.attributes {
            if let AmneziaWireguardAttribute::Peers(list) = attribute {
                for peer in list {
                    let mut runtime = PeerRuntime::default();
                    for attribute in peer.0 {
                        match attribute {
                            AmneziaWireguardPeerAttribute::PublicKey(key) => {
                                runtime.public_key = STANDARD.encode(key);
                            }
                            AmneziaWireguardPeerAttribute::RxBytes(value) => {
                                runtime.rx_bytes = value;
                            }
                            AmneziaWireguardPeerAttribute::TxBytes(value) => {
                                runtime.tx_bytes = value;
                            }
                            AmneziaWireguardPeerAttribute::LastHandshake(time) => {
                                runtime.last_handshake = time.seconds;
                            }
                            _ => {}
                        }
                    }
                    if !runtime.public_key.is_empty() {
                        peers.push(runtime);
                    }
                }
            }
        }
        Ok(InterfaceRuntime { peers })
    }
}

async fn send(msg: AmneziaWireguardMessage) -> Result<AmneziaWireguardMessage> {
    let (connection, mut handle, _) = new_connection().context("open netlink connection")?;
    tokio::spawn(connection);

    let genlmsg: GenlMessage<AmneziaWireguardMessage> = GenlMessage::from_payload(msg);
    let mut nlmsg = NetlinkMessage::from(genlmsg);
    nlmsg.header.flags = NLM_F_REQUEST | NLM_F_ACK;

    let mut stream = handle
        .request(nlmsg)
        .await
        .map_err(|e| anyhow!("netlink request failed: {e}"))?;

    while let Some(packet) = stream.next().await {
        let packet = packet.map_err(|e| anyhow!("netlink response error: {e}"))?;
        match packet.payload {
            NetlinkPayload::InnerMessage(genl) => return Ok(genl.payload),
            NetlinkPayload::Error(error) => {
                let io = error.to_io();
                if io.raw_os_error() == Some(0) {
                    continue;
                }
                return Err(anyhow!("kernel rejected request: {io}"));
            }
            _ => continue,
        }
    }
    Ok(AmneziaWireguardMessage {
        cmd: AmneziaWireguardCmd::SetDevice,
        attributes: vec![],
    })
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
