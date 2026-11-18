use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use awg_shared::obf::ObfuscationSettings;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::UpdateSettingsRequest;
use crate::settings::Settings;
use crate::state::AppState;

#[derive(serde::Serialize)]
pub struct SettingsView {
    pub obfuscation: ObfuscationSettings,
    pub share_default_ttl_secs: u64,
    pub stats_retention_days: u64,
}

impl From<Settings> for SettingsView {
    fn from(settings: Settings) -> Self {
        let stats_retention_days = settings.effective_stats_retention_days();
        Self {
            obfuscation: settings.obfuscation,
            share_default_ttl_secs: settings.share_default_ttl_secs,
            stats_retention_days,
        }
    }
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<SettingsView>> {
    user.require_admin()?;
    let settings = state.settings.get().map_err(ApiError::from)?;
    Ok(Json(settings.into()))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<UpdateSettingsRequest>,
) -> ApiResult<Json<SettingsView>> {
    user.require_admin()?;
    let mut settings = state.settings.get().map_err(ApiError::from)?;
    if let Some(obfuscation) = request.obfuscation {
        if obfuscation.s_min < awg_shared::obf::S_FLOOR_WITH_HPK {
            return Err(ApiError::BadRequest(
                "S padding must be at least 12 when header protection is on".into(),
            ));
        }
        if obfuscation.keepalive_min == 0
            || obfuscation.keepalive_max == 0
            || obfuscation.keepalive_min > obfuscation.keepalive_max
        {
            return Err(ApiError::BadRequest(
                "PersistentKeepalive range must be positive and ordered: min <= max".into(),
            ));
        }
        settings.obfuscation = obfuscation;
    }
    if let Some(ttl) = request.share_default_ttl_secs {
        settings.share_default_ttl_secs = ttl.clamp(60, 30 * 86_400);
    }
    if let Some(days) = request.stats_retention_days {
        settings.set_stats_retention_days(days);
    }
    state.settings.save(&settings).map_err(ApiError::from)?;
    Ok(Json(settings.into()))
}
