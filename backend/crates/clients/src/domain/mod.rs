use std::collections::{BTreeMap, BTreeSet, HashSet};
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
    pub name: String,
    pub down_kbps: u32,
    pub up_kbps: u32,
    pub forwarding: Forwarding,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePeer {
    pub device_id: Uuid,
    pub interface_id: Uuid,
    pub public_key: String,
    pub private_key_sealed: String,
    pub preshared_key_sealed: String,
    pub ips: BTreeMap<Uuid, IpAddr>,
    pub client_obf: ClientObf,
    pub created_at: DateTime<Utc>,
}

impl DevicePeer {
    pub fn key(device_id: Uuid, interface_id: Uuid) -> String {
        format!("{device_id}:{interface_id}")
    }
}

pub trait DeviceRepository: Send + Sync {
    fn find(&self, id: Uuid) -> CoreResult<Option<Device>>;
    fn list(&self) -> CoreResult<Vec<Device>>;
    fn by_user(&self, user_id: Uuid) -> CoreResult<Vec<Device>>;
    fn by_group(&self, group_id: Uuid) -> CoreResult<Vec<Device>>;
    fn save(&self, device: &Device) -> CoreResult<()>;
    fn delete(&self, id: Uuid) -> CoreResult<()>;
}

pub trait DevicePeerRepository: Send + Sync {
    fn find(&self, device_id: Uuid, interface_id: Uuid) -> CoreResult<Option<DevicePeer>>;
    fn list(&self) -> CoreResult<Vec<DevicePeer>>;
    fn by_device(&self, device_id: Uuid) -> CoreResult<Vec<DevicePeer>>;
    fn by_interface(&self, interface_id: Uuid) -> CoreResult<Vec<DevicePeer>>;
    fn save(&self, peer: &DevicePeer) -> CoreResult<()>;
    fn delete_for_device(&self, device_id: Uuid) -> CoreResult<usize>;
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
        let mut out = Vec::new();
        for from in devices {
            for to in devices {
                if Self::allows(from, to) {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLink {
    pub token: String,
    pub device_id: Uuid,
    pub interface_id: Uuid,
    pub created_by: Uuid,
    pub format: ShareFormat,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

pub trait ShareLinkRepository: Send + Sync {
    fn find(&self, token: &str) -> CoreResult<Option<ShareLink>>;
    fn list(&self) -> CoreResult<Vec<ShareLink>>;
    fn save(&self, link: &ShareLink) -> CoreResult<()>;
    fn delete(&self, token: &str) -> CoreResult<()>;
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
            name: "d".into(),
            down_kbps: 0,
            up_kbps: 0,
            forwarding: Forwarding {
                to_own_devices: allow,
                allowed_devices: vec![],
            },
            revoked: false,
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
}
