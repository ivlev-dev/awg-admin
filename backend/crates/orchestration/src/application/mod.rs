use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use uuid::Uuid;

use awg_shared::{CoreError, CoreResult};
use awg_statistics::{CounterSample, DeviceDirectory, StatsService};

use crate::domain::{DesiredState, WorkerStats};

#[derive(Debug, Clone)]
pub struct NodePresence {
    pub node_id: Uuid,
    pub connected_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub version: Option<String>,
}

struct Entry {
    sender: tokio::sync::mpsc::Sender<DesiredState>,
    connected_at: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    version: Option<String>,
}

#[derive(Default)]
pub struct WorkerRegistry {
    workers: Mutex<HashMap<Uuid, Entry>>,
}

impl WorkerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        node_id: Uuid,
        sender: tokio::sync::mpsc::Sender<DesiredState>,
        version: Option<String>,
    ) {
        let now = Utc::now();
        let mut workers = self.workers.lock().expect("worker registry lock");
        workers.insert(
            node_id,
            Entry {
                sender,
                connected_at: now,
                last_seen: now,
                version,
            },
        );
    }

    pub fn unregister(&self, node_id: Uuid) {
        let mut workers = self.workers.lock().expect("worker registry lock");
        workers.remove(&node_id);
    }

    pub fn touch(&self, node_id: Uuid) {
        let mut workers = self.workers.lock().expect("worker registry lock");
        if let Some(entry) = workers.get_mut(&node_id) {
            entry.last_seen = Utc::now();
        }
    }

    pub fn push(&self, node_id: Uuid, state: &DesiredState) -> bool {
        let sender = {
            let workers = self.workers.lock().expect("worker registry lock");
            workers.get(&node_id).map(|e| e.sender.clone())
        };
        match sender {
            Some(tx) => tx.try_send(state.clone()).is_ok(),
            None => false,
        }
    }

    pub fn is_online(&self, node_id: Uuid) -> bool {
        self.workers
            .lock()
            .expect("worker registry lock")
            .contains_key(&node_id)
    }

    pub fn presence(&self) -> Vec<NodePresence> {
        self.workers
            .lock()
            .expect("worker registry lock")
            .iter()
            .map(|(node_id, entry)| NodePresence {
                node_id: *node_id,
                connected_at: entry.connected_at,
                last_seen: entry.last_seen,
                version: entry.version.clone(),
            })
            .collect()
    }
}

pub trait SnapshotSource: Send + Sync {
    fn build(&self, node_id: Uuid) -> CoreResult<DesiredState>;
}

pub trait NodeDirectory: Send + Sync {
    fn authenticate(&self, node_id: Uuid, token: &str) -> CoreResult<()>;
    fn set_online(&self, node_id: Uuid, online: bool, version: Option<String>) -> CoreResult<()>;
}

pub struct OrchestrationService {
    registry: Arc<WorkerRegistry>,
    source: Arc<dyn SnapshotSource>,
    stats: Arc<StatsService>,
    directory: Arc<dyn DeviceDirectory>,
    nodes: Arc<dyn NodeDirectory>,
}

impl OrchestrationService {
    pub fn new(
        registry: Arc<WorkerRegistry>,
        source: Arc<dyn SnapshotSource>,
        stats: Arc<StatsService>,
        directory: Arc<dyn DeviceDirectory>,
        nodes: Arc<dyn NodeDirectory>,
    ) -> Self {
        Self {
            registry,
            source,
            stats,
            directory,
            nodes,
        }
    }

    pub fn registry(&self) -> Arc<WorkerRegistry> {
        self.registry.clone()
    }

    pub fn snapshot(&self, node_id: Uuid) -> CoreResult<DesiredState> {
        self.source.build(node_id).map(|state| state.seal())
    }

    pub fn publish(&self, node_id: Uuid) -> CoreResult<bool> {
        let state = self.snapshot(node_id)?;
        Ok(self.registry.push(node_id, &state))
    }

    pub fn publish_all(&self) {
        for presence in self.registry.presence() {
            let _ = self.publish(presence.node_id);
        }
    }

    pub fn authenticate(&self, node_id: Uuid, token: &str) -> CoreResult<()> {
        self.nodes.authenticate(node_id, token)
    }

    pub fn online(&self, node_id: Uuid, online: bool, version: Option<String>) -> CoreResult<()> {
        self.nodes.set_online(node_id, online, version)
    }

    pub fn record_stats(&self, node_id: Uuid, snapshot: WorkerStats) -> CoreResult<usize> {
        let mut recorded = 0;
        for interface in snapshot.interfaces {
            let samples: Vec<(Uuid, CounterSample)> = interface
                .peers
                .iter()
                .map(|peer| {
                    (
                        peer.device_id,
                        CounterSample {
                            rx_total: peer.rx_total,
                            tx_total: peer.tx_total,
                        },
                    )
                })
                .collect();
            if samples.is_empty() {
                continue;
            }
            let updates = self.stats.record_snapshot(
                node_id,
                interface.interface_id,
                &samples,
                self.directory.as_ref(),
            )?;
            recorded += updates.len();
        }
        Ok(recorded)
    }

    pub fn require_online(&self, node_id: Uuid) -> CoreResult<()> {
        if self.registry.is_online(node_id) {
            Ok(())
        } else {
            Err(CoreError::Conflict(format!("worker {node_id} is offline")))
        }
    }
}
