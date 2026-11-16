use std::sync::Arc;
use std::time::Duration;

use awg_proto::worker_gateway_server::WorkerGateway;
use awg_proto::{self as proto, ServerMessage, WorkerMessage, server_message, worker_message};
use futures_util::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, Streaming};
use uuid::Uuid;

use crate::state::AppState;

pub struct WorkerGrpc {
    state: Arc<AppState>,
}

impl WorkerGrpc {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

type SessionStream =
    std::pin::Pin<Box<dyn Stream<Item = Result<ServerMessage, Status>> + Send + 'static>>;

#[tonic::async_trait]
impl WorkerGateway for WorkerGrpc {
    type SessionStream = SessionStream;

    async fn session(
        &self,
        request: Request<Streaming<WorkerMessage>>,
    ) -> Result<Response<Self::SessionStream>, Status> {
        let inbound = request.into_inner();
        let (out_tx, out_rx) = mpsc::channel(64);
        let state = self.state.clone();
        tokio::spawn(async move {
            run_session(state, inbound, out_tx).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(out_rx))))
    }
}

async fn run_session(
    state: Arc<AppState>,
    mut inbound: Streaming<WorkerMessage>,
    out_tx: mpsc::Sender<Result<ServerMessage, Status>>,
) {
    let hello = match tokio::time::timeout(Duration::from_secs(10), inbound.message()).await {
        Ok(Ok(Some(message))) => message,
        Ok(Ok(None)) => return,
        Ok(Err(error)) => {
            tracing::warn!(%error, "worker stream failed before hello");
            return;
        }
        Err(_) => {
            let _ = send_ack(&out_tx, "", false, "worker hello was not sent").await;
            return;
        }
    };

    let hello = match hello.payload {
        Some(worker_message::Payload::Hello(hello)) => hello,
        _ => {
            let _ = send_ack(&out_tx, "", false, "first message must be hello").await;
            return;
        }
    };

    let node_id: Uuid = match hello.node_id.parse() {
        Ok(id) => id,
        Err(_) => {
            let _ = send_ack(&out_tx, "", false, "node id must be a UUID").await;
            return;
        }
    };

    if let Err(error) = state.orchestration.authenticate(node_id, &hello.token) {
        let _ = send_ack(&out_tx, "", false, &error.to_string()).await;
        return;
    }

    let (state_tx, mut state_rx) = mpsc::channel(8);
    state.registry.register(
        node_id,
        state_tx,
        Some(hello.version.clone()).filter(|v| !v.is_empty()),
    );
    let _ =
        state
            .orchestration
            .online(node_id, true, Some(hello.version).filter(|v| !v.is_empty()));
    tracing::info!(%node_id, "worker connected");

    if let Ok(desired) = state.orchestration.snapshot(node_id) {
        let _ = out_tx
            .send(Ok(ServerMessage {
                payload: Some(server_message::Payload::State(
                    awg_orchestration::to_proto_state(&desired),
                )),
            }))
            .await;
    }

    let mut ping = tokio::time::interval(Duration::from_secs(20));
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ping.tick().await;

    loop {
        tokio::select! {
            incoming = inbound.message() => {
                match incoming {
                    Ok(Some(message)) => handle_message(&state, node_id, message).await,
                    Ok(None) => break,
                    Err(error) => {
                        tracing::warn!(%node_id, %error, "worker stream failed");
                        break;
                    }
                }
            }
            desired = state_rx.recv() => {
                let Some(desired) = desired else { break };
                let message = ServerMessage {
                    payload: Some(server_message::Payload::State(
                        awg_orchestration::to_proto_state(&desired),
                    )),
                };
                if out_tx.send(Ok(message)).await.is_err() {
                    break;
                }
            }
            _ = ping.tick() => {
                let message = ServerMessage {
                    payload: Some(server_message::Payload::Ping(proto::Ping {
                        at: chrono::Utc::now().timestamp(),
                    })),
                };
                if out_tx.send(Ok(message)).await.is_err() {
                    break;
                }
            }
        }
    }

    state.registry.unregister(node_id);
    let _ = state.orchestration.online(node_id, false, None);
    tracing::info!(%node_id, "worker session closed");
}

async fn send_ack(
    out_tx: &mpsc::Sender<Result<ServerMessage, Status>>,
    revision: &str,
    ok: bool,
    error: &str,
) -> Result<(), mpsc::error::SendError<Result<ServerMessage, Status>>> {
    out_tx
        .send(Ok(ServerMessage {
            payload: Some(server_message::Payload::Ack(proto::Ack {
                revision: revision.to_string(),
                ok,
                error: error.to_string(),
            })),
        }))
        .await
}

async fn handle_message(state: &AppState, node_id: Uuid, message: WorkerMessage) {
    match message.payload {
        Some(worker_message::Payload::Stats(snapshot)) => {
            state.registry.touch(node_id);
            let stats = awg_orchestration::infrastructure::from_proto_stats(snapshot);
            if let Err(error) = state.orchestration.record_stats(node_id, stats) {
                tracing::warn!(%node_id, %error, "failed to record worker stats");
            }
        }
        Some(worker_message::Payload::Heartbeat(_)) => {
            state.registry.touch(node_id);
        }
        Some(worker_message::Payload::ApplyResult(result)) => {
            if result.ok {
                tracing::info!(%node_id, revision = %result.revision, "worker applied state");
            } else {
                tracing::error!(
                    %node_id,
                    revision = %result.revision,
                    error = %result.error,
                    "worker failed to apply state"
                );
            }
        }
        Some(worker_message::Payload::Hello(_)) | None => {}
    }
}
