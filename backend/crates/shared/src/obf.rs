use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rand::Rng;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};

use crate::crypto::random_bytes;

pub const S_FLOOR_WITH_HPK: u16 = 12;
pub const MAX_TAG_BYTES: usize = 1000;
pub const HEADER_ZONE_WIDTH: u32 = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MimicProfile {
    #[default]
    Http3,
    Tls,
    Quic,
    Random,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum Intensity {
    Low,
    Medium,
    #[default]
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BrowserProfile {
    #[default]
    Chrome,
    Firefox,
    Safari,
    Edge,
    Random,
}

impl BrowserProfile {
    pub fn size_range(self) -> (usize, usize) {
        match self {
            BrowserProfile::Chrome | BrowserProfile::Edge => (1200, 1400),
            BrowserProfile::Firefox => (512, 1200),
            BrowserProfile::Safari => (1000, 1380),
            BrowserProfile::Random => (512, 1400),
        }
    }

    pub fn align_128(self) -> bool {
        matches!(
            self,
            BrowserProfile::Chrome | BrowserProfile::Edge | BrowserProfile::Safari
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObfuscationSettings {
    pub profile: MimicProfile,
    pub intensity: Intensity,
    pub browser: BrowserProfile,
    pub mtu: u16,
    pub jc_min: u16,
    pub jc_max: u16,
    pub jmin_min: u16,
    pub jmin_max: u16,
    pub jmax_extra_min: u16,
    pub jmax_extra_max: u16,
    pub s_min: u16,
    pub s_max: u16,
    pub hosts: Vec<String>,
    pub random_trailers: bool,
    pub disable_cookies: bool,
}

impl Default for ObfuscationSettings {
    fn default() -> Self {
        Self {
            profile: MimicProfile::Http3,
            intensity: Intensity::High,
            browser: BrowserProfile::Chrome,
            mtu: 1420,
            jc_min: 8,
            jc_max: 12,
            jmin_min: 40,
            jmin_max: 80,
            jmax_extra_min: 60,
            jmax_extra_max: 180,
            s_min: S_FLOOR_WITH_HPK,
            s_max: 128,
            hosts: vec![
                "cloudflare.com".into(),
                "www.google.com".into(),
                "www.apple.com".into(),
                "www.microsoft.com".into(),
                "cdn.jsdelivr.net".into(),
            ],
            random_trailers: true,
            disable_cookies: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderRange {
    pub lo: u32,
    pub hi: u32,
}

impl HeaderRange {
    pub fn new(lo: u32, hi: u32) -> Self {
        Self {
            lo: lo.min(hi),
            hi: lo.max(hi),
        }
    }

    pub fn spec(&self) -> String {
        if self.lo == self.hi {
            self.lo.to_string()
        } else {
            format!("{}-{}", self.lo, self.hi)
        }
    }

    pub fn parse(spec: &str) -> Option<Self> {
        let spec = spec.trim();
        match spec.split_once('-') {
            Some((a, b)) => Some(Self::new(a.trim().parse().ok()?, b.trim().parse().ok()?)),
            None => {
                let v = spec.parse().ok()?;
                Some(Self::new(v, v))
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceObf {
    pub h1: HeaderRange,
    pub h2: HeaderRange,
    pub h3: HeaderRange,
    pub h4: HeaderRange,
    pub s1: u16,
    pub s2: u16,
    pub s3: u16,
    pub s4: u16,
    pub header_protection_key: String,
    pub random_trailers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientObf {
    pub jc: u16,
    pub jmin: u16,
    pub jmax: u16,
    pub i1: String,
    pub i2: String,
    pub i3: String,
    pub i4: String,
    pub i5: String,
    pub disable_cookies: bool,
}

pub fn generate_interface_obf(settings: &ObfuscationSettings) -> InterfaceObf {
    let mut rng = rand::rng();
    let width = match settings.intensity {
        Intensity::Low => 2_000,
        Intensity::Medium => 8_000,
        Intensity::High => HEADER_ZONE_WIDTH,
    };
    let zones = [100_000u32, 1_000_000, 2_000_000, 3_000_000];
    let mut ranges = [HeaderRange::new(0, 0); 4];
    for (i, base) in zones.iter().enumerate() {
        let width = width.min(HEADER_ZONE_WIDTH);
        let start = base + rng.random_range(0..(200_000 - width));
        ranges[i] = HeaderRange::new(start, start + width);
    }

    let (s1, s2, s3, s4) = draw_sizes(&mut rng, settings);
    let hpk = STANDARD.encode(random_bytes::<32>());

    InterfaceObf {
        h1: ranges[0],
        h2: ranges[1],
        h3: ranges[2],
        h4: ranges[3],
        s1,
        s2,
        s3,
        s4,
        header_protection_key: hpk,
        random_trailers: settings.random_trailers,
    }
}

fn draw_sizes(rng: &mut impl Rng, settings: &ObfuscationSettings) -> (u16, u16, u16, u16) {
    let lo = settings.s_min.max(S_FLOOR_WITH_HPK) as u32;
    let hi = settings.s_max.max(settings.s_min + 8) as u32;
    let s4_lo = lo.min(32);
    for _ in 0..512 {
        let s1 = rng.random_range(lo..=hi) as u16;
        let s2 = rng.random_range(lo..=hi) as u16;
        let s3 = rng.random_range(lo..=hi) as u16;
        let s4 = rng.random_range(s4_lo..=32) as u16;
        let totals = [148 + s1 as u32, 92 + s2 as u32, 64 + s3 as u32];
        if totals[0] == totals[1] || totals[0] == totals[2] || totals[1] == totals[2] {
            continue;
        }
        if s1 == s2 || s2 == s3 || s1 == s3 {
            continue;
        }
        return (s1, s2, s3, s4);
    }
    (60, 90, 120, 32)
}

pub fn generate_client_obf(settings: &ObfuscationSettings) -> ClientObf {
    let mut rng = rand::rng();
    let jc_lo = settings.jc_min.min(settings.jc_max);
    let jc_hi = settings.jc_max.max(settings.jc_min);
    let jmin = rng.random_range(settings.jmin_min..=settings.jmin_max.max(settings.jmin_min));
    let jmax = jmin
        + rng.random_range(
            settings.jmax_extra_min..=settings.jmax_extra_max.max(settings.jmax_extra_min),
        );

    let host = settings
        .hosts
        .choose(&mut rng)
        .cloned()
        .unwrap_or_else(|| "cloudflare.com".into());

    let frames: Vec<String> = (0..5)
        .map(|_| build_packet(settings, &host, &mut rng))
        .collect();

    ClientObf {
        jc: rng.random_range(jc_lo..=jc_hi),
        jmin,
        jmax,
        i1: frames[0].clone(),
        i2: frames[1].clone(),
        i3: frames[2].clone(),
        i4: frames[3].clone(),
        i5: frames[4].clone(),
        disable_cookies: settings.disable_cookies,
    }
}

fn build_packet(settings: &ObfuscationSettings, host: &str, rng: &mut impl Rng) -> String {
    match settings.profile {
        MimicProfile::Http3 | MimicProfile::Quic => build_quic(settings, host, rng),
        MimicProfile::Tls => build_tls(settings, host, rng),
        MimicProfile::Random => {
            if rng.random_bool(0.5) {
                build_quic(settings, host, rng)
            } else {
                build_tls(settings, host, rng)
            }
        }
    }
}

fn browser_target(settings: &ObfuscationSettings, rng: &mut impl Rng) -> usize {
    let (lo, hi) = settings.browser.size_range();
    let mut target = rng.random_range(lo..=hi);
    if settings.browser.align_128() {
        target = target.div_ceil(128) * 128;
    }
    target.min(settings.mtu as usize)
}

fn build_quic(settings: &ObfuscationSettings, host: &str, rng: &mut impl Rng) -> String {
    let dcid = rng.random_range(8..=20usize);
    let scid = rng.random_range(0..=20usize);
    let sni_len = (host.len() + rng.random_range(0..7usize)).min(64);
    let pn_len = rng.random_range(1..=4usize);
    let is_initial = rng.random_bool(0.5);
    let token_len = if is_initial && rng.random_bool(0.5) {
        rng.random_range(8..=32usize)
    } else {
        0
    };

    let mut prefix = Vec::new();
    prefix.push(if is_initial { 0xc0 } else { 0xe0 } | (pn_len as u8 - 1));
    prefix.extend_from_slice(&[0, 0, 0, 1]);
    prefix.push(dcid as u8);
    prefix.extend_from_slice(&random_bytes::<20>()[..dcid]);
    prefix.push(scid as u8);
    prefix.extend_from_slice(&random_bytes::<20>()[..scid]);
    if is_initial {
        prefix.extend_from_slice(&quic_varint(token_len));
        prefix.extend_from_slice(&random_bytes::<32>()[..token_len]);
    }

    let tag_extra = sni_len + 8;
    let target = browser_target(settings, rng);
    let header = prefix.len() + 2 + pn_len;
    let pad = target
        .saturating_sub(header + tag_extra)
        .min(settings.mtu as usize);
    prefix.extend_from_slice(&quic_varint(pn_len + tag_extra + pad));
    prefix.extend_from_slice(&random_bytes::<4>()[..pn_len]);

    format!(
        "<b 0x{}><rc {}><t>{}",
        hex(&prefix),
        sni_len,
        split_pad(pad)
    )
}

fn build_tls(settings: &ObfuscationSettings, host: &str, rng: &mut impl Rng) -> String {
    let sni_ext = host.len() + 9;
    let tag_extra = sni_ext + 8;
    let target = browser_target(settings, rng);
    let fixed = 5 + 1 + 3 + 2 + 32;
    let padding = target
        .saturating_sub(fixed + tag_extra)
        .min(settings.mtu as usize);
    let record_len = 1 + 3 + 2 + 32 + tag_extra + padding;
    let handshake_len = record_len - 4;

    let mut bytes = Vec::new();
    bytes.push(0x16);
    bytes.extend_from_slice(&[0x03, 0x01]);
    bytes.extend_from_slice(&(record_len as u16).to_be_bytes());
    bytes.push(0x01);
    let hs = handshake_len as u32;
    bytes.extend_from_slice(&hs.to_be_bytes()[1..]);
    bytes.extend_from_slice(&[0x03, 0x03]);
    bytes.extend_from_slice(&random_bytes::<32>());

    format!(
        "<b 0x{}><rc {}><t>{}",
        hex(&bytes),
        sni_ext,
        split_pad(padding)
    )
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn quic_varint(value: usize) -> Vec<u8> {
    let n = value as u64;
    if n < 0x40 {
        vec![n as u8]
    } else if n < 0x4000 {
        let v = 0x4000u16 + n as u16;
        v.to_be_bytes().to_vec()
    } else {
        let v = 0x8000_0000u32 + n as u32;
        v.to_be_bytes().to_vec()
    }
}

pub fn split_pad(mut n: usize) -> String {
    let mut out = String::new();
    while n > MAX_TAG_BYTES {
        out.push_str(&format!("<r {MAX_TAG_BYTES}>"));
        n -= MAX_TAG_BYTES;
    }
    if n > 0 {
        out.push_str(&format!("<r {n}>"));
    }
    out
}

pub fn validate_client_obf(obf: &ClientObf) -> Result<(), String> {
    if obf.jmax < obf.jmin {
        return Err("Jmax must be >= Jmin".into());
    }
    if obf.jc > 128 {
        return Err("Jc is out of range".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_never_collide() {
        let settings = ObfuscationSettings::default();
        for _ in 0..500 {
            let obf = generate_interface_obf(&settings);
            assert!(obf.s1 >= S_FLOOR_WITH_HPK);
            assert!(obf.s2 >= S_FLOOR_WITH_HPK);
            assert!(obf.s3 >= S_FLOOR_WITH_HPK);
            assert!(obf.s4 <= 32);
            let totals = [148 + obf.s1 as u32, 92 + obf.s2 as u32, 64 + obf.s3 as u32];
            assert_ne!(totals[0], totals[1]);
            assert_ne!(totals[0], totals[2]);
            assert_ne!(totals[1], totals[2]);
        }
    }

    #[test]
    fn header_ranges_stay_in_zone_and_narrow() {
        let settings = ObfuscationSettings::default();
        for _ in 0..200 {
            let obf = generate_interface_obf(&settings);
            for (idx, range) in [obf.h1, obf.h2, obf.h3, obf.h4].iter().enumerate() {
                assert!(range.hi > range.lo);
                assert!(range.hi - range.lo <= HEADER_ZONE_WIDTH);
                let zone = [100_000u32, 1_000_000, 2_000_000, 3_000_000][idx];
                assert!(range.lo >= zone);
                assert!(range.hi < zone + 200_000 + 1);
            }
        }
    }

    #[test]
    fn client_packets_are_bounded() {
        let settings = ObfuscationSettings::default();
        for _ in 0..100 {
            let obf = generate_client_obf(&settings);
            assert!(obf.jmin >= settings.jmin_min);
            assert!(obf.jmax >= obf.jmin);
            assert!(obf.jc >= settings.jc_min && obf.jc <= settings.jc_max);
            for frame in [&obf.i1, &obf.i2, &obf.i3, &obf.i4, &obf.i5] {
                assert!(frame.starts_with("<b 0x"));
                assert!(frame.len() <= 2000);
            }
            validate_client_obf(&obf).unwrap();
        }
    }

    #[test]
    fn header_range_spec_roundtrip() {
        let r = HeaderRange::new(123456, 143456);
        assert_eq!(HeaderRange::parse(&r.spec()), Some(r));
        let single = HeaderRange::new(7, 7);
        assert_eq!(header_spec_single(&single), "7");
    }

    fn header_spec_single(r: &HeaderRange) -> String {
        r.spec()
    }
}
