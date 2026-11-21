use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn download(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    // Check the account before consuming the link: a blocked owner must not
    // burn a one-time share. Both cases look identical to an anonymous client
    // so the link never reveals account state.
    let link = state
        .share
        .find(&token)
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::NotFound("share link".into()))?;
    let device = state
        .devices
        .get(link.device_id)
        .map_err(|_| ApiError::NotFound("share link".into()))?;
    if device.revoked {
        return Err(ApiError::NotFound("share link".into()));
    }
    let owner_active = state
        .identity
        .find(device.user_id)
        .is_ok_and(|owner| owner.ensure_active().is_ok());
    if !owner_active {
        return Err(ApiError::NotFound("share link".into()));
    }

    let (link, content) = state.share.resolve(&token).map_err(ApiError::from)?;
    let filename = format!("awg-{}-{}.conf", link.device_id, link.interface_id);
    Ok((
        StatusCode::OK,
        [
            ("content-type", "text/plain; charset=utf-8".to_string()),
            (
                "content-disposition",
                format!("inline; filename=\"{filename}\""),
            ),
            ("cache-control", "no-store".to_string()),
        ],
        content,
    )
        .into_response())
}
