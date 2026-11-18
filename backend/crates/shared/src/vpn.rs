use std::io::{Read, Write};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flate2::Compression;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use serde_json::{Value, json};

use crate::conf::{ParsedConf, parse_conf, split_list};
use crate::error::{CoreError, CoreResult};
use crate::obf::ClientObf;

pub const CONTAINER_AWG3: &str = "amnezia-awg3";

pub struct VpnBundle<'a> {
    pub conf: &'a str,
    pub name: &'a str,
    pub host: &'a str,
    pub dns: &'a [String],
    pub client_obf: &'a ClientObf,
}

pub fn build_vpn_json(bundle: VpnBundle<'_>) -> CoreResult<Value> {
    let parsed = parse_conf(bundle.conf)?;
    let peer = parsed.peers.first();
    let field = |key: &str| -> Option<&str> {
        parsed
            .interface
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .map(|(_, value)| value.as_str())
    };
    let peer_field = |key: &str| -> Option<&str> {
        peer.and_then(|values| {
            values
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(key))
                .map(|(_, value)| value.as_str())
        })
    };
    let (endpoint_host, endpoint_port) = peer_field("Endpoint")
        .and_then(|endpoint| endpoint.rsplit_once(':'))
        .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
        .unwrap_or((bundle.host, 0));

    let mut last = serde_json::Map::new();
    last.insert("config".into(), Value::String(bundle.conf.to_string()));
    last.insert("hostName".into(), Value::String(endpoint_host.to_string()));
    if endpoint_port > 0 {
        last.insert("port".into(), Value::from(endpoint_port));
    }
    last.insert(
        "client_priv_key".into(),
        Value::String(field("PrivateKey").unwrap_or_default().to_string()),
    );
    last.insert(
        "client_ip".into(),
        Value::String(field("Address").unwrap_or_default().to_string()),
    );
    last.insert(
        "server_pub_key".into(),
        Value::String(peer_field("PublicKey").unwrap_or_default().to_string()),
    );
    last.insert(
        "allowed_ips".into(),
        Value::Array(
            peer_field("AllowedIPs")
                .map(split_list)
                .unwrap_or_default()
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    last.insert(
        "isObfuscationEnabled".into(),
        Value::Bool(field("Jc").is_some()),
    );
    if let Some(value) = peer_field("PresharedKey") {
        last.insert("psk_key".into(), Value::String(value.to_string()));
    }
    for (target, source) in [
        ("mtu", "MTU"),
        ("persistent_keep_alive", "PersistentKeepalive"),
        ("Jc", "Jc"),
        ("Jmin", "Jmin"),
        ("Jmax", "Jmax"),
        ("S1", "S1"),
        ("S2", "S2"),
        ("S3", "S3"),
        ("S4", "S4"),
        ("H1", "H1"),
        ("H2", "H2"),
        ("H3", "H3"),
        ("H4", "H4"),
        ("I1", "I1"),
        ("I2", "I2"),
        ("I3", "I3"),
        ("I4", "I4"),
        ("I5", "I5"),
        ("HeaderProtectionKey", "HeaderProtectionKey"),
        ("RandomTrailers", "RandomTrailers"),
        ("DisableCookies", "DisableCookies"),
    ] {
        if let Some(value) = field(source) {
            last.insert(target.into(), Value::String(value.to_string()));
        }
    }

    let last_json = serde_json::to_string(&last)
        .map_err(|error| CoreError::Codec(format!("last_config encode failed: {error}")))?;
    let mut awg = serde_json::Map::new();
    awg.insert("config".into(), Value::String(bundle.conf.to_string()));
    awg.insert("last_config".into(), Value::String(last_json));
    awg.insert("isThirdPartyConfig".into(), Value::Bool(true));
    awg.insert("transport_proto".into(), Value::String("udp".into()));
    if endpoint_port > 0 {
        awg.insert("port".into(), Value::String(endpoint_port.to_string()));
    }
    for key in ["Jc", "Jmin", "Jmax", "I1", "I2", "I3", "I4", "I5"] {
        if let Some(value) = field(key) {
            awg.insert(key.into(), Value::String(value.to_string()));
        }
    }

    Ok(json!({
        "containers": [{
            "container": CONTAINER_AWG3,
            "awg": Value::Object(awg.clone()),
            "awg3": Value::Object(awg),
        }],
        "defaultContainer": CONTAINER_AWG3,
        "description": "AmneziaWG 3.1",
        "hostName": bundle.host,
        "dns1": bundle.dns.first().cloned().unwrap_or_default(),
        "dns2": bundle.dns.get(1).cloned().unwrap_or_default(),
        "nameOverriddenByUser": false,
        "name": bundle.name,
        "awg": {
            "Jc": bundle.client_obf.jc,
            "Jmin": bundle.client_obf.jmin,
            "Jmax": bundle.client_obf.jmax,
        }
    }))
}

pub fn vpn_encode(bundle: VpnBundle<'_>) -> CoreResult<String> {
    let value = build_vpn_json(bundle)?;
    let json_bytes = serde_json::to_vec(&value)
        .map_err(|e| CoreError::Codec(format!("json encode failed: {e}")))?;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&json_bytes)
        .map_err(|e| CoreError::Codec(format!("zlib failed: {e}")))?;
    let compressed = encoder
        .finish()
        .map_err(|e| CoreError::Codec(format!("zlib finish failed: {e}")))?;

    let mut out = Vec::with_capacity(4 + compressed.len());
    let len = json_bytes.len() as u32;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&compressed);
    Ok(format!("vpn://{}", URL_SAFE_NO_PAD.encode(out)))
}

pub fn vpn_decode(link: &str) -> CoreResult<Value> {
    let mut encoded = link.trim().to_string();
    if let Some(stripped) = encoded.strip_prefix("vpn://") {
        encoded = stripped.to_string();
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.trim_end_matches('='))
        .or_else(|_| {
            base64::engine::general_purpose::STANDARD
                .decode(encoded.replace('-', "+").replace('_', "/"))
        })
        .map_err(|e| CoreError::Codec(format!("invalid vpn:// base64: {e}")))?;

    if bytes.first() == Some(&b'{') {
        return serde_json::from_slice(&bytes)
            .map_err(|e| CoreError::Codec(format!("invalid vpn json: {e}")));
    }
    if bytes.len() <= 4 {
        return Err(CoreError::Codec("vpn payload is truncated".into()));
    }
    let mut decoder = ZlibDecoder::new(&bytes[4..]);
    let mut inflated = Vec::new();
    decoder
        .read_to_end(&mut inflated)
        .map_err(|e| CoreError::Codec(format!("zlib decode failed: {e}")))?;
    serde_json::from_slice(&inflated)
        .map_err(|e| CoreError::Codec(format!("invalid vpn json: {e}")))
}

pub fn vpn_to_conf(link: &str) -> CoreResult<String> {
    let value = vpn_decode(link)?;
    let containers = value
        .get("containers")
        .and_then(Value::as_array)
        .ok_or_else(|| CoreError::Codec("vpn key carries no containers".into()))?;
    for container in containers {
        for key in ["awg", "awg3", "wireguard"] {
            if let Some(conf) = container
                .get(key)
                .and_then(|v| v.get("config"))
                .and_then(Value::as_str)
            {
                return Ok(conf.to_string());
            }
        }
    }
    Err(CoreError::Codec(
        "vpn key carries no AmneziaWG config".into(),
    ))
}

pub fn conf_from_parsed(parsed: &ParsedConf) -> String {
    let mut out = String::from("[Interface]\n");
    for (k, v) in &parsed.interface {
        out.push_str(&format!("{k} = {v}\n"));
    }
    for peer in &parsed.peers {
        out.push_str("\n[Peer]\n");
        for (k, v) in peer {
            out.push_str(&format!("{k} = {v}\n"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::obf::ObfuscationSettings;

    fn sample_conf() -> String {
        let obf = crate::obf::generate_interface_obf(&ObfuscationSettings::default());
        let client = crate::obf::generate_client_obf(&ObfuscationSettings::default());
        let addr = vec!["10.1.0.2/24".to_string()];
        let dns = vec!["1.1.1.1".to_string()];
        let allowed = vec!["0.0.0.0/0".to_string()];
        crate::conf::render_client_conf(crate::conf::ClientConfParams {
            private_key: "priv",
            addresses: &addr,
            dns: &dns,
            mtu: 1420,
            server_public_key: "pub",
            preshared_key: Some("psk"),
            endpoint: "vpn.example.com:51820",
            allowed_ips: &allowed,
            obf: &obf,
            client: &client,
            persistent_keepalive: 25,
        })
    }

    #[test]
    fn vpn_roundtrip() {
        let conf = sample_conf();
        let obf = ClientObf {
            jc: 8,
            jmin: 40,
            jmax: 120,
            i1: String::new(),
            i2: String::new(),
            i3: String::new(),
            i4: String::new(),
            i5: String::new(),
            disable_cookies: false,
        };
        let dns = vec!["1.1.1.1".to_string()];
        let link = vpn_encode(VpnBundle {
            conf: &conf,
            name: "phone",
            host: "vpn.example.com",
            dns: &dns,
            client_obf: &obf,
        })
        .unwrap();
        assert!(link.starts_with("vpn://"));
        let decoded = vpn_decode(&link).unwrap();
        assert!(decoded.get("containers").is_some());
        let restored = vpn_to_conf(&link).unwrap();
        assert_eq!(restored, conf);
    }

    #[test]
    fn vpn_bundle_carries_structured_last_config() {
        let conf = sample_conf();
        let obf = ClientObf {
            jc: 8,
            jmin: 40,
            jmax: 120,
            i1: String::new(),
            i2: String::new(),
            i3: String::new(),
            i4: String::new(),
            i5: String::new(),
            disable_cookies: false,
        };
        let dns = vec!["1.1.1.1".to_string()];
        let link = vpn_encode(VpnBundle {
            conf: &conf,
            name: "phone",
            host: "vpn.example.com",
            dns: &dns,
            client_obf: &obf,
        })
        .unwrap();
        let decoded = vpn_decode(&link).unwrap();
        let last = decoded["containers"][0]["awg"]["last_config"]
            .as_str()
            .expect("last_config string");
        let parsed: Value = serde_json::from_str(last).unwrap();
        assert_eq!(parsed["client_priv_key"], "priv");
        assert_eq!(parsed["server_pub_key"], "pub");
        assert_eq!(parsed["client_ip"], "10.1.0.2/24");
        assert_eq!(parsed["allowed_ips"][0], "0.0.0.0/0");
        assert_eq!(parsed["isObfuscationEnabled"], true);
        assert_eq!(parsed["port"], 51820);
        assert_eq!(parsed["RandomTrailers"], "on");
        assert_eq!(parsed["DisableCookies"], "off");
        assert!(
            parsed["config"]
                .as_str()
                .unwrap()
                .contains("PrivateKey = priv")
        );
    }

    #[test]
    fn rejects_broken_link() {
        assert!(vpn_decode("vpn://%%%").is_err());
        assert!(vpn_to_conf("vpn://AAAA").is_err());
    }
}
