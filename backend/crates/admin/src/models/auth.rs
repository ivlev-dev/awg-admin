use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub totp_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterRequest {
    pub email: String,
    #[serde(default)]
    pub full_name: Option<String>,
    pub password: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateMeRequest {
    #[serde(default, with = "crate::models::double_option")]
    pub full_name: Option<Option<String>>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_uses_email_only() {
        let request: LoginRequest =
            serde_json::from_str(r#"{"email":"User@Example.COM","password":"secret123"}"#).unwrap();
        assert_eq!(request.email, "User@Example.COM");
        assert!(request.totp_code.is_none());

        let legacy: Result<LoginRequest, _> = serde_json::from_str(
            r#"{"email":"user@example.com","login":"user","password":"secret123"}"#,
        );
        assert!(legacy.is_err(), "a legacy login field must be rejected");

        assert!(
            serde_json::from_str::<LoginRequest>(r#"{"login":"user","password":"secret123"}"#)
                .is_err()
        );
    }

    #[test]
    fn registration_accepts_full_name_and_rejects_login() {
        let request: RegisterRequest = serde_json::from_str(
            r#"{"email":"user@example.com","password":"secret123","full_name":"Иван"}"#,
        )
        .unwrap();
        assert_eq!(request.full_name.as_deref(), Some("Иван"));

        let without: RegisterRequest =
            serde_json::from_str(r#"{"email":"user@example.com","password":"secret123"}"#).unwrap();
        assert!(without.full_name.is_none());

        assert!(
            serde_json::from_str::<RegisterRequest>(
                r#"{"email":"user@example.com","login":"user","password":"secret123"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn update_me_distinguishes_missing_and_null_full_name() {
        let missing: UpdateMeRequest = serde_json::from_str("{}").unwrap();
        assert!(missing.full_name.is_none());

        let cleared: UpdateMeRequest = serde_json::from_str(r#"{"full_name":null}"#).unwrap();
        assert_eq!(cleared.full_name, Some(None));

        let changed: UpdateMeRequest = serde_json::from_str(r#"{"full_name":"Иван"}"#).unwrap();
        assert_eq!(changed.full_name, Some(Some("Иван".into())));
    }
}
