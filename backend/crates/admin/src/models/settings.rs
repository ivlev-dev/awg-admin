use serde::Deserialize;
#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub obfuscation: Option<awg_shared::obf::ObfuscationSettings>,
    pub share_default_ttl_secs: Option<u64>,
    pub stats_retention_days: Option<u64>,
}
