use serde::Deserialize;
use uuid::Uuid;

use awg_identity::Role;

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: Option<String>,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub node_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateUserRequest {
    pub email: Option<String>,
    pub role: Option<Role>,
    #[serde(default, with = "crate::models::double_option")]
    pub tariff_id: Option<Option<Uuid>>,
    #[serde(default, with = "crate::models::double_option")]
    pub group_id: Option<Option<Uuid>>,
    #[serde(default, with = "crate::models::double_option")]
    pub node_id: Option<Option<Uuid>>,
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UserPageParams {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub q: Option<String>,
    pub role: Option<String>,
    pub status: Option<String>,
    pub tab: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const NODE: &str = "11111111-1111-1111-1111-111111111111";

    #[test]
    fn update_request_distinguishes_missing_and_null_node_id() {
        let missing: UpdateUserRequest = serde_json::from_str("{}").unwrap();
        assert!(missing.node_id.is_none());

        let cleared: UpdateUserRequest = serde_json::from_str(r#"{"node_id":null}"#).unwrap();
        assert_eq!(cleared.node_id, Some(None));

        let bound: UpdateUserRequest =
            serde_json::from_str(&format!(r#"{{"node_id":"{NODE}"}}"#)).unwrap();
        assert_eq!(bound.node_id, Some(Some(Uuid::parse_str(NODE).unwrap())));
    }

    #[test]
    fn update_request_accepts_email() {
        let missing: UpdateUserRequest = serde_json::from_str("{}").unwrap();
        assert!(missing.email.is_none());

        let changed: UpdateUserRequest =
            serde_json::from_str(r#"{"email":"New@Example.com"}"#).unwrap();
        assert_eq!(changed.email.as_deref(), Some("New@Example.com"));

        let cleared: UpdateUserRequest = serde_json::from_str(r#"{"email":null}"#).unwrap();
        assert!(cleared.email.is_none());
    }

    #[test]
    fn create_request_requires_email_and_ignores_legacy_login() {
        let request: CreateUserRequest = serde_json::from_str(
            r#"{"email":"Admin@Local","password":"password123","role":"admin"}"#,
        )
        .unwrap();
        assert_eq!(request.email, "Admin@Local");
        assert_eq!(request.password.as_deref(), Some("password123"));

        let legacy: CreateUserRequest =
            serde_json::from_str(r#"{"email":"user@example.com","login":"legacy","role":"user"}"#)
                .unwrap();
        assert_eq!(legacy.email, "user@example.com");
        assert!(legacy.password.is_none());
        assert!(legacy.node_id.is_none());

        assert!(
            serde_json::from_str::<CreateUserRequest>(r#"{"login":"alice","role":"user"}"#)
                .is_err()
        );
    }

    #[test]
    fn create_request_accepts_optional_node_id() {
        let without: CreateUserRequest = serde_json::from_str(
            r#"{"email":"alice@example.com","password":"password123","role":"user"}"#,
        )
        .unwrap();
        assert!(without.node_id.is_none());

        let with: CreateUserRequest = serde_json::from_str(&format!(
            r#"{{"email":"alice@example.com","password":"password123","role":"user","node_id":"{NODE}"}}"#
        ))
        .unwrap();
        assert_eq!(with.node_id, Some(Uuid::parse_str(NODE).unwrap()));
    }
}
