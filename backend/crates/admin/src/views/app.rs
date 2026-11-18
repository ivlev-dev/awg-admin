use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use awg_billing::{Plan, Subscription};
use awg_clients::DeviceProfile;
use awg_tariffs::Tariff;

use crate::views::{DeviceView, QuotaView, UserView};

pub const REVISION_LEN: usize = 16;

pub const REASON_QUOTA_EXCEEDED: &str = "quota_exceeded";
pub const REASON_SUBSCRIPTION_INACTIVE: &str = "subscription_inactive";
pub const REASON_TARIFF_MISSING: &str = "tariff_missing";

#[derive(Debug, Serialize)]
pub struct AppTariffView {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub max_devices: u32,
    pub device_down_kbps: u32,
    pub device_up_kbps: u32,
    pub traffic_quota_bytes: Option<u64>,
}

impl From<&Tariff> for AppTariffView {
    fn from(tariff: &Tariff) -> Self {
        Self {
            id: tariff.id,
            name: tariff.name.clone(),
            description: tariff.description.clone(),
            max_devices: tariff.max_devices,
            device_down_kbps: tariff.device_down_kbps,
            device_up_kbps: tariff.device_up_kbps,
            traffic_quota_bytes: tariff.traffic_quota_bytes,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceConfigView {
    pub interface_id: Uuid,
    pub interface_name: String,
    pub node_id: Uuid,
    pub endpoint: String,
    pub addresses: Vec<String>,
    pub conf: String,
    pub revision: String,
}

impl From<DeviceProfile> for DeviceConfigView {
    fn from(profile: DeviceProfile) -> Self {
        let revision = revision(&profile.conf);
        Self {
            interface_id: profile.interface_id,
            interface_name: profile.interface_name,
            node_id: profile.node_id,
            endpoint: profile.endpoint,
            addresses: profile.addresses,
            conf: profile.conf,
            revision,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AppBootstrapView {
    pub user: UserView,
    pub tariff: Option<AppTariffView>,
    pub quota: QuotaView,
    pub subscription: Option<AppSubscriptionView>,
    pub access: AppAccessView,
    pub devices: Vec<DeviceView>,
    pub interfaces: Vec<AppInterfaceView>,
}

#[derive(Debug, Serialize)]
pub struct AppInterfaceView {
    pub id: Uuid,
    pub name: String,
    pub node_id: Uuid,
    pub node_name: String,
}

#[derive(Debug, Serialize)]
pub struct AppSubscriptionView {
    pub id: Uuid,
    pub plan_name: String,
    pub status: String,
    pub current_period_end: DateTime<Utc>,
    pub auto_renew: bool,
    pub cancel_at_period_end: bool,
    pub grants_access: bool,
}

impl AppSubscriptionView {
    pub fn build(subscription: &Subscription, plan: Option<&Plan>) -> Self {
        Self {
            id: subscription.id,
            plan_name: plan.map(|plan| plan.name.clone()).unwrap_or_default(),
            status: subscription.status.as_str().to_string(),
            current_period_end: subscription.current_period_end,
            auto_renew: subscription.auto_renew,
            cancel_at_period_end: subscription.cancel_at_period_end,
            grants_access: subscription.grants_access(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AppAccessView {
    pub blocked: bool,
    pub throttled: bool,
    pub reasons: Vec<&'static str>,
}

impl AppAccessView {
    pub fn build(tariff_missing: bool, quota_exceeded: bool, subscription_inactive: bool) -> Self {
        let mut reasons = Vec::new();
        if quota_exceeded {
            reasons.push(REASON_QUOTA_EXCEEDED);
        }
        if subscription_inactive {
            reasons.push(REASON_SUBSCRIPTION_INACTIVE);
        }
        if tariff_missing {
            reasons.push(REASON_TARIFF_MISSING);
        }
        Self {
            blocked: tariff_missing,
            throttled: quota_exceeded || subscription_inactive,
            reasons,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AppDeviceView {
    pub device: DeviceView,
    pub config: DeviceConfigView,
    pub configs: Vec<DeviceConfigView>,
}

pub fn revision(conf: &str) -> String {
    let digest = Sha256::digest(conf.as_bytes());
    digest
        .iter()
        .take(REVISION_LEN / 2)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use awg_billing::{BillingPeriod, SubscriptionStatus};

    #[test]
    fn revision_is_stable_hex_prefix_of_sha256() {
        let conf = "[Interface]\nPrivateKey = key\n";
        let first = revision(conf);
        assert_eq!(first, revision(conf));
        assert_eq!(first.len(), REVISION_LEN);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(first, first.to_ascii_lowercase());

        let second = revision("[Interface]\nPrivateKey = other\n");
        assert_ne!(first, second);
        assert_eq!(second.len(), REVISION_LEN);
    }

    fn subscription(status: SubscriptionStatus) -> Subscription {
        let now = Utc::now();
        Subscription {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            status,
            current_period_start: now,
            current_period_end: now + chrono::Duration::days(30),
            auto_renew: true,
            cancel_at_period_end: false,
            trial_ends_at: None,
            gateway: None,
            gateway_ref: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn plan(name: &str) -> Plan {
        let now = Utc::now();
        Plan {
            id: Uuid::new_v4(),
            name: name.into(),
            description: String::new(),
            price_cents: 0,
            currency: "RUB".into(),
            period: BillingPeriod::Month,
            tariff_id: Uuid::new_v4(),
            active: true,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn subscription_view_projects_subscription_and_plan() {
        let subscription = subscription(SubscriptionStatus::Active);
        let plan = plan("Pro");
        let view = AppSubscriptionView::build(&subscription, Some(&plan));
        let json = serde_json::to_value(&view).unwrap();

        assert_eq!(json["id"], subscription.id.to_string());
        assert_eq!(json["plan_name"], "Pro");
        assert_eq!(json["status"], "active");
        assert_eq!(json["grants_access"], true);
        assert_eq!(json["auto_renew"], true);
        assert_eq!(json["cancel_at_period_end"], false);

        let orphan = AppSubscriptionView::build(&subscription, None);
        assert_eq!(orphan.plan_name, "");
    }

    #[test]
    fn access_without_tariff_is_blocked() {
        let view = AppAccessView::build(true, false, false);
        let json = serde_json::to_value(&view).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "blocked": true,
                "throttled": false,
                "reasons": ["tariff_missing"]
            })
        );
    }

    #[test]
    fn access_reports_quota_and_subscription_reasons() {
        let quota = AppAccessView::build(false, true, false);
        assert!(!quota.blocked);
        assert!(quota.throttled);
        assert_eq!(quota.reasons, vec![REASON_QUOTA_EXCEEDED]);

        let inactive = AppAccessView::build(false, false, true);
        assert!(!inactive.blocked);
        assert!(inactive.throttled);
        assert_eq!(inactive.reasons, vec![REASON_SUBSCRIPTION_INACTIVE]);

        let both = AppAccessView::build(true, true, true);
        assert!(both.blocked);
        assert!(both.throttled);
        assert_eq!(
            both.reasons,
            vec![
                REASON_QUOTA_EXCEEDED,
                REASON_SUBSCRIPTION_INACTIVE,
                REASON_TARIFF_MISSING
            ]
        );
    }

    #[test]
    fn healthy_access_has_no_reasons() {
        let view = AppAccessView::build(false, false, false);
        assert!(!view.blocked);
        assert!(!view.throttled);
        assert!(view.reasons.is_empty());
    }
}
