use std::sync::Arc;

use chrono::{Duration, Utc};
use uuid::Uuid;

use awg_shared::crypto::random_bytes;
use awg_shared::{CoreError, CoreResult};

use crate::application::ProfileService;
use crate::domain::{ShareFormat, ShareLink, ShareLinkRepository};

pub struct ShareService {
    links: Arc<dyn ShareLinkRepository>,
    profiles: Arc<ProfileService>,
}

impl ShareService {
    pub fn new(links: Arc<dyn ShareLinkRepository>, profiles: Arc<ProfileService>) -> Self {
        Self { links, profiles }
    }

    pub fn create(
        &self,
        device_id: Uuid,
        interface_id: Uuid,
        created_by: Uuid,
        format: ShareFormat,
        ttl_secs: u64,
    ) -> CoreResult<ShareLink> {
        self.profiles.build_one(device_id, interface_id)?;
        let now = Utc::now();
        let link = ShareLink {
            token: hex(&random_bytes::<24>()),
            device_id,
            interface_id,
            created_by,
            format,
            expires_at: now + Duration::seconds(ttl_secs.clamp(60, 30 * 86_400) as i64),
            used_at: None,
            created_at: now,
        };
        self.links.save(&link)?;
        Ok(link)
    }

    pub fn resolve(&self, token: &str) -> CoreResult<(ShareLink, String)> {
        let mut link = self
            .links
            .find(token)?
            .ok_or_else(|| CoreError::NotFound("share link".into()))?;
        if link.expires_at <= Utc::now() {
            return Err(CoreError::Forbidden("share link has expired".into()));
        }
        let profile = self.profiles.build_one(link.device_id, link.interface_id)?;
        let content = match link.format {
            ShareFormat::Conf => profile.conf,
            ShareFormat::Vpn => profile.vpn_link,
        };
        link.used_at = Some(Utc::now());
        self.links.save(&link)?;
        Ok((link, content))
    }

    pub fn list_for_device(&self, device_id: Uuid) -> CoreResult<Vec<ShareLink>> {
        Ok(self
            .links
            .list()?
            .into_iter()
            .filter(|l| l.device_id == device_id && l.expires_at > Utc::now())
            .collect())
    }

    pub fn revoke(&self, token: &str) -> CoreResult<()> {
        self.links.delete(token)
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
