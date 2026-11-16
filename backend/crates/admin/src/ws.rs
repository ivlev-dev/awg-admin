use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use uuid::Uuid;

use awg_statistics::{StatsScope, StatsUpdate};

use crate::controllers::stats::{authorize_scope, parse_scope};
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub token: String,
    pub scope: Option<String>,
    pub id: Option<Uuid>,
}

pub async fn stats_ws(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(query): Query<WsQuery>,
) -> Result<Response, ApiError> {
    let principal = state
        .identity
        .authenticate(&query.token)
        .map_err(ApiError::from)?;
    let scope = match query.scope.as_deref() {
        None | Some("global") => StatsScope::Global,
        Some(kind) => parse_scope(kind, query.id)?,
    };
    let auth = crate::auth::AuthUser(principal);
    authorize_scope(&state, &auth, scope)?;
    Ok(ws.on_upgrade(move |socket| handle(socket, state, scope)))
}

async fn handle(socket: WebSocket, state: Arc<AppState>, scope: StatsScope) {
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
