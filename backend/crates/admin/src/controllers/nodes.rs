use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::models::CreateNodeRequest;
use crate::state::AppState;
use crate::views::NodeView;

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<NodeView>>> {
    user.require_admin()?;
    let nodes = state.network.list_nodes().map_err(ApiError::from)?;
    let mut out = Vec::with_capacity(nodes.len());
    for node in nodes {
        let interfaces = state
            .network
            .interfaces_by_node(node.id)
            .map_err(ApiError::from)?
            .len();
        let online = state.registry.is_online(node.id);
        out.push(NodeView {
            id: node.id,
            name: node.name,
            status: if online {
                awg_network::NodeStatus::Online
            } else {
                awg_network::NodeStatus::Offline
            },
            online,
            last_seen: node.last_seen,
            version: node.version,
            interfaces,
        });
    }
    Ok(Json(out))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateNodeRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let (node, token) = state
        .network
        .create_node(&request.name)
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({
        "node": {
            "id": node.id,
            "name": node.name,
            "created_at": node.created_at,
        },
        "token": token,
    })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    state.network.delete_node(id).map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
