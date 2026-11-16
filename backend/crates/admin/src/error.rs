use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

use awg_identity::{
    CODE_EMAIL_NOT_VERIFIED, CODE_PENDING_APPROVAL, CODE_REJECTED, CODE_TOTP_INVALID,
    CODE_TOTP_REQUIRED,
};
use awg_shared::CoreError;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    BillingDisabled,
    Conflict(String),
    TooManyRequests { message: String, retry_after: u64 },
    TotpRequired,
    TotpInvalid(String),
    EmailNotVerified,
    PendingApproval,
    Rejected,
    Internal(String),
}

impl From<CoreError> for ApiError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Invalid(message) => ApiError::BadRequest(message),
            CoreError::NotFound(what) => ApiError::NotFound(what),
            CoreError::Conflict(message) => ApiError::Conflict(message),
            CoreError::Forbidden(message) => match message.as_str() {
                CODE_TOTP_REQUIRED => ApiError::TotpRequired,
                CODE_TOTP_INVALID => {
                    ApiError::TotpInvalid("invalid two-factor authentication code".into())
                }
                CODE_EMAIL_NOT_VERIFIED => ApiError::EmailNotVerified,
                CODE_PENDING_APPROVAL => ApiError::PendingApproval,
                CODE_REJECTED => ApiError::Rejected,
                _ => ApiError::Forbidden(message),
            },
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
            ApiError::Unauthorized(_) | ApiError::TotpRequired | ApiError::TotpInvalid(_) => {
                StatusCode::UNAUTHORIZED
            }
            ApiError::Forbidden(_)
            | ApiError::EmailNotVerified
            | ApiError::PendingApproval
            | ApiError::Rejected => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::BillingDisabled => StatusCode::NOT_FOUND,
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
            ApiError::BillingDisabled => ("billing_disabled", "billing is disabled".to_string()),
            ApiError::Conflict(message) => ("conflict", message),
            ApiError::TooManyRequests { message, .. } => ("too_many_requests", message),
            ApiError::TotpRequired => (
                "totp_required",
                "two-factor authentication code required".to_string(),
            ),
            ApiError::TotpInvalid(message) => ("totp_invalid", message),
            ApiError::EmailNotVerified => ("email_not_verified", "email is not verified".into()),
            ApiError::PendingApproval => (
                "pending_approval",
                "account is awaiting administrator approval".into(),
            ),
            ApiError::Rejected => ("rejected", "registration was rejected".into()),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_identity_error_codes() {
        let totp_required = ApiError::from(CoreError::Forbidden(CODE_TOTP_REQUIRED.into()));
        assert_eq!(totp_required.status_code(), StatusCode::UNAUTHORIZED);
        assert!(matches!(totp_required, ApiError::TotpRequired));

        let totp_invalid = ApiError::from(CoreError::Forbidden(CODE_TOTP_INVALID.into()));
        assert_eq!(totp_invalid.status_code(), StatusCode::UNAUTHORIZED);
        assert!(matches!(totp_invalid, ApiError::TotpInvalid(_)));

        let email = ApiError::from(CoreError::Forbidden(CODE_EMAIL_NOT_VERIFIED.into()));
        assert_eq!(email.status_code(), StatusCode::FORBIDDEN);
        assert!(matches!(email, ApiError::EmailNotVerified));

        let approval = ApiError::from(CoreError::Forbidden(CODE_PENDING_APPROVAL.into()));
        assert_eq!(approval.status_code(), StatusCode::FORBIDDEN);
        assert!(matches!(approval, ApiError::PendingApproval));

        let rejected = ApiError::from(CoreError::Forbidden(CODE_REJECTED.into()));
        assert_eq!(rejected.status_code(), StatusCode::FORBIDDEN);
        assert!(matches!(rejected, ApiError::Rejected));

        let other = ApiError::from(CoreError::Forbidden("user is disabled".into()));
        assert_eq!(other.status_code(), StatusCode::FORBIDDEN);
        assert!(matches!(other, ApiError::Forbidden(_)));
    }
}
