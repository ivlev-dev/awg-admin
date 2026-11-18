use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

use awg_identity::{
    CODE_ACCOUNT_DISABLED, CODE_EMAIL_NOT_VERIFIED, CODE_INVALID_TOKEN, CODE_PENDING_APPROVAL,
    CODE_REJECTED, CODE_TOTP_INVALID, CODE_TOTP_REQUIRED,
};
use awg_shared::CoreError;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    InvalidIdempotencyKey,
    InvalidToken,
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    BillingDisabled,
    Conflict(String),
    TariffRequired,
    TooManyRequests { message: String, retry_after: u64 },
    TotpRequired,
    TotpInvalid(String),
    EmailNotVerified,
    PendingApproval,
    Rejected,
    AccountDisabled,
    Internal(String),
}

impl From<CoreError> for ApiError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Invalid(message) if message == CODE_INVALID_TOKEN => ApiError::InvalidToken,
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
                CODE_ACCOUNT_DISABLED => ApiError::AccountDisabled,
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
            ApiError::InvalidIdempotencyKey => StatusCode::BAD_REQUEST,
            ApiError::InvalidToken => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) | ApiError::TotpRequired | ApiError::TotpInvalid(_) => {
                StatusCode::UNAUTHORIZED
            }
            ApiError::Forbidden(_)
            | ApiError::EmailNotVerified
            | ApiError::PendingApproval
            | ApiError::Rejected
            | ApiError::AccountDisabled => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::BillingDisabled => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) | ApiError::TariffRequired => StatusCode::CONFLICT,
            ApiError::TooManyRequests { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn message(&self) -> String {
        match self {
            ApiError::BadRequest(message) => message.clone(),
            ApiError::InvalidIdempotencyKey => {
                "idempotency key must be 8..128 characters of ASCII letters, digits, '-', '_' or '.'"
                    .to_string()
            }
            ApiError::InvalidToken => "password reset token is invalid or expired".to_string(),
            ApiError::Unauthorized(message) => message.clone(),
            ApiError::Forbidden(message) => message.clone(),
            ApiError::NotFound(message) => message.clone(),
            ApiError::BillingDisabled => "billing is disabled".to_string(),
            ApiError::Conflict(message) => message.clone(),
            ApiError::TariffRequired => "tariff is required".to_string(),
            ApiError::TooManyRequests { message, .. } => message.clone(),
            ApiError::TotpRequired => "two-factor authentication code required".to_string(),
            ApiError::TotpInvalid(message) => message.clone(),
            ApiError::EmailNotVerified => "email is not verified".into(),
            ApiError::PendingApproval => "account is awaiting administrator approval".into(),
            ApiError::Rejected => "registration was rejected".into(),
            ApiError::AccountDisabled => "account is disabled".into(),
            ApiError::Internal(message) => {
                tracing::error!(%message, "internal API error");
                "internal server error".to_string()
            }
        }
    }

    fn code(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "bad_request",
            ApiError::InvalidIdempotencyKey => "invalid_idempotency_key",
            ApiError::InvalidToken => "invalid_token",
            ApiError::Unauthorized(_) => "unauthorized",
            ApiError::Forbidden(_) => "forbidden",
            ApiError::NotFound(_) => "not_found",
            ApiError::BillingDisabled => "billing_disabled",
            ApiError::Conflict(_) => "conflict",
            ApiError::TariffRequired => "tariff_required",
            ApiError::TooManyRequests { .. } => "too_many_requests",
            ApiError::TotpRequired => "totp_required",
            ApiError::TotpInvalid(_) => "totp_invalid",
            ApiError::EmailNotVerified => "email_not_verified",
            ApiError::PendingApproval => "pending_approval",
            ApiError::Rejected => "rejected",
            ApiError::AccountDisabled => "account_disabled",
            ApiError::Internal(_) => "internal",
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
        let code = self.code();
        let message = self.message();
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

        let disabled = ApiError::from(CoreError::Forbidden(CODE_ACCOUNT_DISABLED.into()));
        assert_eq!(disabled.status_code(), StatusCode::FORBIDDEN);
        assert_eq!(disabled.code(), "account_disabled");
        assert!(matches!(disabled, ApiError::AccountDisabled));

        let other = ApiError::from(CoreError::Forbidden("user is disabled".into()));
        assert_eq!(other.status_code(), StatusCode::FORBIDDEN);
        assert!(matches!(other, ApiError::Forbidden(_)));

        let invalid_token = ApiError::from(CoreError::Invalid(CODE_INVALID_TOKEN.into()));
        assert_eq!(invalid_token.status_code(), StatusCode::BAD_REQUEST);
        assert!(matches!(invalid_token, ApiError::InvalidToken));
    }

    #[test]
    fn maps_tariff_required_to_conflict() {
        let error = ApiError::TariffRequired;
        assert_eq!(error.status_code(), StatusCode::CONFLICT);
        assert_eq!(error.code(), "tariff_required");
        assert_eq!(error.message(), "tariff is required");
    }

    #[test]
    fn exposes_response_messages() {
        assert_eq!(ApiError::BadRequest("bad ids".into()).message(), "bad ids");
        assert_eq!(ApiError::Forbidden("denied".into()).message(), "denied");
        assert_eq!(ApiError::BillingDisabled.message(), "billing is disabled");
        assert_eq!(ApiError::AccountDisabled.message(), "account is disabled");
        assert_eq!(
            ApiError::TotpRequired.message(),
            "two-factor authentication code required"
        );
        assert_eq!(
            ApiError::Internal("storage failure".into()).message(),
            "internal server error"
        );
    }
}
