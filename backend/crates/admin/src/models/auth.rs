use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub login: String,
    pub password: String,
    #[serde(default)]
    pub totp_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    #[serde(default)]
    pub login: Option<String>,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyEmailRequest {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ResendVerificationRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct ApproveUserRequest {
    pub tariff_id: Uuid,
    #[serde(default)]
    pub group_id: Option<Uuid>,
    #[serde(default)]
    pub node_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SetupTotpRequest {
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EnableTotpRequest {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct DisableTotpRequest {
    pub password: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct ChangePasswordRequest {
    #[serde(default)]
    pub current_password: String,
    pub new_password: String,
    #[serde(default)]
    pub totp_code: Option<String>,
}
