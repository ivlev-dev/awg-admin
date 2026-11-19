use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use awg_proto::worker_gateway_server::WorkerGateway;
use awg_proto::{self as proto, ServerMessage, WorkerMessage, server_message, worker_message};
use futures_util::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::{Certificate, Identity, Server, ServerTlsConfig};
use tonic::{Request, Response, Status, Streaming};
use uuid::Uuid;

use crate::blocking;
use crate::state::AppState;

pub fn server_tls_config(
    cert_path: &Path,
    key_path: &Path,
    client_ca_path: Option<&Path>,
) -> anyhow::Result<ServerTlsConfig> {
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
    let mut tls = ServerTlsConfig::new().identity(Identity::from_pem(cert, key));
    if let Some(ca_path) = client_ca_path {
        let ca = std::fs::read(ca_path).with_context(|| {
            format!(
                "failed to read AWG_GRPC_TLS_CLIENT_CA {}",
                ca_path.display()
            )
        })?;
        let ca = std::str::from_utf8(&ca)
            .context("AWG_GRPC_TLS_CLIENT_CA must be a PEM-encoded certificate")?;
        if !ca.contains("-----BEGIN CERTIFICATE-----") {
            anyhow::bail!(
                "AWG_GRPC_TLS_CLIENT_CA {} does not contain a PEM certificate",
                ca_path.display()
            );
        }
        tls = tls.client_ca_root(Certificate::from_pem(ca));
    }
    Ok(tls)
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
    use awg_proto::worker_gateway_server::WorkerGatewayServer;
    use std::io::Write;
    use tonic::transport::{ClientTlsConfig, Endpoint, server::TcpIncoming};

    fn write_temp(name: &str, contents: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!("awg-grpc-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!("{unique}-{name}"));
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

    fn certificate_authority(cn: &str) -> rcgen::CertifiedIssuer<'static, rcgen::KeyPair> {
        let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, cn);
        params.key_usages = vec![
            rcgen::KeyUsagePurpose::KeyCertSign,
            rcgen::KeyUsagePurpose::CrlSign,
            rcgen::KeyUsagePurpose::DigitalSignature,
        ];
        rcgen::CertifiedIssuer::self_signed(params, rcgen::KeyPair::generate().unwrap()).unwrap()
    }

    fn leaf_certificate(
        issuer: &rcgen::CertifiedIssuer<'_, rcgen::KeyPair>,
        cn: &str,
        san: &str,
        usage: rcgen::ExtendedKeyUsagePurpose,
    ) -> (String, String) {
        let mut params = rcgen::CertificateParams::new(vec![san.to_string()]).unwrap();
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, cn);
        params.extended_key_usages = vec![usage];
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = params.signed_by(&key, issuer).unwrap();
        (cert.pem(), key.serialize_pem())
    }

    struct NoopGateway;

    #[tonic::async_trait]
    impl WorkerGateway for NoopGateway {
        type SessionStream = SessionStream;

        async fn session(
            &self,
            _request: Request<Streaming<WorkerMessage>>,
        ) -> Result<Response<Self::SessionStream>, Status> {
            Ok(Response::new(Box::pin(tokio_stream::empty())))
        }
    }

    fn client_tls(server_ca: &str, identity: Option<(&str, &str)>) -> ClientTlsConfig {
        let mut config = ClientTlsConfig::new()
            .ca_certificate(Certificate::from_pem(server_ca))
            .domain_name("localhost");
        if let Some((cert, key)) = identity {
            config = config.identity(Identity::from_pem(cert, key));
        }
        config
    }

    async fn try_connect(
        server_tls: ServerTlsConfig,
        client_tls: ClientTlsConfig,
    ) -> Result<(), String> {
        let incoming = TcpIncoming::bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let port = incoming.local_addr().unwrap().port();
        let server = build_server(Some(server_tls))
            .unwrap()
            .add_service(WorkerGatewayServer::new(NoopGateway));
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = server
                .serve_with_incoming_shutdown(incoming, async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });
        let endpoint = Endpoint::from_shared(format!("https://localhost:{port}"))
            .unwrap()
            .tls_config(client_tls)
            .unwrap();
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            let channel = endpoint.connect().await.map_err(|e| e.to_string())?;
            let mut client = awg_proto::worker_gateway_client::WorkerGatewayClient::new(channel);
            client
                .session(tokio_stream::empty())
                .await
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })
        .await;
        let _ = shutdown_tx.send(());
        handle.abort();
        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("connection timed out".into()),
        }
    }

    #[test]
    fn builds_tls_acceptor_from_pem_certificate() {
        let (cert, key) = generated_certificate();
        let tls = server_tls_config(&cert, &key, None).unwrap();
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
            None,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("AWG_GRPC_TLS_CERT"), "{error}");
    }

    #[test]
    fn rejects_non_pem_contents() {
        let cert = write_temp("bad.crt", "not a certificate");
        let key = write_temp("bad.key", "not a key");
        let error = server_tls_config(&cert, &key, None)
            .unwrap_err()
            .to_string();
        assert!(error.contains("AWG_GRPC_TLS_CERT"), "{error}");
    }

    #[test]
    fn missing_client_ca_reports_the_env_name() {
        let (cert, key) = generated_certificate();
        let error = server_tls_config(
            &cert,
            &key,
            Some(Path::new("/nonexistent/awg-worker-ca.crt")),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("AWG_GRPC_TLS_CLIENT_CA"), "{error}");
    }

    #[test]
    fn rejects_non_pem_client_ca() {
        let (cert, key) = generated_certificate();
        let ca = write_temp("bad-client-ca.crt", "not a certificate");
        let error = server_tls_config(&cert, &key, Some(&ca))
            .unwrap_err()
            .to_string();
        assert!(error.contains("AWG_GRPC_TLS_CLIENT_CA"), "{error}");
    }

    #[tokio::test]
    async fn mtls_accepts_client_certificate_signed_by_configured_ca() {
        let server_ca = certificate_authority("awg-server-ca");
        let client_ca = certificate_authority("awg-worker-ca");
        let (server_cert, server_key) = leaf_certificate(
            &server_ca,
            "admin.internal",
            "localhost",
            rcgen::ExtendedKeyUsagePurpose::ServerAuth,
        );
        let (client_cert, client_key) = leaf_certificate(
            &client_ca,
            "worker-1",
            "worker-1",
            rcgen::ExtendedKeyUsagePurpose::ClientAuth,
        );
        let server_cert_path = write_temp("mtls-server.crt", &server_cert);
        let server_key_path = write_temp("mtls-server.key", &server_key);
        let client_ca_pem = client_ca.pem();
        let client_ca_path = write_temp("mtls-client-ca.crt", &client_ca_pem);

        let tls =
            server_tls_config(&server_cert_path, &server_key_path, Some(&client_ca_path)).unwrap();
        let client = client_tls(
            &server_ca.pem(),
            Some((client_cert.as_str(), client_key.as_str())),
        );
        try_connect(tls, client).await.unwrap();
    }

    #[tokio::test]
    async fn mtls_rejects_connection_without_client_certificate() {
        let server_ca = certificate_authority("awg-server-ca");
        let client_ca = certificate_authority("awg-worker-ca");
        let (server_cert, server_key) = leaf_certificate(
            &server_ca,
            "admin.internal",
            "localhost",
            rcgen::ExtendedKeyUsagePurpose::ServerAuth,
        );
        let server_cert_path = write_temp("mtls-no-client-server.crt", &server_cert);
        let server_key_path = write_temp("mtls-no-client-server.key", &server_key);
        let client_ca_path = write_temp("mtls-no-client-ca.crt", &client_ca.pem());

        let tls =
            server_tls_config(&server_cert_path, &server_key_path, Some(&client_ca_path)).unwrap();
        let client = client_tls(&server_ca.pem(), None);
        assert!(try_connect(tls, client).await.is_err());
    }

    #[tokio::test]
    async fn mtls_rejects_client_certificate_from_another_ca() {
        let server_ca = certificate_authority("awg-server-ca");
        let client_ca = certificate_authority("awg-worker-ca");
        let stranger_ca = certificate_authority("stranger-ca");
        let (server_cert, server_key) = leaf_certificate(
            &server_ca,
            "admin.internal",
            "localhost",
            rcgen::ExtendedKeyUsagePurpose::ServerAuth,
        );
        let (stranger_cert, stranger_key) = leaf_certificate(
            &stranger_ca,
            "worker-x",
            "worker-x",
            rcgen::ExtendedKeyUsagePurpose::ClientAuth,
        );
        let server_cert_path = write_temp("mtls-stranger-server.crt", &server_cert);
        let server_key_path = write_temp("mtls-stranger-server.key", &server_key);
        let client_ca_path = write_temp("mtls-stranger-client-ca.crt", &client_ca.pem());

        let tls =
            server_tls_config(&server_cert_path, &server_key_path, Some(&client_ca_path)).unwrap();
        let client = client_tls(
            &server_ca.pem(),
            Some((stranger_cert.as_str(), stranger_key.as_str())),
        );
        assert!(try_connect(tls, client).await.is_err());
    }
}
