use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use awg_proto::worker_gateway_client::WorkerGatewayClient;
use awg_proto::{self as proto, server_message, worker_message};
use tokio::sync::Mutex;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Endpoint;
use uuid::Uuid;

use crate::application::{ReconcileService, StatsReport};
use crate::domain::{DesiredInterface, DesiredPeer, DesiredState, ForwardingRule, WireObf};
use crate::infrastructure::GrpcTlsOptions;

pub struct WorkerClient {
    pub url: String,
    pub node_id: Uuid,
    pub token: String,
    pub version: String,
    pub stats_interval: Duration,
    pub tls: GrpcTlsOptions,
}

impl WorkerClient {
    pub async fn run(self, service: Arc<ReconcileService>) -> Result<()> {
        loop {
            match self.session(service.clone()).await {
                Ok(()) => tracing::warn!("worker session closed, reconnecting"),
                Err(error) => tracing::warn!(%error, "worker session failed, reconnecting"),
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }

    async fn session(&self, service: Arc<ReconcileService>) -> Result<()> {
        let mut endpoint = Endpoint::from_shared(self.url.clone())
            .with_context(|| format!("invalid AWG_GRPC_URL {:?}", self.url))?;
        if let Some(tls) = self.tls.client_config()? {
            endpoint = endpoint
                .tls_config(tls)
                .context("failed to configure gRPC TLS")?;
        }
        let channel = endpoint
            .connect()
            .await
            .context("failed to connect to admin gRPC")?;
        let mut client = WorkerGatewayClient::new(channel);
        let (tx, rx) = tokio::sync::mpsc::channel(32);
        let response = client
            .session(ReceiverStream::new(rx))
            .await
            .context("failed to open session")?;
        let mut inbound = response.into_inner();

        tx.send(proto::WorkerMessage {
            payload: Some(worker_message::Payload::Hello(proto::Hello {
                node_id: self.node_id.to_string(),
                token: self.token.clone(),
                version: self.version.clone(),
            })),
        })
        .await
        .context("failed to send hello")?;

        let current: Arc<Mutex<Option<DesiredState>>> = Arc::new(Mutex::new(None));
        let stats_task = {
            let service = service.clone();
            let current = current.clone();
            let tx = tx.clone();
            let interval = self.stats_interval;
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(interval);
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    ticker.tick().await;
                    let state = current.lock().await.clone();
                    let Some(state) = state else {
                        continue;
                    };
                    match service.collect(&state).await {
                        Ok(report) => {
                            let snapshot = to_proto_stats(&state, &report);
                            if tx
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
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(20));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    ticker.tick().await;
                    let metrics = match crate::infrastructure::metrics::collect() {
                        Ok(metrics) => Some(to_proto_metrics(metrics)),
                        Err(error) => {
                            tracing::warn!(%error, "failed to collect node metrics");
                            None
                        }
                    };
                    let heartbeat = proto::Heartbeat {
                        at: chrono::Utc::now().timestamp(),
                        metrics,
                    };
                    if tx
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

        while let Some(message) = inbound.next().await {
            let message = message.context("gRPC stream failed")?;
            match message.payload {
                Some(server_message::Payload::State(state)) => {
                    let revision = state.revision.clone();
                    let desired = to_domain_state(state);
                    let result = service.apply(&desired).await;
                    *current.lock().await = Some(desired);
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
                    tx.send(proto::WorkerMessage {
                        payload: Some(worker_message::Payload::ApplyResult(result_message)),
                    })
                    .await
                    .context("failed to send apply result")?;
                }
                Some(server_message::Payload::Ping(_)) => {}
                Some(server_message::Payload::Ack(ack)) if !ack.ok => {
                    tracing::warn!(error = %ack.error, "admin reported an error");
                }
                Some(server_message::Payload::Ack(_)) => {}
                None => {}
            }
        }

        stats_task.abort();
        heartbeat_task.abort();
        Ok(())
    }
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

fn to_domain_state(state: proto::DesiredState) -> DesiredState {
    DesiredState {
        revision: state.revision,
        interfaces: state
            .interfaces
            .into_iter()
            .map(|interface| DesiredInterface {
                id: parse_uuid(&interface.id),
                name: interface.name,
                listen_port: interface.listen_port as u16,
                mtu: interface.mtu as u16,
                private_key: interface.private_key,
                public_key: interface.public_key,
                enabled: interface.enabled,
                obf: WireObf {
                    h1: interface.h1,
                    h2: interface.h2,
                    h3: interface.h3,
                    h4: interface.h4,
                    s1: interface.s1 as u16,
                    s2: interface.s2 as u16,
                    s3: interface.s3 as u16,
                    s4: interface.s4 as u16,
                    header_protection_key: interface.header_protection_key,
                    random_trailers: interface.random_trailers,
                },
                addresses: interface.addresses,
                peers: interface
                    .peers
                    .into_iter()
                    .map(|peer| DesiredPeer {
                        peer_id: parse_uuid(&peer.peer_id),
                        device_id: parse_uuid(&peer.device_id),
                        user_id: parse_uuid(&peer.user_id),
                        public_key: peer.public_key,
                        preshared_key: peer.preshared_key,
                        allowed_ips: peer.allowed_ips,
                        addresses: peer.addresses,
                        down_kbps: peer.down_kbps,
                        up_kbps: peer.up_kbps,
                    })
                    .collect(),
                group_down_kbps: interface.group_down_kbps,
                group_up_kbps: interface.group_up_kbps,
                user_limits: interface
                    .user_limits
                    .into_iter()
                    .map(|limit| crate::domain::UserLimit {
                        user_id: parse_uuid(&limit.user_id),
                        group_down_kbps: limit.group_down_kbps,
                        group_up_kbps: limit.group_up_kbps,
                    })
                    .collect(),
                forwarding: interface
                    .forwarding
                    .into_iter()
                    .map(|rule| ForwardingRule {
                        from_device_id: parse_uuid(&rule.from_device_id),
                        to_device_id: parse_uuid(&rule.to_device_id),
                        from_ip: rule.from_ip,
                        to_ip: rule.to_ip,
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn to_proto_stats(state: &DesiredState, report: &StatsReport) -> proto::StatsSnapshot {
    proto::StatsSnapshot {
        revision: state.revision.clone(),
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

fn parse_uuid(value: &str) -> Uuid {
    value.parse().unwrap_or(Uuid::nil())
}
