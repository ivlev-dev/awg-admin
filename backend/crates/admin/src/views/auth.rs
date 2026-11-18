use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use awg_identity::{Role, User, UserStatus};

#[derive(Debug, Serialize)]
pub struct UserView {
    pub id: Uuid,
    pub login: String,
    pub email: Option<String>,
    pub status: UserStatus,
    pub totp_enabled: bool,
    pub role: Role,
    pub tariff_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub node_id: Option<Uuid>,
    pub disabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&User> for UserView {
    fn from(user: &User) -> Self {
        Self {
            id: user.id,
            login: user.login.clone(),
            email: user.email.clone(),
            status: user.status,
            totp_enabled: user.totp_enabled,
            role: user.role,
            tariff_id: user.tariff_id,
            group_id: user.group_id,
            node_id: user.node_id,
            disabled: user.disabled,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AuthView {
    pub token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub user: UserView,
}

#[derive(Debug, Serialize)]
pub struct SessionView {
    pub jti: Uuid,
    pub family_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub used: bool,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

impl From<&awg_identity::RefreshSession> for SessionView {
    fn from(session: &awg_identity::RefreshSession) -> Self {
        Self {
            jti: session.jti,
            family_id: session.family_id,
            created_at: session.created_at,
            expires_at: session.expires_at,
            revoked: session.revoked,
            used: session.used,
            user_agent: session.user_agent.clone(),
            ip: session.ip.clone(),
        }
    }
}
