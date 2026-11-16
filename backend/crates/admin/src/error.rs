use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

use awg_shared::CoreError;

pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    TooManyRequests { message: String, retry_after: u64 },
    Internal(String),
}

impl From<CoreError> for ApiError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Invalid(message) => ApiError::BadRequest(message),
            CoreError::NotFound(what) => ApiError::NotFound(what),
            CoreError::Conflict(message) => ApiError::Conflict(message),
            CoreError::Forbidden(message) => ApiError::Forbidden(message),
            CoreError::Codec(message) | CoreError::Crypto(message) => ApiError::BadRequest(message),
            CoreError::Io(error) => ApiError::Internal(error.to_string()),
        }
    }
}

impl From<awg_storage::StorageError> for ApiError {
    fn from(error: awg_storage::StorageError) -> Self {
        ApiError::Internal(error.to_string())
    }
}

impl ApiError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooManyRequests { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let retry_after = match &self {
            ApiError::TooManyRequests { retry_after, .. } => Some(*retry_after),
            _ => None,
        };
        let (code, message) = match self {
            ApiError::BadRequest(message) => ("bad_request", message),
            ApiError::Unauthorized(message) => ("unauthorized", message),
            ApiError::Forbidden(message) => ("forbidden", message),
            ApiError::NotFound(message) => ("not_found", message),
            ApiError::Conflict(message) => ("conflict", message),
            ApiError::TooManyRequests { message, .. } => ("too_many_requests", message),
            ApiError::Internal(message) => {
                tracing::error!(%message, "internal API error");
                ("internal", "internal server error".to_string())
            }
        };
        let mut response = (
            status,
            Json(json!({ "error": { "code": code, "message": message } })),
        )
            .into_response();
        if let Some(seconds) = retry_after
            && let Ok(value) = HeaderValue::from_str(&seconds.to_string())
        {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        response
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
