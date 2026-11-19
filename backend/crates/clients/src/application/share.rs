use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use awg_shared::crypto::random_bytes;
use awg_shared::{CoreError, CoreResult};

use crate::application::ProfileService;
use crate::domain::{
    ShareConsume, ShareFormat, ShareLink, ShareLinkRepository, ShareLinkState, hash_share_token,
};

pub const MAX_USES_RANGE: std::ops::RangeInclusive<u32> = 1..=1000;

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
        max_uses: Option<u32>,
    ) -> CoreResult<ShareLink> {
        if max_uses.is_some_and(|max| !MAX_USES_RANGE.contains(&max)) {
            return Err(CoreError::Invalid(
                "max_uses must be between 1 and 1000".into(),
            ));
        }
        self.profiles.build_one(device_id, interface_id)?;
        let now = Utc::now();
        let token = hex(&random_bytes::<24>());
        let link = ShareLink {
            token_hash: hash_share_token(&token),
            token_sealed: String::new(),
            token,
            device_id,
            interface_id,
            created_by,
            format,
            expires_at: now + Duration::seconds(ttl_secs.clamp(60, 30 * 86_400) as i64),
            used_at: None,
            max_uses,
            uses: 0,
            revoked_at: None,
            created_at: now,
        };
        self.links.save(&link)?;
        Ok(link)
    }

    pub fn find(&self, token: &str) -> CoreResult<Option<ShareLink>> {
        self.links.find(token)
    }

    pub fn resolve(&self, token: &str) -> CoreResult<(ShareLink, String)> {
        let now = Utc::now();
        let link = self
            .links
            .find(token)?
            .ok_or_else(|| CoreError::NotFound("share link".into()))?;
        inactive_error(link.state(now))?;
        let profile = self.profiles.build_one(link.device_id, link.interface_id)?;
        let content = match link.format {
            ShareFormat::Conf => profile.conf,
            ShareFormat::Vpn => profile.vpn_link,
        };
        match self.links.consume(token, now)? {
            ShareConsume::Consumed(link) => Ok((link, content)),
            outcome => Err(consume_error(outcome)),
        }
    }

    pub fn list_for_device(&self, device_id: Uuid) -> CoreResult<Vec<ShareLink>> {
        let mut links: Vec<ShareLink> = self
            .links
            .list()?
            .into_iter()
            .filter(|link| link.device_id == device_id)
            .collect();
        links.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.token.cmp(&right.token))
        });
        Ok(links)
    }

    pub fn revoke_all_for_device(&self, device_id: Uuid) -> CoreResult<usize> {
        self.links.revoke_all_for_device(device_id, Utc::now())
    }

    /// Marks a share link as revoked. The record is kept for the audit trail;
    /// revocation is enforced by `resolve`.
    pub fn revoke(&self, token: &str) -> CoreResult<()> {
        let mut link = self
            .links
            .find(token)?
            .ok_or_else(|| CoreError::NotFound("share link".into()))?;
        if link.revoked_at.is_none() {
            link.revoked_at = Some(Utc::now());
            self.links.save(&link)?;
        }
        Ok(())
    }

    pub fn revoke_created_by(&self, user_id: Uuid) -> CoreResult<usize> {
        let now = Utc::now();
        let mut revoked = 0;
        for mut link in self.links.list()? {
            if link.created_by != user_id || link.revoked_at.is_some() {
                continue;
            }
            link.revoked_at = Some(now);
            self.links.save(&link)?;
            revoked += 1;
        }
        Ok(revoked)
    }

    /// Drops expired links and revoked links older than `revoked_retention_days`.
    pub fn prune_expired(
        &self,
        now: DateTime<Utc>,
        revoked_retention_days: i64,
    ) -> CoreResult<usize> {
        let cutoff = now - Duration::days(revoked_retention_days.max(0));
        let mut removed = 0;
        for link in self.links.list()? {
            let expired = link.expires_at <= now;
            let revoked_old = link.revoked_at.is_some_and(|at| at <= cutoff);
            if expired || revoked_old {
                self.links.delete(&link.token)?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

fn inactive_error(state: ShareLinkState) -> CoreResult<()> {
    match state {
        ShareLinkState::Active => Ok(()),
        ShareLinkState::Revoked => Err(CoreError::Forbidden("share link has been revoked".into())),
        ShareLinkState::Expired => Err(CoreError::Forbidden("share link has expired".into())),
        ShareLinkState::Exhausted => {
            Err(CoreError::Forbidden("share link has been exhausted".into()))
        }
    }
}

fn consume_error(outcome: ShareConsume) -> CoreError {
    match outcome {
        ShareConsume::NotFound => CoreError::NotFound("share link".into()),
        ShareConsume::Revoked => CoreError::Forbidden("share link has been revoked".into()),
        ShareConsume::Expired => CoreError::Forbidden("share link has expired".into()),
        ShareConsume::Exhausted => CoreError::Forbidden("share link has been exhausted".into()),
        ShareConsume::Consumed(_) => CoreError::Forbidden("share link is not available".into()),
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
