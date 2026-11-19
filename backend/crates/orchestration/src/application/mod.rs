use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId(u64);

impl SessionId {
    pub fn value(self) -> u64 {
        self.0
    }
}

struct Entry {
    session: SessionId,
    sender: tokio::sync::mpsc::Sender<DesiredState>,
    connected_at: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    version: Option<String>,
    dirty: bool,
}

pub struct WorkerRegistry {
    workers: Mutex<HashMap<Uuid, Entry>>,
    next_session: AtomicU64,
}

impl Default for WorkerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkerRegistry {
    pub fn new() -> Self {
        Self {
            workers: Mutex::new(HashMap::new()),
            next_session: AtomicU64::new(1),
        }
    }

    pub fn register(
        &self,
        node_id: Uuid,
        sender: tokio::sync::mpsc::Sender<DesiredState>,
        version: Option<String>,
    ) -> SessionId {
        let now = Utc::now();
        let session = SessionId(self.next_session.fetch_add(1, Ordering::SeqCst));
        let mut workers = self.workers.lock().expect("worker registry lock");
        workers.insert(
            node_id,
            Entry {
                session,
                sender,
                connected_at: now,
                last_seen: now,
                version,
                dirty: false,
            },
        );
        session
    }

    pub fn unregister(&self, node_id: Uuid, session: SessionId) -> bool {
        let mut workers = self.workers.lock().expect("worker registry lock");
        if workers
            .get(&node_id)
            .is_some_and(|entry| entry.session == session)
        {
            workers.remove(&node_id);
            true
        } else {
            false
        }
    }

    pub fn touch(&self, node_id: Uuid, session: SessionId) {
        let mut workers = self.workers.lock().expect("worker registry lock");
        if let Some(entry) = workers.get_mut(&node_id)
            && entry.session == session
        {
            entry.last_seen = Utc::now();
        }
    }

    pub fn push(&self, node_id: Uuid, state: &DesiredState) -> bool {
        let mut workers = self.workers.lock().expect("worker registry lock");
        let Some(entry) = workers.get_mut(&node_id) else {
            return false;
        };
        match entry.sender.try_send(state.clone()) {
            Ok(()) => {
                entry.dirty = false;
                true
            }
            Err(_) => {
                entry.dirty = true;
                false
            }
        }
    }

    pub fn dirty_nodes(&self) -> Vec<Uuid> {
        let workers = self.workers.lock().expect("worker registry lock");
        let mut nodes: Vec<Uuid> = workers
            .iter()
            .filter(|(_, entry)| entry.dirty)
            .map(|(node_id, _)| *node_id)
            .collect();
        nodes.sort_unstable();
        nodes
    }

    /// Marks an online node as needing a fresh snapshot on the next tick.
    /// Returns `false` when the node is not connected.
    pub fn mark_dirty(&self, node_id: Uuid) -> bool {
        let mut workers = self.workers.lock().expect("worker registry lock");
        match workers.get_mut(&node_id) {
            Some(entry) => {
                entry.dirty = true;
                true
            }
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
        if !self.registry.is_online(node_id) {
            return Ok(false);
        }
        let state = self.snapshot(node_id)?;
        Ok(self.registry.push(node_id, &state))
    }

    pub fn publish_all(&self) {
        for presence in self.registry.presence() {
            let _ = self.publish(presence.node_id);
        }
    }

    pub fn publish_dirty(&self) -> usize {
        let mut published = 0;
        for node_id in self.registry.dirty_nodes() {
            if matches!(self.publish(node_id), Ok(true)) {
                published += 1;
            }
        }
        published
    }

    pub fn authenticate(&self, node_id: Uuid, token: &str) -> CoreResult<()> {
        self.nodes.authenticate(node_id, token)
    }

    pub fn online(&self, node_id: Uuid, online: bool, version: Option<String>) -> CoreResult<()> {
        self.nodes.set_online(node_id, online, version)
    }

    pub fn record_stats(&self, node_id: Uuid, snapshot: WorkerStats) -> CoreResult<usize> {
        let mut samples: Vec<(Uuid, Uuid, CounterSample)> = Vec::new();
        for interface in snapshot.interfaces {
            for peer in interface.peers {
                samples.push((
                    interface.interface_id,
                    peer.device_id,
                    CounterSample {
                        peer_id: peer.peer_id,
                        rx_total: peer.rx_total,
                        tx_total: peer.tx_total,
                    },
                ));
            }
        }
        if samples.is_empty() {
            return Ok(0);
        }
        let updates =
            self.stats
                .record_node_snapshot(node_id, &samples, self.directory.as_ref())?;
        Ok(updates.len())
    }

    pub fn require_online(&self, node_id: Uuid) -> CoreResult<()> {
        if self.registry.is_online(node_id) {
            Ok(())
        } else {
            Err(CoreError::Conflict(format!("worker {node_id} is offline")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn state(node_id: Uuid) -> DesiredState {
        DesiredState {
            node_id,
            revision: String::new(),
            generated_at: Utc::now(),
            interfaces: Vec::new(),
        }
    }

    #[test]
    fn stale_session_does_not_unregister_the_new_one() {
        let registry = WorkerRegistry::new();
        let node_id = Uuid::new_v4();
        let (first_tx, _first_rx) = tokio::sync::mpsc::channel(4);
        let (second_tx, _second_rx) = tokio::sync::mpsc::channel(4);

        let first = registry.register(node_id, first_tx, None);
        let second = registry.register(node_id, second_tx, None);
        assert_ne!(first, second);

        registry.unregister(node_id, first);
        assert!(registry.is_online(node_id));

        registry.unregister(node_id, second);
        assert!(!registry.is_online(node_id));
    }

    #[test]
    fn overflow_marks_the_node_dirty_and_a_retry_clears_it() {
        let registry = WorkerRegistry::new();
        let node_id = Uuid::new_v4();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        registry.register(node_id, sender, None);

        assert!(registry.push(node_id, &state(node_id)));
        assert!(!registry.push(node_id, &state(node_id)));
        assert_eq!(registry.dirty_nodes(), vec![node_id]);

        let queued = receiver.try_recv().expect("the first state is queued");
        assert_eq!(queued.node_id, node_id);
        assert!(registry.push(node_id, &state(node_id)));
        assert!(registry.dirty_nodes().is_empty());
    }

    #[test]
    fn touch_ignores_a_stale_session() {
        let registry = WorkerRegistry::new();
        let node_id = Uuid::new_v4();
        let (first_tx, _first_rx) = tokio::sync::mpsc::channel(4);
        let (second_tx, _second_rx) = tokio::sync::mpsc::channel(4);
        let first = registry.register(node_id, first_tx, None);
        let second = registry.register(node_id, second_tx, None);
        let after_register = registry
            .presence()
            .into_iter()
            .find(|presence| presence.node_id == node_id)
            .map(|presence| presence.last_seen)
            .unwrap();

        registry.touch(node_id, first);
        let untouched = registry
            .presence()
            .into_iter()
            .find(|presence| presence.node_id == node_id)
            .map(|presence| presence.last_seen)
            .unwrap();
        assert_eq!(untouched, after_register);

        registry.touch(node_id, second);
        assert!(registry.is_online(node_id));
    }

    struct Source;

    impl SnapshotSource for Source {
        fn build(&self, node_id: Uuid) -> CoreResult<DesiredState> {
            Ok(state(node_id).seal())
        }
    }

    struct CountingSource {
        builds: AtomicUsize,
    }

    impl CountingSource {
        fn new() -> Self {
            Self {
                builds: AtomicUsize::new(0),
            }
        }

        fn count(&self) -> usize {
            self.builds.load(Ordering::SeqCst)
        }
    }

    impl SnapshotSource for CountingSource {
        fn build(&self, node_id: Uuid) -> CoreResult<DesiredState> {
            self.builds.fetch_add(1, Ordering::SeqCst);
            Ok(state(node_id).seal())
        }
    }

    #[test]
    fn publish_skips_snapshot_builds_without_an_online_worker() {
        let registry = Arc::new(WorkerRegistry::new());
        let node_id = Uuid::new_v4();
        let source = Arc::new(CountingSource::new());
        let service = OrchestrationService::new(
            registry.clone(),
            source.clone(),
            Arc::new(StatsService::new(Arc::new(EmptyStats), Arc::new(Hub))),
            Arc::new(Directory),
            Arc::new(Nodes),
        );

        assert!(!service.publish(node_id).unwrap());
        assert_eq!(source.count(), 0);

        let (sender, _receiver) = tokio::sync::mpsc::channel(4);
        registry.register(node_id, sender, None);
        assert!(service.publish(node_id).unwrap());
        assert_eq!(source.count(), 1);
    }

    struct Directory;

    impl DeviceDirectory for Directory {
        fn group_and_user(&self, _device_id: Uuid) -> CoreResult<Option<(Uuid, Uuid)>> {
            Ok(None)
        }
    }

    struct Nodes;

    impl NodeDirectory for Nodes {
        fn authenticate(&self, _node_id: Uuid, _token: &str) -> CoreResult<()> {
            Ok(())
        }

        fn set_online(
            &self,
            _node_id: Uuid,
            _online: bool,
            _version: Option<String>,
        ) -> CoreResult<()> {
            Ok(())
        }
    }

    struct EmptyStats;

    impl awg_statistics::StatsRepository for EmptyStats {
        fn counter(
            &self,
            _key: awg_statistics::CounterKey,
        ) -> CoreResult<Option<awg_statistics::CounterState>> {
            Ok(None)
        }

        fn save_counter(
            &self,
            _key: awg_statistics::CounterKey,
            _state: &awg_statistics::CounterState,
        ) -> CoreResult<()> {
            Ok(())
        }

        fn add_bucket(
            &self,
            _scope: awg_statistics::StatsScope,
            _hour: i64,
            _rx: u64,
            _tx: u64,
        ) -> CoreResult<()> {
            Ok(())
        }

        fn series(
            &self,
            _scope: awg_statistics::StatsScope,
            _from_hour: i64,
            _to_hour: i64,
        ) -> CoreResult<Vec<awg_statistics::Bucket>> {
            Ok(Vec::new())
        }

        fn cleanup_before(&self, _hour: i64) -> CoreResult<usize> {
            Ok(0)
        }
    }

    struct Hub;

    impl awg_statistics::StatsBroadcaster for Hub {
        fn broadcast(&self, _update: awg_statistics::StatsUpdate) {}
    }

    #[tokio::test]
    async fn periodic_reconcile_republishes_after_an_overflow() {
        let registry = Arc::new(WorkerRegistry::new());
        let node_id = Uuid::new_v4();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        registry.register(node_id, sender, None);
        let service = OrchestrationService::new(
            registry.clone(),
            Arc::new(Source),
            Arc::new(StatsService::new(Arc::new(EmptyStats), Arc::new(Hub))),
            Arc::new(Directory),
            Arc::new(Nodes),
        );

        assert!(service.publish(node_id).unwrap());
        assert!(!service.publish(node_id).unwrap());
        assert_eq!(registry.dirty_nodes(), vec![node_id]);

        let _ = receiver.recv().await.expect("first state");
        service.publish_all();

        assert!(registry.dirty_nodes().is_empty());
        let retried = receiver.try_recv().expect("state was republished");
        assert_eq!(retried.node_id, node_id);
    }
}
