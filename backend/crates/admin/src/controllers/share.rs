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
