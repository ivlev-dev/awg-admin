use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use awg_proto::worker_gateway_server::WorkerGateway;
use awg_proto::{self as proto, ServerMessage, WorkerMessage, server_message, worker_message};
use futures_util::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tonic::{Request, Response, Status, Streaming};
use uuid::Uuid;

use crate::blocking;
use crate::state::AppState;

pub fn server_tls_config(cert_path: &Path, key_path: &Path) -> anyhow::Result<ServerTlsConfig> {
    let cert = std::fs::read(cert_path)
        .with_context(|| format!("failed to read AWG_GRPC_TLS_CERT {}", cert_path.display()))?;
    let key = std::fs::read(key_path)
        .with_context(|| format!("failed to read AWG_GRPC_TLS_KEY {}", key_path.display()))?;
    let cert = std::str::from_utf8(&cert)
        .context("AWG_GRPC_TLS_CERT must be a PEM-encoded certificate")?;
    let key = std::str::from_utf8(&key).context("AWG_GRPC_TLS_KEY must be a PEM-encoded key")?;
    if !cert.contains("-----BEGIN CERTIFICATE-----") {
        anyhow::bail!(
            "AWG_GRPC_TLS_CERT {} does not contain a PEM certificate",
            cert_path.display()
        );
    }
    if !key.contains("PRIVATE KEY-----") {
        anyhow::bail!(
            "AWG_GRPC_TLS_KEY {} does not contain a PEM private key",
            key_path.display()
        );
    }
    Ok(ServerTlsConfig::new().identity(Identity::from_pem(cert, key)))
}

pub fn build_server(tls: Option<ServerTlsConfig>) -> anyhow::Result<Server> {
    let builder = Server::builder();
    match tls {
        Some(tls) => builder
            .tls_config(tls)
            .context("failed to build the gRPC TLS acceptor from the provided certificate and key"),
        None => Ok(builder),
    }
}

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
    let session = state.registry.register(
        node_id,
        state_tx,
        Some(hello.version.clone()).filter(|v| !v.is_empty()),
    );
    let _ =
        state
            .orchestration
            .online(node_id, true, Some(hello.version).filter(|v| !v.is_empty()));
    tracing::info!(%node_id, "worker connected");

    let desired = {
        let state = state.clone();
        blocking::run_core(move || state.orchestration.snapshot(node_id)).await
    };
    if let Ok(desired) = desired {
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
                    Ok(Some(message)) => handle_message(&state, node_id, session, message).await,
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

    state.registry.unregister(node_id, session);
    if state.registry.is_online(node_id) {
        tracing::debug!(%node_id, "stale worker session closed; keeping the live session");
    } else {
        let _ = state.orchestration.online(node_id, false, None);
    }
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

async fn handle_message(
    state: &Arc<AppState>,
    node_id: Uuid,
    session: awg_orchestration::SessionId,
    message: WorkerMessage,
) {
    match message.payload {
        Some(worker_message::Payload::Stats(snapshot)) => {
            state.registry.touch(node_id, session);
            let stats = awg_orchestration::infrastructure::from_proto_stats(snapshot);
            let state = state.clone();
            if let Err(error) =
                blocking::run_core(move || state.orchestration.record_stats(node_id, stats)).await
            {
                tracing::warn!(%node_id, %error, "failed to record worker stats");
            }
        }
        Some(worker_message::Payload::Heartbeat(heartbeat)) => {
            state.registry.touch(node_id, session);
            if let Some(metrics) = heartbeat.metrics {
                let update = awg_network::NodeMetricsUpdate {
                    cpu_load: metrics.cpu_load,
                    mem_used_bytes: metrics.mem_used_bytes,
                    mem_total_bytes: metrics.mem_total_bytes,
                    kernel_version: metrics.kernel_version,
                    worker_version: metrics.worker_version,
                    uptime_secs: metrics.uptime_secs,
                };
                if let Err(error) = state.network.record_metrics(node_id, update) {
                    tracing::warn!(%node_id, %error, "failed to record node metrics");
                }
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, contents: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("awg-grpc-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        path
    }

    fn generated_certificate() -> (std::path::PathBuf, std::path::PathBuf) {
        let certified = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let cert = write_temp("server.crt", &certified.cert.pem());
        let key = write_temp("server.key", &certified.signing_key.serialize_pem());
        (cert, key)
    }

    #[test]
    fn builds_tls_acceptor_from_pem_certificate() {
        let (cert, key) = generated_certificate();
        let tls = server_tls_config(&cert, &key).unwrap();
        build_server(Some(tls)).unwrap();
    }

    #[test]
    fn builds_plaintext_server_without_tls() {
        build_server(None).unwrap();
    }

    #[test]
    fn missing_files_report_the_env_names() {
        let error = server_tls_config(
            Path::new("/nonexistent/awg-grpc.crt"),
            Path::new("/nonexistent/awg-grpc.key"),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("AWG_GRPC_TLS_CERT"), "{error}");
    }

    #[test]
    fn rejects_non_pem_contents() {
        let cert = write_temp("bad.crt", "not a certificate");
        let key = write_temp("bad.key", "not a key");
        let error = server_tls_config(&cert, &key).unwrap_err().to_string();
        assert!(error.contains("AWG_GRPC_TLS_CERT"), "{error}");
    }
}
