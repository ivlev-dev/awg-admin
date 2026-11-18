use serde::Deserialize;
use uuid::Uuid;

use awg_identity::Role;

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub login: String,
    pub password: String,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub node_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateUserRequest {
    pub role: Option<Role>,
    #[serde(default, with = "crate::models::double_option")]
    pub tariff_id: Option<Option<Uuid>>,
    #[serde(default, with = "crate::models::double_option")]
    pub group_id: Option<Option<Uuid>>,
    #[serde(default, with = "crate::models::double_option")]
    pub node_id: Option<Option<Uuid>>,
    pub disabled: Option<bool>,
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
    fn create_request_accepts_optional_node_id() {
        let without: CreateUserRequest =
            serde_json::from_str(r#"{"login":"alice","password":"password123","role":"user"}"#)
                .unwrap();
        assert!(without.node_id.is_none());

        let with: CreateUserRequest = serde_json::from_str(&format!(
            r#"{{"login":"alice","password":"password123","role":"user","node_id":"{NODE}"}}"#
        ))
        .unwrap();
        assert_eq!(with.node_id, Some(Uuid::parse_str(NODE).unwrap()));
    }
}
