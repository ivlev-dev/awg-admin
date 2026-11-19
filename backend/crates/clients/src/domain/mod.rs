use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::net::IpAddr;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use awg_shared::obf::ClientObf;
use awg_shared::{CoreError, CoreResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Forwarding {
    #[serde(default)]
    pub to_own_devices: bool,
    #[serde(default)]
    pub allowed_devices: Vec<Uuid>,
}

impl AsRef<Forwarding> for Forwarding {
    fn as_ref(&self) -> &Forwarding {
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: Uuid,
    pub user_id: Uuid,
    pub group_id: Uuid,
    #[serde(default)]
    pub interface_id: Uuid,
    pub name: String,
    pub down_kbps: u32,
    pub up_kbps: u32,
    pub forwarding: Forwarding,
    pub revoked: bool,
    #[serde(default)]
    pub external: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePeer {
    #[serde(default)]
    pub id: Uuid,
    pub device_id: Uuid,
    pub interface_id: Uuid,
    #[serde(default)]
    pub label: String,
    pub public_key: String,
    pub private_key_sealed: String,
    pub preshared_key_sealed: String,
    pub ips: BTreeMap<Uuid, IpAddr>,
    pub client_obf: ClientObf,
    pub created_at: DateTime<Utc>,
}

impl DevicePeer {
    pub fn key(&self) -> String {
        Self::storage_key(self.device_id, self.interface_id, self.id)
    }

    pub fn storage_key(device_id: Uuid, interface_id: Uuid, peer_id: Uuid) -> String {
        format!("{device_id}:{interface_id}:{peer_id}")
    }

    pub fn primary_order(&self) -> (&str, Uuid) {
        (self.label.as_str(), self.id)
    }

    pub fn is_primary_of(&self, other: &DevicePeer) -> bool {
        self.primary_order() < other.primary_order()
    }
}

pub fn validate_peer_label(label: &str) -> CoreResult<()> {
    let trimmed = label.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(CoreError::Invalid(
            "peer label must be 1..64 characters".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DevicePageStatus {
    #[default]
    All,
    Active,
    Revoked,
}

impl DevicePageStatus {
    pub fn parse(raw: Option<&str>) -> CoreResult<Self> {
        match raw.map(str::trim).filter(|value| !value.is_empty()) {
            None => Ok(Self::All),
            Some(value) if value.eq_ignore_ascii_case("all") => Ok(Self::All),
            Some(value) if value.eq_ignore_ascii_case("active") => Ok(Self::Active),
            Some(value) if value.eq_ignore_ascii_case("revoked") => Ok(Self::Revoked),
            Some(value) => Err(CoreError::Invalid(format!(
                "status must be one of all, active, revoked (got {value})"
            ))),
        }
    }

    pub fn matches(self, revoked: bool) -> bool {
        match self {
            Self::All => true,
            Self::Active => !revoked,
            Self::Revoked => revoked,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DevicePageSort {
    #[default]
    Name,
    Created,
}

impl DevicePageSort {
    pub fn parse(raw: Option<&str>) -> CoreResult<Self> {
        match raw.map(str::trim).filter(|value| !value.is_empty()) {
            None => Ok(Self::Name),
            Some(value) if value.eq_ignore_ascii_case("name") => Ok(Self::Name),
            Some(value) if value.eq_ignore_ascii_case("created") => Ok(Self::Created),
            Some(value) => Err(CoreError::Invalid(format!(
                "sort must be one of name, created (got {value})"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DevicePageOrder {
    #[default]
    Asc,
    Desc,
}

impl DevicePageOrder {
    pub fn parse(raw: Option<&str>) -> CoreResult<Self> {
        match raw.map(str::trim).filter(|value| !value.is_empty()) {
            None => Ok(Self::Asc),
            Some(value) if value.eq_ignore_ascii_case("asc") => Ok(Self::Asc),
            Some(value) if value.eq_ignore_ascii_case("desc") => Ok(Self::Desc),
            Some(value) => Err(CoreError::Invalid(format!(
                "order must be one of asc, desc (got {value})"
            ))),
        }
    }
}

pub const DEFAULT_DEVICE_PAGE_LIMIT: usize = 50;
pub const MAX_DEVICE_PAGE_LIMIT: usize = 200;

#[derive(Debug, Clone)]
pub struct DevicePageQuery {
    pub limit: usize,
    pub offset: usize,
    pub q: Option<String>,
    pub status: DevicePageStatus,
    pub interface_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub sort: DevicePageSort,
    pub order: DevicePageOrder,
    pub owner_emails: HashMap<Uuid, String>,
}

impl DevicePageQuery {
    pub fn with_owner_emails(mut self, owner_emails: HashMap<Uuid, String>) -> Self {
        self.owner_emails = owner_emails;
        self
    }

    pub fn normalize_q(q: Option<&str>) -> Option<String> {
        q.map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase)
    }

    pub fn q_matches(&self, name: &str, user_id: Uuid) -> bool {
        let Some(q) = self.q.as_deref() else {
            return true;
        };
        if name.to_lowercase().contains(q) {
            return true;
        }
        self.owner_emails
            .get(&user_id)
            .is_some_and(|email| email.to_lowercase().contains(q))
    }

    pub fn matches(&self, device: &Device) -> bool {
        if let Some(user_id) = self.user_id
            && device.user_id != user_id
        {
            return false;
        }
        if let Some(interface_id) = self.interface_id
            && device.interface_id != interface_id
        {
            return false;
        }
        if !self.status.matches(device.revoked) {
            return false;
        }
        self.q_matches(&device.name, device.user_id)
    }

    pub fn sort_devices(&self, devices: &mut [Device]) {
        match self.sort {
            DevicePageSort::Name => devices.sort_by(|left, right| {
                left.name
                    .to_lowercase()
                    .cmp(&right.name.to_lowercase())
                    .then_with(|| left.id.cmp(&right.id))
            }),
            DevicePageSort::Created => devices.sort_by(|left, right| {
                left.created_at
                    .timestamp_micros()
                    .cmp(&right.created_at.timestamp_micros())
                    .then_with(|| left.id.cmp(&right.id))
            }),
        }
        if self.order == DevicePageOrder::Desc {
            devices.reverse();
        }
    }
}

#[derive(Debug, Clone)]
pub struct DevicePage {
    pub items: Vec<Device>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

pub trait DeviceRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Device>>;
    fn list(&self) -> CoreResult<Vec<Device>>;
    fn by_user(&self, user_id: Uuid) -> CoreResult<Vec<Device>>;
    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Device>>;
    fn save(&self, device: &Device) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;

    fn page(&self, query: &DevicePageQuery) -> CoreResult<DevicePage> {
        let mut matched: Vec<Device> = self
            .list()?
            .into_iter()
            .filter(|device| query.matches(device))
            .collect();
        let total = matched.len();
        query.sort_devices(&mut matched);
        let items = matched
            .into_iter()
            .skip(query.offset)
            .take(query.limit)
            .collect();
        Ok(DevicePage {
            items,
            total,
            limit: query.limit,
            offset: query.offset,
        })
    }
}

pub trait DevicePeerRepository: Send + Sync {
    fn find(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<Option<DevicePeer>>;
    fn find_peer(&self, peer_id: Uuid) -> CoreResult<Option<DevicePeer>> {
        Ok(self.list()?.into_iter().find(|peer| peer.id == peer_id))
    }
    fn list(&self) -> CoreResult<Vec<DevicePeer>>;
    fn by_device(&self, device_id: Uuid) -> CoreResult<Vec<DevicePeer>>;
    fn by_interface(&self, interface_id: Uuid) -> CoreResult<Vec<DevicePeer>>;
    fn by_devices(&self, device_ids: &[Uuid]) -> CoreResult<Vec<DevicePeer>> {
        if device_ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids: HashSet<Uuid> = device_ids.iter().copied().collect();
        Ok(self
            .list()?
            .into_iter()
            .filter(|peer| ids.contains(&peer.device_id))
            .collect())
    }
    fn save(&self, peer: &DevicePeer) -> CoreResult<()>;
    fn delete_for_device(&self, device_id: Uuid) -> CoreResult<usize>;
    fn delete_peer(&self, peer_id: Uuid) -> CoreResult<()>;
    fn delete(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<()>;
}

pub struct ForwardingPolicy;

impl ForwardingPolicy {
    pub fn normalize(forwarding: impl AsRef<Forwarding>) -> Forwarding {
        let forwarding = forwarding.as_ref();
        let allowed: BTreeSet<Uuid> = forwarding.allowed_devices.iter().copied().collect();
        let mut result = Forwarding {
            to_own_devices: forwarding.to_own_devices,
            allowed_devices: allowed.into_iter().collect(),
        };
        if result.to_own_devices {
            result.allowed_devices.clear();
        }
        result
    }

    pub fn validate(device: &Device, other_devices: &[Device]) -> CoreResult<()> {
        let own: HashSet<Uuid> = other_devices
            .iter()
            .filter(|d| d.user_id == device.user_id && d.id != device.id)
            .map(|d| d.id)
            .collect();
        for allowed in &device.forwarding.allowed_devices {
            if !own.contains(allowed) {
                return Err(CoreError::Invalid(
                    "forwarding may only be allowed between devices of the same user".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn allows(from: &Device, to: &Device) -> bool {
        if from.id == to.id || from.revoked || to.revoked {
            return false;
        }
        if from.user_id != to.user_id {
            return false;
        }
        from.forwarding.to_own_devices || from.forwarding.allowed_devices.contains(&to.id)
    }

    pub fn allowed_pairs(devices: &[Device]) -> Vec<(Uuid, Uuid)> {
        let mut by_id: HashMap<Uuid, &Device> = HashMap::with_capacity(devices.len());
        let mut by_user: HashMap<Uuid, Vec<&Device>> = HashMap::new();
        for device in devices {
            by_id.insert(device.id, device);
            by_user.entry(device.user_id).or_default().push(device);
        }

        let mut out = Vec::new();
        for from in devices {
            if from.revoked {
                continue;
            }
            if from.forwarding.to_own_devices {
                if let Some(candidates) = by_user.get(&from.user_id) {
                    for to in candidates {
                        if Self::allows(from, to) {
                            out.push((from.id, to.id));
                        }
                    }
                }
                continue;
            }
            for allowed in &from.forwarding.allowed_devices {
                if let Some(to) = by_id.get(allowed)
                    && Self::allows(from, to)
                {
                    out.push((from.id, to.id));
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareFormat {
    Conf,
    Vpn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareLinkState {
    Active,
    Expired,
    Exhausted,
    Revoked,
}

pub fn hash_share_token(token: &str) -> String {
    awg_shared::crypto::sha256_hex(token.as_bytes())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLink {
    #[serde(default, skip_serializing)]
    pub token: String,
    #[serde(default)]
    pub token_hash: String,
    #[serde(default)]
    pub token_sealed: String,
    pub device_id: Uuid,
    pub interface_id: Uuid,
    pub created_by: Uuid,
    pub format: ShareFormat,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub max_uses: Option<u32>,
    #[serde(default)]
    pub uses: u32,
    #[serde(default)]
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl ShareLink {
    pub fn state(&self, now: DateTime<Utc>) -> ShareLinkState {
        if self.revoked_at.is_some() {
            ShareLinkState::Revoked
        } else if self.expires_at <= now {
            ShareLinkState::Expired
        } else if self.max_uses.is_some_and(|max| self.uses >= max) {
            ShareLinkState::Exhausted
        } else {
            ShareLinkState::Active
        }
    }

    pub fn remaining_uses(&self) -> Option<u32> {
        self.max_uses.map(|max| max.saturating_sub(self.uses))
    }
}

#[derive(Debug, Clone)]
pub enum ShareConsume {
    Consumed(ShareLink),
    NotFound,
    Revoked,
    Expired,
    Exhausted,
}

pub trait ShareLinkRepository: Send + Sync {
    fn find(&self, token: &str) -> CoreResult<Option<ShareLink>>;
    fn list(&self) -> CoreResult<Vec<ShareLink>>;
    fn save(&self, link: &ShareLink) -> CoreResult<()>;
    fn delete(&self, token: &str) -> CoreResult<()>;
    fn consume(&self, token: &str, now: DateTime<Utc>) -> CoreResult<ShareConsume>;

    fn revoke_all_for_device(&self, device_id: Uuid, now: DateTime<Utc>) -> CoreResult<usize> {
        let mut revoked = 0;
        for mut link in self.list()? {
            if link.device_id != device_id || link.state(now) != ShareLinkState::Active {
                continue;
            }
            link.revoked_at = Some(now);
            self.save(&link)?;
            revoked += 1;
        }
        Ok(revoked)
    }
}

pub fn validate_device_name(name: &str) -> CoreResult<()> {
    if name.trim().is_empty() || name.len() > 64 {
        return Err(CoreError::Invalid(
            "device name must be 1..64 characters".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(user: Uuid, allow: bool) -> Device {
        Device {
            id: Uuid::new_v4(),
            user_id: user,
            group_id: Uuid::nil(),
            interface_id: Uuid::new_v4(),
            name: "d".into(),
            down_kbps: 0,
            up_kbps: 0,
            forwarding: Forwarding {
                to_own_devices: allow,
                allowed_devices: vec![],
            },
            revoked: false,
            external: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn forwarding_is_scoped_to_the_same_user() {
        let user = Uuid::new_v4();
        let other = Uuid::new_v4();
        let a = device(user, true);
        let b = device(user, false);
        let c = device(other, true);
        assert!(ForwardingPolicy::allows(&a, &b));
        assert!(!ForwardingPolicy::allows(&b, &a));
        assert!(!ForwardingPolicy::allows(&c, &a));
        assert!(!ForwardingPolicy::allows(&a, &c));
    }

    #[test]
    fn allowed_pairs_matches_brute_force() {
        let user = Uuid::new_v4();
        let other = Uuid::new_v4();
        let mut devices = vec![
            device(user, true),
            device(user, false),
            device(user, false),
            device(other, true),
            device(other, false),
        ];
        let second = devices[2].id;
        let third = devices[3].id;
        devices[1].forwarding.allowed_devices = vec![second, third];
        devices[3].revoked = true;

        let pairs = ForwardingPolicy::allowed_pairs(&devices);
        let mut expected = Vec::new();
        for from in &devices {
            for to in &devices {
                if from.id != to.id
                    && !from.revoked
                    && !to.revoked
                    && from.user_id == to.user_id
                    && (from.forwarding.to_own_devices
                        || from.forwarding.allowed_devices.contains(&to.id))
                {
                    expected.push((from.id, to.id));
                }
            }
        }
        expected.sort();
        expected.dedup();
        assert_eq!(pairs, expected);
    }

    #[test]
    fn normalize_dedups_and_sorts() {
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        let forwarding = Forwarding {
            to_own_devices: false,
            allowed_devices: vec![id2, id1, id1],
        };
        let mut expected = vec![id1, id2];
        expected.sort();
        expected.dedup();
        let normalized = ForwardingPolicy::normalize(forwarding);
        assert_eq!(normalized.allowed_devices, expected);
    }

    #[test]
    fn normalize_clears_list_when_all() {
        let id = Uuid::new_v4();
        let forwarding = Forwarding {
            to_own_devices: true,
            allowed_devices: vec![id],
        };
        let normalized = ForwardingPolicy::normalize(forwarding);
        assert!(normalized.to_own_devices);
        assert!(normalized.allowed_devices.is_empty());
    }

    #[test]
    fn normalize_accepts_reference() {
        let id = Uuid::new_v4();
        let forwarding = Forwarding {
            to_own_devices: false,
            allowed_devices: vec![id, id],
        };
        let normalized = ForwardingPolicy::normalize(&forwarding);
        assert_eq!(normalized.allowed_devices, vec![id]);
        assert_eq!(forwarding.allowed_devices.len(), 2);
    }

    #[test]
    fn validate_rejects_self() {
        let user = Uuid::new_v4();
        let mut a = device(user, false);
        a.forwarding.allowed_devices = vec![a.id];
        let err = ForwardingPolicy::validate(&a, std::slice::from_ref(&a)).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));
    }

    #[test]
    fn validate_rejects_foreign() {
        let user = Uuid::new_v4();
        let other = Uuid::new_v4();
        let a = device(user, false);
        let b = device(other, false);
        let mut a2 = a.clone();
        a2.forwarding.allowed_devices = vec![b.id];
        let err = ForwardingPolicy::validate(&a2, &[b]).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));
    }

    fn share_link(max_uses: Option<u32>, uses: u32) -> ShareLink {
        let now = Utc::now();
        ShareLink {
            token: "token".into(),
            token_hash: String::new(),
            token_sealed: String::new(),
            device_id: Uuid::new_v4(),
            interface_id: Uuid::new_v4(),
            created_by: Uuid::new_v4(),
            format: ShareFormat::Conf,
            expires_at: now + chrono::Duration::hours(1),
            used_at: None,
            max_uses,
            uses,
            revoked_at: None,
            created_at: now,
        }
    }

    #[test]
    fn share_link_state_prefers_revoked() {
        let now = Utc::now();
        let mut link = share_link(Some(1), 1);
        assert_eq!(link.state(now), ShareLinkState::Exhausted);
        link.revoked_at = Some(now);
        assert_eq!(link.state(now), ShareLinkState::Revoked);

        let mut expired = share_link(None, 0);
        expired.expires_at = now - chrono::Duration::seconds(1);
        assert_eq!(expired.state(now), ShareLinkState::Expired);

        assert_eq!(share_link(None, 10).state(now), ShareLinkState::Active);
    }

    #[test]
    fn share_link_remaining_uses_saturates() {
        assert_eq!(share_link(None, 3).remaining_uses(), None);
        assert_eq!(share_link(Some(5), 2).remaining_uses(), Some(3));
        assert_eq!(share_link(Some(2), 7).remaining_uses(), Some(0));
    }

    #[test]
    fn peer_key_includes_peer_id_and_legacy_json_defaults() {
        let now = Utc::now();
        let device_id = Uuid::new_v4();
        let interface_id = Uuid::new_v4();
        let peer_id = Uuid::new_v4();
        let json = serde_json::json!({
            "device_id": device_id,
            "interface_id": interface_id,
            "public_key": "key",
            "private_key_sealed": "",
            "preshared_key_sealed": "",
            "ips": {},
            "client_obf": {
                "jc": 0, "jmin": 0, "jmax": 0,
                "i1": "", "i2": "", "i3": "", "i4": "", "i5": "",
                "disable_cookies": false,
                "keepalive_low": 10, "keepalive_high": 50
            },
            "created_at": now,
        });
        let legacy: DevicePeer = serde_json::from_value(json).unwrap();
        assert!(legacy.id.is_nil());
        assert!(legacy.label.is_empty());
        assert_eq!(
            legacy.key(),
            DevicePeer::storage_key(device_id, interface_id, Uuid::nil())
        );

        let peer = DevicePeer {
            id: peer_id,
            label: "phone".into(),
            ..legacy
        };
        assert_eq!(peer.key(), format!("{device_id}:{interface_id}:{peer_id}"));
    }

    #[test]
    fn peer_label_is_validated() {
        assert!(validate_peer_label("phone").is_ok());
        assert!(validate_peer_label("").is_err());
        assert!(validate_peer_label("   ").is_err());
        assert!(validate_peer_label(&"a".repeat(65)).is_err());
        assert!(validate_peer_label(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn legacy_share_json_without_new_fields_deserializes() {
        let now = Utc::now();
        let json = serde_json::json!({
            "token": "legacy",
            "device_id": Uuid::new_v4(),
            "interface_id": Uuid::new_v4(),
            "created_by": Uuid::new_v4(),
            "format": "conf",
            "expires_at": now,
            "used_at": null,
            "created_at": now,
        });
        let link: ShareLink = serde_json::from_value(json).unwrap();
        assert_eq!(link.max_uses, None);
        assert_eq!(link.uses, 0);
        assert_eq!(link.revoked_at, None);
        assert_eq!(link.remaining_uses(), None);
    }
}
