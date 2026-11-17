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
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateUserRequest {
    pub role: Option<Role>,
    #[serde(default, with = "crate::models::double_option")]
    pub tariff_id: Option<Option<Uuid>>,
    #[serde(default, with = "crate::models::double_option")]
    pub group_id: Option<Option<Uuid>>,
    pub disabled: Option<bool>,
}
