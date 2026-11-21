use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use awg_proto::worker_gateway_client::WorkerGatewayClient;
use awg_proto::{self as proto, server_message, worker_message};
use tokio::sync::{Mutex, mpsc, watch};
use tokio::task::JoinHandle;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Endpoint;
use uuid::Uuid;

use crate::application::{ReconcileService, StatsReport};
use crate::domain::{DesiredInterface, DesiredPeer, DesiredState, ForwardingRule, WireObf};
use crate::infrastructure::GrpcTlsOptions;

/// Large desired states (hundreds of peers) must not tear the session down.
const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(20);
const KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(20);
const OUTBOUND_QUEUE: usize = 64;
/// Stats are bulk data and may wait; control messages (apply results, pong)
/// go through their own small channel with priority.
const DATA_QUEUE: usize = 32;
const CONTROL_QUEUE: usize = 16;
const TASK_STOP_TIMEOUT: Duration = Duration::from_secs(2);
const RECONNECT_MIN_SECS: u64 = 1;
const RECONNECT_MAX_SECS: u64 = 60;

pub struct WorkerClient {
    pub url: String,
    pub node_id: Uuid,
    pub token: String,
    pub version: String,
    pub stats_interval: Duration,
    pub tls: GrpcTlsOptions,
}

impl WorkerClient {
    pub async fn run(
        self,
        service: Arc<ReconcileService>,
        shutdown: watch::Receiver<bool>,
    ) -> Result<()> {
        let mut attempt: u32 = 0;
        loop {
            if *shutdown.borrow() {
                tracing::info!("shutdown requested, worker client stopped");
                return Ok(());
            }

            let mut guard = shutdown.clone();
            let session_shutdown = shutdown.clone();
            let outcome = tokio::select! {
                biased;
                _ = guard.wait_for(|stop| *stop) => {
                    tracing::info!("shutdown requested, worker client stopped");
                    return Ok(());
                }
                result = self.session(service.clone(), session_shutdown) => result,
            };

            match outcome {
                Ok(()) => {
                    attempt = 0;
                    tracing::warn!("worker session closed, reconnecting");
                }
                Err(error) => {
                    attempt = attempt.saturating_add(1);
                    tracing::warn!(%error, attempt, "worker session failed, reconnecting");
                }
            }

            let delay = backoff_delay(attempt, entropy());
            tracing::info!(delay_ms = delay.as_millis(), "reconnect scheduled");
            let mut guard = shutdown.clone();
            tokio::select! {
                biased;
                _ = guard.wait_for(|stop| *stop) => {
                    tracing::info!("shutdown requested during reconnect backoff");
                    return Ok(());
                }
                _ = tokio::time::sleep(delay) => {}
            }
        }
    }

    async fn session(
        &self,
        service: Arc<ReconcileService>,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<()> {
        let endpoint = Endpoint::from_shared(self.url.clone())
            .with_context(|| format!("invalid AWG_GRPC_URL {:?}", self.url))?
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .tcp_keepalive(Some(KEEP_ALIVE_INTERVAL))
            .http2_keep_alive_interval(KEEP_ALIVE_INTERVAL)
            .keep_alive_timeout(KEEP_ALIVE_TIMEOUT);
        let endpoint = match self.tls.client_config()? {
            Some(tls) => endpoint
                .tls_config(tls)
                .context("failed to configure gRPC TLS")?,
            None => endpoint,
        };
        let channel = endpoint
            .connect()
            .await
            .context("failed to connect to admin gRPC")?;
        let mut client = WorkerGatewayClient::new(channel)
            .max_decoding_message_size(MAX_MESSAGE_BYTES)
            .max_encoding_message_size(MAX_MESSAGE_BYTES);

        let (stream_tx, stream_rx) = mpsc::channel::<proto::WorkerMessage>(OUTBOUND_QUEUE);
        let (control_tx, mut control_rx) = mpsc::channel::<proto::WorkerMessage>(CONTROL_QUEUE);
        let (data_tx, mut data_rx) = mpsc::channel::<proto::WorkerMessage>(DATA_QUEUE);

        stream_tx
            .send(proto::WorkerMessage {
                payload: Some(worker_message::Payload::Hello(proto::Hello {
                    node_id: self.node_id.to_string(),
                    token: self.token.clone(),
                    version: self.version.clone(),
                })),
            })
            .await
            .context("failed to send hello")?;

        // Merge both channels into the single gRPC request stream. `biased`
        // guarantees an apply result never queues behind 32 stats messages.
        let pump = tokio::spawn(async move {
            loop {
                let message = tokio::select! {
                    biased;
                    Some(message) = control_rx.recv() => message,
                    Some(message) = data_rx.recv() => message,
                    else => break,
                };
                if stream_tx.send(message).await.is_err() {
                    break;
                }
            }
        });

        let response = match client.session(ReceiverStream::new(stream_rx)).await {
            Ok(response) => response,
            Err(error) => {
                pump.abort();
                let _ = pump.await;
                return Err(anyhow::Error::new(error).context("failed to open session"));
            }
        };
        let mut inbound = response.into_inner();

        let applied: Arc<Mutex<Option<DesiredState>>> = Arc::new(Mutex::new(None));
        let (stop_tx, stop_rx) = watch::channel(false);

        let stats_task = {
            let service = service.clone();
            let applied = applied.clone();
            let data_tx = data_tx.clone();
            let mut stop = stop_rx.clone();
            let interval = self.stats_interval;
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(interval);
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        biased;
                        _ = stop.wait_for(|value| *value) => break,
                        _ = ticker.tick() => {}
                    }
                    let state = applied.lock().await.clone();
                    let Some(state) = state else {
                        continue;
                    };
                    match service.collect(&state).await {
                        Ok(report) => {
                            let snapshot = to_proto_stats(&state.revision, &report);
                            if data_tx
                                .send(proto::WorkerMessage {
                                    payload: Some(worker_message::Payload::Stats(snapshot)),
                                })
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "failed to collect stats");
                        }
                    }
                }
            })
        };

        let heartbeat_task = {
            let data_tx = data_tx.clone();
            let mut stop = stop_rx.clone();
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(KEEP_ALIVE_INTERVAL);
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        biased;
                        _ = stop.wait_for(|value| *value) => break,
                        _ = ticker.tick() => {}
                    }
                    let metrics =
                        tokio::task::spawn_blocking(crate::infrastructure::metrics::collect).await;
                    let metrics = match metrics {
                        Ok(Ok(metrics)) => Some(to_proto_metrics(metrics)),
                        Ok(Err(error)) => {
                            tracing::warn!(%error, "failed to collect node metrics");
                            None
                        }
                        Err(error) => {
                            tracing::warn!(%error, "node metrics task panicked");
                            None
                        }
                    };
                    let heartbeat = proto::Heartbeat {
                        at: chrono::Utc::now().timestamp(),
                        metrics,
                    };
                    if data_tx
                        .send(proto::WorkerMessage {
                            payload: Some(worker_message::Payload::Heartbeat(heartbeat)),
                        })
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            })
        };

        let mut session_error = None;
        loop {
            let message = tokio::select! {
                biased;
                _ = shutdown.wait_for(|stop| *stop) => {
                    tracing::info!("shutdown requested, finishing the current apply");
                    break;
                }
                message = inbound.next() => message,
            };
            let Some(message) = message else {
                break;
            };
            let message = match message {
                Ok(message) => message,
                Err(error) => {
                    session_error = Some(anyhow::Error::new(error).context("gRPC stream failed"));
                    break;
                }
            };
            match message.payload {
                Some(server_message::Payload::State(state)) => {
                    let revision = state.revision.clone();
                    let desired = match to_domain_state(state) {
                        Ok(desired) => desired,
                        Err(error) => {
                            tracing::error!(revision = %revision, %error, "invalid desired state");
                            send_control(
                                &control_tx,
                                proto::ApplyResult {
                                    revision,
                                    ok: false,
                                    error: format!("{error:#}"),
                                },
                            )
                            .await?;
                            continue;
                        }
                    };
                    let result = service.apply(&desired).await;
                    if result.is_ok() {
                        *applied.lock().await = Some(desired.clone());
                    }
                    let result_message = match &result {
                        Ok(()) => proto::ApplyResult {
                            revision,
                            ok: true,
                            error: String::new(),
                        },
                        Err(error) => {
                            tracing::error!(%error, "failed to apply desired state");
                            proto::ApplyResult {
                                revision,
                                ok: false,
                                error: format!("{error:#}"),
                            }
                        }
                    };
                    send_control(&control_tx, result_message).await?;
                }
                Some(server_message::Payload::Ping(_)) => {
                    // The proto has no Pong message; a heartbeat is the
                    // liveness acknowledgement the admin already understands.
                    let heartbeat = proto::Heartbeat {
                        at: chrono::Utc::now().timestamp(),
                        metrics: None,
                    };
                    if control_tx
                        .send(proto::WorkerMessage {
                            payload: Some(worker_message::Payload::Heartbeat(heartbeat)),
                        })
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Some(server_message::Payload::Ack(ack)) if !ack.ok => {
                    tracing::warn!(error = %ack.error, "admin reported an error");
                }
                Some(server_message::Payload::Ack(_)) => {}
                None => {}
            }
        }

        // Best-effort final acknowledgement of the applied revision before
        // the stream is closed. An empty revision (legacy admin) is still
        // acknowledged; it simply carries no identity.
        let final_revision = applied
            .lock()
            .await
            .as_ref()
            .map(|state| state.revision.clone());
        if let Some(revision) = final_revision {
            let message = proto::WorkerMessage {
                payload: Some(worker_message::Payload::ApplyResult(proto::ApplyResult {
                    revision,
                    ok: true,
                    error: String::new(),
                })),
            };
            if tokio::time::timeout(Duration::from_secs(1), control_tx.send(message))
                .await
                .is_err()
            {
                tracing::debug!("could not send the final ack before shutdown");
            }
        }

        let _ = stop_tx.send(true);
        drop(control_tx);
        drop(data_tx);
        stop_task(stats_task, "stats").await;
        stop_task(heartbeat_task, "heartbeat").await;
        stop_task(pump, "outbound pump").await;

        match session_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

async fn send_control(
    control: &mpsc::Sender<proto::WorkerMessage>,
    result: proto::ApplyResult,
) -> Result<()> {
    control
        .send(proto::WorkerMessage {
            payload: Some(worker_message::Payload::ApplyResult(result)),
        })
        .await
        .context("failed to send apply result")
}

async fn stop_task(mut task: JoinHandle<()>, name: &'static str) {
    match tokio::time::timeout(TASK_STOP_TIMEOUT, &mut task).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::debug!(%error, task = name, "task join failed"),
        Err(_) => {
            tracing::warn!(task = name, "task did not stop in time, aborting");
            task.abort();
            let _ = task.await;
        }
    }
}

fn entropy() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos() as u64)
        .unwrap_or(0)
}

/// Exponential reconnect delay: 1, 2, 4 … 60 seconds with ±20% jitter.
fn backoff_delay(attempt: u32, entropy: u64) -> Duration {
    let exponent = RECONNECT_MIN_SECS << attempt.min(6);
    let base_ms = exponent.min(RECONNECT_MAX_SECS) * 1000;
    let spread = base_ms / 5;
    let jitter = entropy % (2 * spread + 1);
    let millis = base_ms
        .saturating_sub(spread)
        .saturating_add(jitter)
        .clamp(RECONNECT_MIN_SECS * 1000, RECONNECT_MAX_SECS * 1000);
    Duration::from_millis(millis)
}

fn to_proto_metrics(metrics: crate::infrastructure::NodeMetrics) -> proto::NodeMetrics {
    proto::NodeMetrics {
        cpu_load: metrics.cpu_load,
        mem_used_bytes: metrics.mem_used_bytes,
        mem_total_bytes: metrics.mem_total_bytes,
        kernel_version: metrics.kernel_version,
        worker_version: metrics.worker_version,
        uptime_secs: metrics.uptime_secs,
    }
}

fn to_domain_state(state: proto::DesiredState) -> Result<DesiredState> {
    Ok(DesiredState {
        revision: state.revision,
        interfaces: state
            .interfaces
            .into_iter()
            .map(|interface| {
                let name = interface.name.clone();
                to_domain_interface(interface)
                    .with_context(|| format!("invalid desired interface {name:?}"))
            })
            .collect::<Result<Vec<_>>>()?,
    })
}

fn to_domain_interface(interface: proto::DesiredInterface) -> Result<DesiredInterface> {
    let name = interface.name.clone();
    if name.is_empty() {
        bail!("interface name must not be empty");
    }
    Ok(DesiredInterface {
        id: parse_uuid("interface.id", &interface.id)?,
        name,
        listen_port: listen_port("listen_port", interface.listen_port)?,
        mtu: mtu("mtu", interface.mtu)?,
        private_key: interface.private_key,
        public_key: interface.public_key,
        enabled: interface.enabled,
        obf: WireObf {
            h1: interface.h1,
            h2: interface.h2,
            h3: interface.h3,
            h4: interface.h4,
            s1: obf_value("s1", interface.s1)?,
            s2: obf_value("s2", interface.s2)?,
            s3: obf_value("s3", interface.s3)?,
            s4: obf_value("s4", interface.s4)?,
            header_protection_key: interface.header_protection_key,
            random_trailers: interface.random_trailers,
        },
        addresses: interface.addresses,
        peers: interface
            .peers
            .into_iter()
            .map(|peer| {
                let device_id = peer.device_id.clone();
                to_domain_peer(peer).with_context(|| format!("invalid desired peer {device_id:?}"))
            })
            .collect::<Result<Vec<_>>>()?,
        group_down_kbps: interface.group_down_kbps,
        group_up_kbps: interface.group_up_kbps,
        user_limits: interface
            .user_limits
            .into_iter()
            .map(|limit| {
                Ok(crate::domain::UserLimit {
                    user_id: parse_uuid("user_limit.user_id", &limit.user_id)?,
                    group_down_kbps: limit.group_down_kbps,
                    group_up_kbps: limit.group_up_kbps,
                })
            })
            .collect::<Result<Vec<_>>>()?,
        forwarding: interface
            .forwarding
            .into_iter()
            .map(|rule| {
                Ok(ForwardingRule {
                    from_device_id: parse_uuid("forwarding.from_device_id", &rule.from_device_id)?,
                    to_device_id: parse_uuid("forwarding.to_device_id", &rule.to_device_id)?,
                    from_ip: rule.from_ip,
                    to_ip: rule.to_ip,
                })
            })
            .collect::<Result<Vec<_>>>()?,
    })
}

fn to_domain_peer(peer: proto::DesiredPeer) -> Result<DesiredPeer> {
    Ok(DesiredPeer {
        peer_id: parse_uuid("peer.peer_id", &peer.peer_id)?,
        device_id: parse_uuid("peer.device_id", &peer.device_id)?,
        user_id: parse_uuid("peer.user_id", &peer.user_id)?,
        public_key: peer.public_key,
        preshared_key: peer.preshared_key,
        allowed_ips: peer.allowed_ips,
        addresses: peer.addresses,
        down_kbps: peer.down_kbps,
        up_kbps: peer.up_kbps,
    })
}

fn parse_uuid(field: &str, value: &str) -> Result<Uuid> {
    value
        .trim()
        .parse()
        .with_context(|| format!("{field} {value:?} is not a valid UUID"))
}

fn listen_port(field: &str, value: u32) -> Result<u16> {
    u16::try_from(value).with_context(|| format!("{field} {value} is out of range (0..=65535)"))
}

fn mtu(field: &str, value: u32) -> Result<u16> {
    if value < 576 {
        bail!("{field} {value} is out of range (576..=65535)");
    }
    u16::try_from(value).with_context(|| format!("{field} {value} is out of range (576..=65535)"))
}

fn obf_value(field: &str, value: u32) -> Result<u16> {
    match u16::try_from(value) {
        Ok(0) | Err(_) => bail!("{field} {value} is out of range (1..=65535)"),
        Ok(value) => Ok(value),
    }
}

fn to_proto_stats(revision: &str, report: &StatsReport) -> proto::StatsSnapshot {
    proto::StatsSnapshot {
        revision: revision.to_string(),
        at: chrono::Utc::now().timestamp(),
        interfaces: report
            .interfaces
            .iter()
            .map(|interface| proto::InterfaceStats {
                interface_id: interface.interface_id.to_string(),
                rx_total: interface.rx_total,
                tx_total: interface.tx_total,
                epoch: 0,
                peers: interface
                    .peers
                    .iter()
                    .map(|peer| proto::PeerStats {
                        peer_id: peer.peer_id.to_string(),
                        device_id: peer.device_id.to_string(),
                        public_key: peer.public_key.clone(),
                        rx_total: peer.rx_total,
                        tx_total: peer.tx_total,
                        last_handshake: peer.last_handshake,
                    })
                    .collect(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proto_peer() -> proto::DesiredPeer {
        proto::DesiredPeer {
            peer_id: Uuid::new_v4().to_string(),
            device_id: Uuid::new_v4().to_string(),
            user_id: Uuid::new_v4().to_string(),
            public_key: "peer".into(),
            preshared_key: String::new(),
            allowed_ips: vec!["10.0.0.2/32".into()],
            addresses: vec!["10.0.0.2/32".into()],
            down_kbps: 0,
            up_kbps: 0,
        }
    }

    fn proto_interface() -> proto::DesiredInterface {
        proto::DesiredInterface {
            id: Uuid::new_v4().to_string(),
            name: "awg0".into(),
            listen_port: 51820,
            mtu: 1420,
            private_key: "private".into(),
            public_key: "public".into(),
            enabled: true,
            h1: "100-200".into(),
            h2: "300-400".into(),
            h3: "500-600".into(),
            h4: "700-800".into(),
            s1: 15,
            s2: 16,
            s3: 17,
            s4: 18,
            header_protection_key: String::new(),
            random_trailers: false,
            addresses: vec!["10.0.0.1/32".into()],
            peers: vec![proto_peer()],
            group_down_kbps: 0,
            group_up_kbps: 0,
            forwarding: vec![proto::ForwardingRule {
                from_device_id: Uuid::new_v4().to_string(),
                to_device_id: Uuid::new_v4().to_string(),
                from_ip: "10.0.0.2".into(),
                to_ip: "10.0.0.3".into(),
            }],
            user_limits: vec![proto::UserLimit {
                user_id: Uuid::new_v4().to_string(),
                group_down_kbps: 0,
                group_up_kbps: 0,
            }],
        }
    }

    fn state(interface: proto::DesiredInterface) -> proto::DesiredState {
        proto::DesiredState {
            revision: "rev-1".into(),
            interfaces: vec![interface],
            generated_at: 0,
        }
    }

    #[test]
    fn accepts_a_valid_desired_state() {
        let desired = to_domain_state(state(proto_interface())).expect("valid state");
        assert_eq!(desired.revision, "rev-1");
        assert_eq!(desired.interfaces.len(), 1);
        let interface = &desired.interfaces[0];
        assert_eq!(interface.name, "awg0");
        assert_eq!(interface.listen_port, 51820);
        assert_eq!(interface.obf.s4, 18);
        assert_eq!(interface.peers.len(), 1);
        assert_eq!(interface.forwarding.len(), 1);
    }

    #[test]
    fn rejects_listen_port_that_does_not_fit_u16() {
        let mut interface = proto_interface();
        interface.listen_port = 70_000;
        let error = format!("{:#}", to_domain_state(state(interface)).unwrap_err());
        assert!(error.contains("listen_port"), "{error}");
    }

    #[test]
    fn rejects_mtu_that_does_not_fit_u16() {
        let mut interface = proto_interface();
        interface.mtu = 70_000;
        let error = format!("{:#}", to_domain_state(state(interface)).unwrap_err());
        assert!(error.contains("mtu"), "{error}");
        let mut interface = proto_interface();
        interface.mtu = 0;
        assert!(to_domain_state(state(interface)).is_err());
    }

    #[test]
    fn rejects_zero_and_out_of_range_obfuscation_values() {
        for (field, value) in [("s1", 0u32), ("s2", 70_000), ("s3", 0), ("s4", 70_000)] {
            let mut interface = proto_interface();
            match field {
                "s1" => interface.s1 = value,
                "s2" => interface.s2 = value,
                "s3" => interface.s3 = value,
                _ => interface.s4 = value,
            }
            let error = format!("{:#}", to_domain_state(state(interface)).unwrap_err());
            assert!(error.contains(field), "{field}: {error}");
        }
    }

    #[test]
    fn rejects_broken_uuids_instead_of_nil() {
        let mut interface = proto_interface();
        interface.id = "not-a-uuid".into();
        let error = format!("{:#}", to_domain_state(state(interface)).unwrap_err());
        assert!(error.contains("interface.id"), "{error}");

        let mut interface = proto_interface();
        interface.peers[0].device_id = String::new();
        let error = format!("{:#}", to_domain_state(state(interface)).unwrap_err());
        assert!(error.contains("peer.device_id"), "{error}");
    }

    #[test]
    fn rejects_empty_interface_name() {
        let mut interface = proto_interface();
        interface.name = String::new();
        assert!(to_domain_state(state(interface)).is_err());
    }

    #[test]
    fn stats_snapshot_uses_the_given_revision() {
        let report = StatsReport {
            interfaces: Vec::new(),
        };
        let snapshot = to_proto_stats("applied-rev", &report);
        assert_eq!(snapshot.revision, "applied-rev");
    }

    #[test]
    fn backoff_starts_at_one_second_and_is_capped_at_sixty() {
        for entropy in [0, 1, 123_456_789, u64::MAX] {
            let first = backoff_delay(0, entropy);
            assert!(
                (800..=1200).contains(&first.as_millis()),
                "attempt 0: {first:?}"
            );
            let capped = backoff_delay(20, entropy);
            assert!(
                (48_000..=60_000).contains(&capped.as_millis()),
                "attempt 20: {capped:?}"
            );
        }
    }
}
