use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use awg_shared::CoreError;

pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
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

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            ApiError::BadRequest(message) => (StatusCode::BAD_REQUEST, "bad_request", message),
            ApiError::Unauthorized(message) => (StatusCode::UNAUTHORIZED, "unauthorized", message),
            ApiError::Forbidden(message) => (StatusCode::FORBIDDEN, "forbidden", message),
            ApiError::NotFound(message) => (StatusCode::NOT_FOUND, "not_found", message),
            ApiError::Conflict(message) => (StatusCode::CONFLICT, "conflict", message),
            ApiError::Internal(message) => {
                tracing::error!(%message, "internal API error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "internal server error".to_string(),
                )
            }
        };
        (
            status,
            Json(json!({ "error": { "code": code, "message": message } })),
        )
            .into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
