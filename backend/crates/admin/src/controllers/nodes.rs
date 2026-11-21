use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::blocking;
use crate::error::{ApiError, ApiResult};
use crate::models::CreateNodeRequest;
use crate::state::AppState;
use crate::views::NodeView;

pub async fn list(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> ApiResult<Json<Vec<NodeView>>> {
    user.require_admin()?;
    let views = {
        let network = state.network.clone();
        let registry = state.registry.clone();
        blocking::run_core(move || {
            let nodes = network.list_nodes()?;
            let mut out = Vec::with_capacity(nodes.len());
            for node in nodes {
                let interfaces = network.interfaces_by_node(node.id)?.len();
                let online = registry.is_online(node.id);
                out.push(NodeView::build(node, online, interfaces));
            }
            Ok(out)
        })
        .await
        .map_err(ApiError::from)?
    };
    Ok(Json(views))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(request): Json<CreateNodeRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let (node, token) = {
        let network = state.network.clone();
        blocking::run_core(move || network.create_node(&request.name))
            .await
            .map_err(ApiError::from)?
    };
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
    let network = state.network.clone();
    blocking::run_core(move || network.delete_node(id))
        .await
        .map_err(ApiError::from)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn rotate(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    user.require_admin()?;
    let (view, token) = {
        let network = state.network.clone();
        let registry = state.registry.clone();
        blocking::run_core(move || {
            let (node, token) = network.rotate_node_token(id)?;
            let interfaces = network.interfaces_by_node(node.id)?.len();
            let online = registry.is_online(node.id);
            Ok((NodeView::build(node, online, interfaces), token))
        })
        .await
        .map_err(ApiError::from)?
    };
    Ok(Json(serde_json::json!({
        "node": view,
        "token": token,
    })))
}
