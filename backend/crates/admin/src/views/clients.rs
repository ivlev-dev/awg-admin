use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use awg_clients::{
    Device, DevicePeer, DeviceProfile, Forwarding, ShareFormat, ShareLink, ShareLinkState,
};

#[derive(Debug, Serialize)]
pub struct PeerView {
    pub peer_id: Uuid,
    pub label: String,
    pub interface_id: Uuid,
    pub interface_name: String,
    pub public_key: String,
    pub addresses: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DeviceView {
    pub id: Uuid,
    pub user_id: Uuid,
    pub group_id: Uuid,
    pub interface_id: Uuid,
    pub interface_name: String,
    pub node_id: Uuid,
    pub node_name: String,
    pub name: String,
    pub down_kbps: u32,
    pub up_kbps: u32,
    pub forwarding: Forwarding,
    pub revoked: bool,
    #[serde(default)]
    pub external: bool,
    pub created_at: DateTime<Utc>,
    pub peers: Vec<PeerView>,
    pub addresses: Vec<String>,
}

impl DeviceView {
    pub fn build(
        device: &Device,
        peers: &[DevicePeer],
        names: &[(Uuid, Uuid, String, Vec<String>)],
        interface_name: &str,
        node_id: Uuid,
        node_name: &str,
    ) -> Self {
        let peer_views = peers
            .iter()
            .map(|peer| {
                let (name, addresses) = names
                    .iter()
                    .find(|(peer_id, _, _, _)| *peer_id == peer.id)
                    .map(|(_, _, name, addresses)| (name.clone(), addresses.clone()))
                    .unwrap_or_default();
                PeerView {
                    peer_id: peer.id,
                    label: peer.label.clone(),
                    interface_id: peer.interface_id,
                    interface_name: name,
                    public_key: peer.public_key.clone(),
                    addresses,
                }
            })
            .collect();
        let mut all_addresses: Vec<String> = peers
            .iter()
            .flat_map(|peer| peer.ips.values().map(|ip| ip.to_string()))
            .collect();
        all_addresses.sort();
        all_addresses.dedup();
        Self {
            id: device.id,
            user_id: device.user_id,
            group_id: device.group_id,
            interface_id: device.interface_id,
            interface_name: interface_name.to_string(),
            node_id,
            node_name: node_name.to_string(),
            name: device.name.clone(),
            down_kbps: device.down_kbps,
            up_kbps: device.up_kbps,
            forwarding: device.forwarding.clone(),
            revoked: device.revoked,
            external: device.external,
            created_at: device.created_at,
            peers: peer_views,
            addresses: all_addresses,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ProfileView {
    pub peer_id: Uuid,
    pub label: String,
    pub interface_id: Uuid,
    pub interface_name: String,
    pub node_id: Uuid,
    pub endpoint: String,
    pub addresses: Vec<String>,
    pub conf: String,
    pub vpn_link: String,
}

impl From<DeviceProfile> for ProfileView {
    fn from(profile: DeviceProfile) -> Self {
        Self {
            peer_id: profile.peer_id,
            label: profile.label,
            interface_id: profile.interface_id,
            interface_name: profile.interface_name,
            node_id: profile.node_id,
            endpoint: profile.endpoint,
            addresses: profile.addresses,
            conf: profile.conf,
            vpn_link: profile.vpn_link,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ShareLinkView {
    pub token: String,
    pub device_id: Uuid,
    pub interface_id: Uuid,
    pub format: ShareFormat,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub remaining_uses: Option<u32>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub state: ShareLinkState,
    pub url: String,
}

impl ShareLinkView {
    pub fn build(link: &ShareLink, public_base: &str) -> Self {
        let url = if public_base.is_empty() {
            format!("/api/v1/share/{}", link.token)
        } else {
            format!("{public_base}/api/v1/share/{}", link.token)
        };
        Self {
            token: link.token.clone(),
            device_id: link.device_id,
            interface_id: link.interface_id,
            format: link.format,
            expires_at: link.expires_at,
            created_at: link.created_at,
            used_at: link.used_at,
            max_uses: link.max_uses,
            uses: link.uses,
            remaining_uses: link.remaining_uses(),
            revoked_at: link.revoked_at,
            state: link.state(Utc::now()),
            url,
        }
    }

    pub fn build_at(link: &ShareLink, public_base: &str, now: DateTime<Utc>) -> Self {
        let mut view = Self::build(link, public_base);
        view.state = link.state(now);
        view
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(max_uses: Option<u32>, uses: u32) -> ShareLink {
        let now = Utc::now();
        ShareLink {
            token: "token".into(),
            token_hash: String::new(),
            token_sealed: String::new(),
            device_id: Uuid::nil(),
            interface_id: Uuid::nil(),
            created_by: Uuid::nil(),
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
    fn view_exposes_usage_and_state() {
        let view = ShareLinkView::build(&link(Some(5), 2), "https://vpn.example.com");
        assert_eq!(view.max_uses, Some(5));
        assert_eq!(view.uses, 2);
        assert_eq!(view.remaining_uses, Some(3));
        assert_eq!(view.state, ShareLinkState::Active);
        assert_eq!(view.url, "https://vpn.example.com/api/v1/share/token");
    }

    #[test]
    fn exhausted_and_revoked_states_are_reported() {
        let exhausted = ShareLinkView::build(&link(Some(2), 2), "");
        assert_eq!(exhausted.remaining_uses, Some(0));
        assert_eq!(exhausted.state, ShareLinkState::Exhausted);
        assert_eq!(exhausted.url, "/api/v1/share/token");

        let mut revoked = link(None, 0);
        revoked.revoked_at = Some(Utc::now());
        let view = ShareLinkView::build(&revoked, "");
        assert_eq!(view.remaining_uses, None);
        assert_eq!(view.state, ShareLinkState::Revoked);
        assert!(view.revoked_at.is_some());
    }
}
