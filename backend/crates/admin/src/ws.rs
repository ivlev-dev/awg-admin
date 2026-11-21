use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Query, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use uuid::Uuid;

use awg_statistics::{StatsScope, StatsUpdate};

use crate::auth::AuthUser;
use crate::blocking;
use crate::controllers::stats::{authorize_scope, parse_scope};
use crate::error::ApiError;
use crate::routes::Readiness;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub ticket: Option<String>,
    pub token: Option<String>,
    pub scope: Option<String>,
    pub id: Option<Uuid>,
}

pub async fn stats_ws(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Extension(readiness): Extension<Readiness>,
    Query(query): Query<WsQuery>,
) -> Result<Response, ApiError> {
    let scope = authorize_ws(&state, &query).await?;
    Ok(ws.on_upgrade(move |socket| handle(socket, state, scope, readiness)))
}

/// Resolves the scope for a WebSocket connection.
///
/// A single-use ticket always wins: the scope is taken from the ticket and any
/// `scope`/`id` query parameters are ignored so a ticket for a narrow scope
/// cannot be widened. The legacy access-token flow is opt-in via
/// `AWG_ALLOW_WS_TOKEN` because tokens in query strings leak through logs.
async fn authorize_ws(state: &Arc<AppState>, query: &WsQuery) -> Result<StatsScope, ApiError> {
    if let Some(ticket) = query.ticket.as_deref() {
        let Some((user_id, scope)) = state.ws_tickets.consume(ticket) else {
            return Err(ApiError::Unauthorized(
                "websocket ticket is invalid or expired".into(),
            ));
        };
        let identity = state.identity.clone();
        let user = blocking::run_core(move || identity.find(user_id))
            .await
            .map_err(ApiError::from)?;
        user.ensure_active().map_err(ApiError::from)?;
        return Ok(scope);
    }

    if let Some(token) = query.token.as_deref() {
        if !state.config.allow_ws_token {
            tracing::warn!(
                "rejected a websocket access token in the query string; clients must use POST /api/v1/ws/ticket (AWG_ALLOW_WS_TOKEN is disabled)"
            );
            return Err(ApiError::Unauthorized(
                "websocket access tokens in query strings are disabled; request a ticket from POST /api/v1/ws/ticket".into(),
            ));
        }
        tracing::warn!(
            "authenticating a websocket with an access token from the query string; tokens may leak through logs and proxies"
        );
        let principal = state.identity.authenticate(token).map_err(ApiError::from)?;
        let scope = match query.scope.as_deref() {
            None | Some("global") => StatsScope::Global,
            Some(kind) => parse_scope(kind, query.id)?,
        };
        let auth = AuthUser(principal);
        authorize_scope(state, &auth, scope)?;
        return Ok(scope);
    }

    Err(ApiError::Unauthorized(
        "websocket ticket is required; request one from POST /api/v1/ws/ticket".into(),
    ))
}

async fn handle(socket: WebSocket, state: Arc<AppState>, scope: StatsScope, readiness: Readiness) {
    let (mut sender, mut receiver) = socket.split();
    let mut hub = state.stats_hub.subscribe();

    let (today_rx, today_tx) = state.stats.today(scope).unwrap_or((0, 0));
    let (month_rx, month_tx) = state.stats.month(scope).unwrap_or((0, 0));
    let hello = serde_json::json!({
        "type": "hello",
        "scope": scope,
        "today": { "rx": today_rx, "tx": today_tx },
        "month": { "rx": month_rx, "tx": month_tx },
    });
    if sender
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    heartbeat.tick().await;

    loop {
        if readiness.is_shutting_down() {
            let _ = sender.send(Message::Close(None)).await;
            break;
        }
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            update = hub.recv() => {
                let Ok(update) = update else { continue };
                if !matches_scope(&update, scope) {
                    continue;
                }
                let payload = serde_json::json!({
                    "type": "traffic",
                    "at": update.at,
                    "items": [{
                        "device_id": update.device_id,
                        "user_id": update.user_id,
                        "group_id": update.group_id,
                        "interface_id": update.interface_id,
                        "rx": update.rx,
                        "tx": update.tx,
                    }]
                });
                if sender.send(Message::Text(payload.to_string().into())).await.is_err() {
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if readiness.is_shutting_down() {
                    let _ = sender.send(Message::Close(None)).await;
                    break;
                }
                let ping = serde_json::json!({ "type": "ping", "at": chrono::Utc::now() });
                if sender.send(Message::Text(ping.to_string().into())).await.is_err() {
                    break;
                }
            }
        }
    }
}

fn matches_scope(update: &StatsUpdate, scope: StatsScope) -> bool {
    match scope {
        StatsScope::Global => true,
        StatsScope::User(id) => update.user_id == id,
        StatsScope::Group(id) => update.group_id == id,
        StatsScope::Interface(id) => update.interface_id == id,
        StatsScope::Device(id) => update.device_id == id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{app_env, app_env_production};

    #[tokio::test]
    async fn ticket_scope_cannot_be_widened_by_query() {
        let env = app_env();
        let user = env.owner_id;
        let (ticket, _) = env.state.ws_tickets.issue(user, StatsScope::User(user));
        let query = WsQuery {
            ticket: Some(ticket),
            token: None,
            scope: Some("global".into()),
            id: None,
        };

        let scope = authorize_ws(&env.state, &query).await.unwrap();
        assert_eq!(scope, StatsScope::User(user));
    }

    #[tokio::test]
    async fn ticket_is_single_use() {
        let env = app_env();
        let (ticket, _) = env.state.ws_tickets.issue(env.owner_id, StatsScope::Global);
        let query = WsQuery {
            ticket: Some(ticket),
            token: None,
            scope: None,
            id: None,
        };
        assert!(authorize_ws(&env.state, &query).await.is_ok());
        assert!(authorize_ws(&env.state, &query).await.is_err());
    }

    #[tokio::test]
    async fn access_token_query_is_disabled_by_default() {
        let env = app_env();
        let query = WsQuery {
            ticket: None,
            token: Some(env.owner_token.clone()),
            scope: None,
            id: None,
        };
        let error = authorize_ws(&env.state, &query).await.unwrap_err();
        assert!(matches!(error, ApiError::Unauthorized(_)));
    }

    #[tokio::test]
    async fn production_requires_a_ticket_even_with_a_valid_token() {
        let env = app_env_production();
        let query = WsQuery {
            ticket: None,
            token: Some(env.owner_token.clone()),
            scope: None,
            id: None,
        };
        assert!(authorize_ws(&env.state, &query).await.is_err());
    }

    #[tokio::test]
    async fn missing_credentials_are_rejected() {
        let env = app_env();
        let query = WsQuery {
            ticket: None,
            token: None,
            scope: None,
            id: None,
        };
        assert!(authorize_ws(&env.state, &query).await.is_err());
    }
}
