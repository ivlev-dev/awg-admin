use std::collections::BTreeMap;

use crate::error::{CoreError, CoreResult};
use crate::obf::{ClientObf, HeaderRange, InterfaceObf, S_FLOOR_WITH_HPK};

#[derive(Debug, Clone, Default)]
pub struct ParsedConf {
    pub interface: BTreeMap<String, String>,
    pub peers: Vec<BTreeMap<String, String>>,
}

impl ParsedConf {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.interface
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

pub fn parse_conf(text: &str) -> CoreResult<ParsedConf> {
    let mut out = ParsedConf::default();
    let mut section = String::new();
    let mut current: BTreeMap<String, String> = BTreeMap::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            flush_section(&mut out, &section, &mut current);
            section = line[1..line.len() - 1].trim().to_ascii_lowercase();
            current = BTreeMap::new();
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim().to_string();
        let value = v.trim().trim_matches('"').to_string();
        current.insert(key, value);
    }
    flush_section(&mut out, &section, &mut current);

    if out.interface.is_empty() {
        return Err(CoreError::Invalid(
            "config has no [Interface] section".into(),
        ));
    }
    Ok(out)
}

fn flush_section(out: &mut ParsedConf, section: &str, current: &mut BTreeMap<String, String>) {
    if current.is_empty() {
        return;
    }
    let values = std::mem::take(current);
    match section {
        "interface" => out.interface.extend(values),
        "peer" => out.peers.push(values),
        _ => {}
    }
}

fn field<'a>(map: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    map.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

fn number(map: &BTreeMap<String, String>, key: &str) -> Option<u32> {
    field(map, key)?.parse().ok()
}

fn truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub fn sanitize_cps(value: &str) -> String {
    value.replace("<c>", "")
}

pub fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[derive(Debug, Clone)]
pub struct ParsedServerConf {
    pub private_key: String,
    pub listen_port: u16,
    pub mtu: u16,
    pub obf: InterfaceObf,
    pub peers: Vec<ParsedServerPeer>,
}

#[derive(Debug, Clone)]
pub struct ParsedServerPeer {
    pub public_key: String,
    pub preshared_key: Option<String>,
    pub allowed_ips: Vec<String>,
}

pub fn parse_server_conf(text: &str) -> CoreResult<ParsedServerConf> {
    let parsed = parse_conf(text)?;
    let private_key = parsed
        .get("PrivateKey")
        .ok_or_else(|| CoreError::Invalid("server config has no PrivateKey".into()))?
        .to_string();

    let obf = obf_from_pairs(&parsed.interface).unwrap_or_else(default_interface_obf);

    let peers = parsed
        .peers
        .iter()
        .filter_map(|p| {
            let public_key = field(p, "PublicKey")?.to_string();
            Some(ParsedServerPeer {
                public_key,
                preshared_key: field(p, "PresharedKey").map(str::to_string),
                allowed_ips: field(p, "AllowedIPs").map(split_list).unwrap_or_default(),
            })
        })
        .collect();

    Ok(ParsedServerConf {
        private_key,
        listen_port: number(&parsed.interface, "ListenPort").unwrap_or(51820) as u16,
        mtu: number(&parsed.interface, "MTU").unwrap_or(1420) as u16,
        obf,
        peers,
    })
}

#[derive(Debug, Clone)]
pub struct ParsedClientConf {
    pub private_key: String,
    pub addresses: Vec<String>,
    pub dns: Vec<String>,
    pub mtu: u16,
    pub server_public_key: String,
    pub preshared_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub obf: InterfaceObf,
    pub client: ClientObf,
}

pub fn parse_client_conf(text: &str) -> CoreResult<ParsedClientConf> {
    let parsed = parse_conf(text)?;
    let peer = parsed
        .peers
        .first()
        .ok_or_else(|| CoreError::Invalid("client config has no [Peer] section".into()))?;

    let private_key = parsed
        .get("PrivateKey")
        .ok_or_else(|| CoreError::Invalid("client config has no PrivateKey".into()))?
        .to_string();
    let server_public_key = field(peer, "PublicKey")
        .ok_or_else(|| CoreError::Invalid("client config has no peer PublicKey".into()))?
        .to_string();

    let mut client = client_obf_from_pairs(&parsed.interface).unwrap_or_else(default_client_obf);
    if let Some(value) = field(peer, "PersistentKeepalive") {
        let (low, high) = parse_range(value);
        if high > 0 {
            client.keepalive_low = low;
            client.keepalive_high = high;
        }
    }
    Ok(ParsedClientConf {
        private_key,
        addresses: parsed.get("Address").map(split_list).unwrap_or_default(),
        dns: parsed.get("DNS").map(split_list).unwrap_or_default(),
        mtu: number(&parsed.interface, "MTU").unwrap_or(1420) as u16,
        server_public_key,
        preshared_key: field(peer, "PresharedKey").map(str::to_string),
        endpoint: field(peer, "Endpoint").map(str::to_string),
        allowed_ips: field(peer, "AllowedIPs")
            .map(split_list)
            .unwrap_or_default(),
        obf: obf_from_pairs(&parsed.interface).unwrap_or_else(default_interface_obf),
        client,
    })
}

fn default_interface_obf() -> InterfaceObf {
    InterfaceObf {
        h1: HeaderRange::new(100_000, 120_000),
        h2: HeaderRange::new(1_000_000, 1_020_000),
        h3: HeaderRange::new(2_000_000, 2_020_000),
        h4: HeaderRange::new(3_000_000, 3_020_000),
        s1: 60,
        s2: 90,
        s3: 120,
        s4: 22,
        header_protection_key: String::new(),
        random_trailers: false,
    }
}

fn parse_range(value: &str) -> (u16, u16) {
    let trimmed = value.trim();
    let (low, high) = trimmed
        .split_once('-')
        .map(|(low, high)| (low.trim(), high.trim()))
        .unwrap_or((trimmed, trimmed));
    let low = low.parse().unwrap_or(0);
    let high = high.parse().unwrap_or(low);
    (low, high)
}

fn default_client_obf() -> ClientObf {
    ClientObf {
        jc: 8,
        jmin: 40,
        jmax: 120,
        i1: String::new(),
        i2: String::new(),
        i3: String::new(),
        i4: String::new(),
        i5: String::new(),
        disable_cookies: false,
        keepalive_low: crate::obf::default_keepalive_low(),
        keepalive_high: crate::obf::default_keepalive_high(),
    }
}

fn obf_from_pairs(map: &BTreeMap<String, String>) -> Option<InterfaceObf> {
    let ranged = field(map, "H1").and_then(HeaderRange::parse)?;
    Some(InterfaceObf {
        h1: ranged,
        h2: field(map, "H2").and_then(HeaderRange::parse)?,
        h3: field(map, "H3").and_then(HeaderRange::parse)?,
        h4: field(map, "H4").and_then(HeaderRange::parse)?,
        s1: number(map, "S1")? as u16,
        s2: number(map, "S2")? as u16,
        s3: number(map, "S3").unwrap_or(120) as u16,
        s4: number(map, "S4").unwrap_or(20) as u16,
        header_protection_key: field(map, "HeaderProtectionKey")
            .map(str::to_string)
            .unwrap_or_default(),
        random_trailers: field(map, "RandomTrailers").map(truthy).unwrap_or(false),
    })
}

fn client_obf_from_pairs(map: &BTreeMap<String, String>) -> Option<ClientObf> {
    Some(ClientObf {
        jc: number(map, "Jc").unwrap_or(8) as u16,
        jmin: number(map, "Jmin").unwrap_or(40) as u16,
        jmax: number(map, "Jmax").unwrap_or(120) as u16,
        i1: field(map, "I1").unwrap_or_default().to_string(),
        i2: field(map, "I2").unwrap_or_default().to_string(),
        i3: field(map, "I3").unwrap_or_default().to_string(),
        i4: field(map, "I4").unwrap_or_default().to_string(),
        i5: field(map, "I5").unwrap_or_default().to_string(),
        disable_cookies: field(map, "DisableCookies").map(truthy).unwrap_or(false),
        keepalive_low: crate::obf::default_keepalive_low(),
        keepalive_high: crate::obf::default_keepalive_high(),
    })
}

pub struct ClientConfParams<'a> {
    pub private_key: &'a str,
    pub addresses: &'a [String],
    pub dns: &'a [String],
    pub mtu: u16,
    pub server_public_key: &'a str,
    pub preshared_key: Option<&'a str>,
    pub endpoint: &'a str,
    pub allowed_ips: &'a [String],
    pub obf: &'a InterfaceObf,
    pub client: &'a ClientObf,
}

pub fn render_client_conf(params: ClientConfParams<'_>) -> String {
    let obf = params.obf;
    let client = params.client;
    let mut out = String::new();
    out.push_str("# AmneziaWG 3.1\n[Interface]\n");
    out.push_str(&format!("PrivateKey = {}\n", params.private_key));
    out.push_str(&format!("Address = {}\n", params.addresses.join(", ")));
    if !params.dns.is_empty() {
        out.push_str(&format!("DNS = {}\n", params.dns.join(", ")));
    }
    out.push_str(&format!("MTU = {}\n", params.mtu));
    out.push_str(&format!("Jc = {}\n", client.jc));
    out.push_str(&format!("Jmin = {}\n", client.jmin));
    out.push_str(&format!("Jmax = {}\n", client.jmax));
    out.push_str(&format!("H1 = {}\n", obf.h1.spec()));
    out.push_str(&format!("H2 = {}\n", obf.h2.spec()));
    out.push_str(&format!("H3 = {}\n", obf.h3.spec()));
    out.push_str(&format!("H4 = {}\n", obf.h4.spec()));
    out.push_str(&format!("S1 = {}\n", obf.s1));
    out.push_str(&format!("S2 = {}\n", obf.s2));
    out.push_str(&format!("S3 = {}\n", obf.s3));
    out.push_str(&format!("S4 = {}\n", obf.s4));
    for (key, value) in [
        ("I1", &client.i1),
        ("I2", &client.i2),
        ("I3", &client.i3),
        ("I4", &client.i4),
        ("I5", &client.i5),
    ] {
        if !value.is_empty() {
            out.push_str(&format!("{key} = {}\n", sanitize_cps(value)));
        }
    }
    if !obf.header_protection_key.is_empty() {
        out.push_str(&format!(
            "HeaderProtectionKey = {}\n",
            obf.header_protection_key
        ));
    }
    if obf.random_trailers || client.disable_cookies {
        out.push_str(&format!(
            "RandomTrailers = {}\n",
            if obf.random_trailers { "on" } else { "off" }
        ));
        out.push_str(&format!(
            "DisableCookies = {}\n",
            if client.disable_cookies { "on" } else { "off" }
        ));
    }
    out.push_str("\n[Peer]\n");
    out.push_str(&format!("PublicKey = {}\n", params.server_public_key));
    if let Some(psk) = params.preshared_key {
        out.push_str(&format!("PresharedKey = {psk}\n"));
    }
    out.push_str(&format!("Endpoint = {}\n", params.endpoint));
    let allowed = if params.allowed_ips.is_empty() {
        vec!["0.0.0.0/0".to_string(), "::/0".to_string()]
    } else {
        params.allowed_ips.to_vec()
    };
    out.push_str(&format!("AllowedIPs = {}\n", allowed.join(", ")));
    let keepalive_low = params.client.keepalive_low;
    let keepalive_high = params.client.keepalive_high;
    if keepalive_high > 0 {
        if keepalive_low == keepalive_high {
            out.push_str(&format!("PersistentKeepalive = {keepalive_high}\n"));
        } else {
            out.push_str(&format!(
                "PersistentKeepalive = {keepalive_low}-{keepalive_high}\n"
            ));
        }
    }
    out
}

pub fn render_server_conf(
    private_key: &str,
    listen_port: u16,
    mtu: u16,
    obf: &InterfaceObf,
    peers: &[(String, Option<String>, Vec<String>)],
) -> String {
    let mut out = String::new();
    out.push_str("# AmneziaWG 3.1 server\n[Interface]\n");
    out.push_str(&format!("PrivateKey = {private_key}\n"));
    out.push_str(&format!("ListenPort = {listen_port}\n"));
    out.push_str(&format!("MTU = {mtu}\n"));
    out.push_str(&format!("H1 = {}\n", obf.h1.spec()));
    out.push_str(&format!("H2 = {}\n", obf.h2.spec()));
    out.push_str(&format!("H3 = {}\n", obf.h3.spec()));
    out.push_str(&format!("H4 = {}\n", obf.h4.spec()));
    out.push_str(&format!("S1 = {}\n", obf.s1.max(S_FLOOR_WITH_HPK)));
    out.push_str(&format!("S2 = {}\n", obf.s2.max(S_FLOOR_WITH_HPK)));
    out.push_str(&format!("S3 = {}\n", obf.s3.max(S_FLOOR_WITH_HPK)));
    out.push_str(&format!("S4 = {}\n", obf.s4.min(32)));
    if !obf.header_protection_key.is_empty() {
        out.push_str(&format!(
            "HeaderProtectionKey = {}\n",
            obf.header_protection_key
        ));
    }
    if obf.random_trailers {
        out.push_str("RandomTrailers = on\n");
        out.push_str("DisableCookies = off\n");
    }
    for (public_key, psk, ips) in peers {
        out.push_str("\n[Peer]\n");
        out.push_str(&format!("PublicKey = {public_key}\n"));
        if let Some(psk) = psk {
            out.push_str(&format!("PresharedKey = {psk}\n"));
        }
        out.push_str(&format!("AllowedIPs = {}\n", ips.join(", ")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::obf::ObfuscationSettings;

    fn sample_params<'a>(
        obf: &'a InterfaceObf,
        client: &'a ClientObf,
        addr: &'a [String],
        dns: &'a [String],
        allowed: &'a [String],
    ) -> ClientConfParams<'a> {
        ClientConfParams {
            private_key: "priv",
            addresses: addr,
            dns,
            mtu: 1420,
            server_public_key: "pub",
            preshared_key: Some("psk"),
            endpoint: "vpn.example.com:51820",
            allowed_ips: allowed,
            obf,
            client,
        }
    }

    #[test]
    fn client_conf_keeps_dynamic_keepalive_range() {
        let obf = crate::obf::generate_interface_obf(&ObfuscationSettings::default());
        let mut client = crate::obf::generate_client_obf(&ObfuscationSettings::default());
        client.keepalive_low = 17;
        client.keepalive_high = 43;
        let addr = vec!["10.1.0.2/24".to_string()];
        let dns = vec!["1.1.1.1".to_string()];
        let allowed = vec!["0.0.0.0/0".to_string()];
        let text = render_client_conf(sample_params(&obf, &client, &addr, &dns, &allowed));
        assert!(text.contains("PersistentKeepalive = 17-43"));
        let parsed = parse_client_conf(&text).unwrap();
        assert_eq!(
            (parsed.client.keepalive_low, parsed.client.keepalive_high),
            (17, 43)
        );
    }

    #[test]
    fn client_conf_supports_single_keepalive_value() {
        let obf = crate::obf::generate_interface_obf(&ObfuscationSettings::default());
        let mut client = crate::obf::generate_client_obf(&ObfuscationSettings::default());
        client.keepalive_low = 21;
        client.keepalive_high = 21;
        let addr = vec!["10.1.0.2/24".to_string()];
        let dns = vec!["1.1.1.1".to_string()];
        let allowed = vec!["0.0.0.0/0".to_string()];
        let text = render_client_conf(sample_params(&obf, &client, &addr, &dns, &allowed));
        assert!(text.contains("PersistentKeepalive = 21\n"));
        let parsed = parse_client_conf(&text).unwrap();
        assert_eq!(
            (parsed.client.keepalive_low, parsed.client.keepalive_high),
            (21, 21)
        );
    }

    #[test]
    fn client_conf_roundtrip_keeps_obfuscation() {
        let obf = crate::obf::generate_interface_obf(&ObfuscationSettings::default());
        let mut client = crate::obf::generate_client_obf(&ObfuscationSettings::default());
        client.keepalive_low = 15;
        client.keepalive_high = 25;
        let addr = vec!["10.1.0.2/24".to_string()];
        let dns = vec!["1.1.1.1".to_string()];
        let allowed = vec!["0.0.0.0/0".to_string()];
        let text = render_client_conf(sample_params(&obf, &client, &addr, &dns, &allowed));
        let parsed = parse_client_conf(&text).unwrap();
        assert_eq!(parsed.addresses, addr);
        assert_eq!(parsed.private_key, "priv");
        assert_eq!(parsed.server_public_key, "pub");
        assert_eq!(parsed.obf.s1, obf.s1);
        assert_eq!(parsed.obf.h1, obf.h1);
        assert_eq!(parsed.client.jc, client.jc);
        assert!(parsed.client.i1.starts_with("<b 0x"));
        assert!(!text.contains("<c>"));
        assert!(text.contains("PersistentKeepalive = 15-25"));
        assert!(!text.contains("PersistentKeepalive = 25"));
        assert_eq!(parsed.allowed_ips, allowed);
    }

    #[test]
    fn yaml_like_garbage_is_rejected() {
        assert!(parse_conf("hello: world").is_err());
    }
}
