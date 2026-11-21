use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use async_trait::async_trait;
use uuid::Uuid;

use crate::domain::{CounterBook, DesiredInterface, DesiredState, InterfaceRuntime};

/// Upper bound for the retry delay of a failed interface teardown.
const TEARDOWN_RETRY_MAX_SECS: u64 = 60;

#[derive(Debug, Clone)]
pub struct StatsReport {
    pub interfaces: Vec<InterfaceReport>,
}

#[derive(Debug, Clone)]
pub struct InterfaceReport {
    pub interface_id: Uuid,
    pub rx_total: u64,
    pub tx_total: u64,
    pub peers: Vec<PeerReport>,
}

#[derive(Debug, Clone)]
pub struct PeerReport {
    pub peer_id: Uuid,
    pub device_id: Uuid,
    pub public_key: String,
    pub rx_total: u64,
    pub tx_total: u64,
    pub last_handshake: i64,
}

#[async_trait]
pub trait AwgControl: Send + Sync {
    async fn ensure_interface(&self, interface: &DesiredInterface) -> Result<()>;
    async fn apply_interface(&self, interface: &DesiredInterface) -> Result<()>;
    async fn teardown(&self, name: &str) -> Result<()>;
    async fn read_interface(&self, interface: &DesiredInterface) -> Result<InterfaceRuntime>;

    /// Names of amneziawg interfaces that currently exist on the node.
    ///
    /// The default returns an empty list so test fakes and alternative
    /// implementations keep compiling; orphan cleanup then becomes a no-op.
    async fn list_interfaces(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// Remove interfaces that are not part of the desired state.
    ///
    /// Called once on the first apply after worker start. The default walks
    /// [`Self::list_interfaces`] and tears every unexpected interface down.
    async fn cleanup_orphans(&self, keep: &[String]) -> Result<Vec<String>> {
        let mut removed = Vec::new();
        for name in self.list_interfaces().await? {
            if keep.iter().any(|desired| desired == &name) {
                continue;
            }
            tracing::warn!(interface = %name, "removing orphaned amneziawg interface");
            self.teardown(&name)
                .await
                .with_context(|| format!("orphan cleanup of {name}"))?;
            removed.push(name);
        }
        Ok(removed)
    }
}

#[async_trait]
pub trait TrafficShaper: Send + Sync {
    async fn apply(&self, interface: &DesiredInterface) -> Result<()>;
    async fn clear(&self, name: &str) -> Result<()>;
}

#[async_trait]
pub trait ForwardingControl: Send + Sync {
    async fn apply(&self, interface: &DesiredInterface) -> Result<()>;
    async fn clear(&self, name: &str) -> Result<()>;
}

pub trait CounterRepository: Send + Sync {
    fn load(&self) -> Result<CounterBook>;
    fn save(&self, book: &CounterBook) -> Result<()>;
}

#[derive(Debug, Clone)]
struct TeardownRetry {
    attempts: u32,
    next_at: Instant,
}

fn teardown_backoff(attempts: u32) -> Duration {
    let seconds = 1u64 << attempts.min(6);
    Duration::from_secs(seconds.min(TEARDOWN_RETRY_MAX_SECS))
}

pub struct ReconcileService {
    awg: Box<dyn AwgControl>,
    shaper: Box<dyn TrafficShaper>,
    forwarding: Box<dyn ForwardingControl>,
    counters: Mutex<CounterBook>,
    counter_repo: Arc<dyn CounterRepository>,
    known: Mutex<HashSet<String>>,
    teardown_retries: Mutex<HashMap<String, TeardownRetry>>,
    last_applied_revision: Mutex<Option<String>>,
    orphans_cleaned: AtomicBool,
}

impl ReconcileService {
    pub fn new(
        awg: Box<dyn AwgControl>,
        shaper: Box<dyn TrafficShaper>,
        forwarding: Box<dyn ForwardingControl>,
        counter_repo: Box<dyn CounterRepository>,
    ) -> anyhow::Result<Self> {
        let counters = match counter_repo.load() {
            Ok(book) => book,
            Err(error) => {
                tracing::error!(%error, "failed to load counters; starting from zero offsets");
                CounterBook::default()
            }
        };
        Ok(Self {
            awg,
            shaper,
            forwarding,
            counters: Mutex::new(counters),
            counter_repo: Arc::from(counter_repo),
            known: Mutex::new(HashSet::new()),
            teardown_retries: Mutex::new(HashMap::new()),
            last_applied_revision: Mutex::new(None),
            orphans_cleaned: AtomicBool::new(false),
        })
    }

    /// Revision of the last successfully applied desired state.
    pub fn applied_revision(&self) -> Option<String> {
        self.last_applied_revision
            .lock()
            .expect("applied revision lock")
            .clone()
    }

    /// Interfaces the worker currently considers managed by itself.
    pub fn known_interfaces(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .known
            .lock()
            .expect("known interfaces lock")
            .iter()
            .cloned()
            .collect();
        names.sort();
        names
    }

    /// Number of kernel counter resets observed since worker start.
    pub fn counter_resets(&self) -> u64 {
        self.counters.lock().expect("counter lock").resets
    }

    pub async fn apply(&self, state: &DesiredState) -> Result<()> {
        // The admin may not generate revisions yet and sends an empty string.
        // Treat that as "always apply": skipping on a repeated empty revision
        // would silently drop every change after the first apply.
        if !state.revision.is_empty()
            && self
                .last_applied_revision
                .lock()
                .expect("applied revision lock")
                .as_deref()
                == Some(state.revision.as_str())
        {
            tracing::debug!(
                revision = %state.revision,
                "desired state revision already applied, skipping"
            );
            return Ok(());
        }

        let mut desired_names = HashSet::new();
        let mut errors: Vec<String> = Vec::new();

        self.cleanup_orphans_once(state, &mut errors).await;

        for interface in &state.interfaces {
            if !interface.enabled {
                continue;
            }
            desired_names.insert(interface.name.clone());
            if let Err(error) = self.apply_one(interface).await {
                errors.push(format!("{}: {error:#}", interface.name));
            }
        }

        let removed: Vec<String> = {
            let known = self.known.lock().expect("known interfaces lock");
            known
                .iter()
                .filter(|name| !desired_names.contains(*name))
                .cloned()
                .collect()
        };
        for name in removed {
            self.teardown_removed(&name, &mut errors).await;
        }

        {
            let mut known = self.known.lock().expect("known interfaces lock");
            for name in desired_names {
                known.insert(name);
            }
        }

        if errors.is_empty() {
            let mut applied = self
                .last_applied_revision
                .lock()
                .expect("applied revision lock");
            if state.revision.is_empty() {
                // An unknown revision says nothing about the applied state, so
                // it must not make a later real revision look "already done".
                *applied = None;
            } else {
                *applied = Some(state.revision.clone());
            }
            Ok(())
        } else {
            anyhow::bail!(errors.join("; "))
        }
    }

    async fn cleanup_orphans_once(&self, state: &DesiredState, errors: &mut Vec<String>) {
        if self.orphans_cleaned.load(Ordering::SeqCst) {
            return;
        }
        // Disabled interfaces must not exist, so only enabled ones are kept.
        let keep: Vec<String> = state
            .interfaces
            .iter()
            .filter(|interface| interface.enabled)
            .map(|interface| interface.name.clone())
            .collect();
        match self.awg.cleanup_orphans(&keep).await {
            Ok(removed) => {
                if !removed.is_empty() {
                    tracing::info!(?removed, "orphaned interfaces removed");
                }
                self.orphans_cleaned.store(true, Ordering::SeqCst);
            }
            Err(error) => errors.push(format!("orphan cleanup: {error:#}")),
        }
    }

    /// Teardown order matters: `ip link del` first, then tc and nft cleanup.
    /// A failed teardown keeps the interface in `known` and is retried with
    /// exponential backoff on the following applies.
    async fn teardown_removed(&self, name: &str, errors: &mut Vec<String>) {
        if let Some(retry) = self
            .teardown_retries
            .lock()
            .expect("teardown retry lock")
            .get(name)
            && retry.next_at > Instant::now()
        {
            tracing::debug!(
                interface = %name,
                attempts = retry.attempts,
                "teardown retry is backing off"
            );
            return;
        }

        if let Err(error) = self.awg.teardown(name).await {
            let attempts = {
                let mut retries = self.teardown_retries.lock().expect("teardown retry lock");
                let attempts = retries.get(name).map(|retry| retry.attempts).unwrap_or(0) + 1;
                let delay = teardown_backoff(attempts);
                retries.insert(
                    name.to_string(),
                    TeardownRetry {
                        attempts,
                        next_at: Instant::now() + delay,
                    },
                );
                attempts
            };
            tracing::warn!(
                interface = %name,
                attempts,
                %error,
                "teardown failed, keeping interface for a retry"
            );
            errors.push(format!(
                "{name}: teardown failed (retry #{attempts}): {error:#}"
            ));
            return;
        }

        self.teardown_retries
            .lock()
            .expect("teardown retry lock")
            .remove(name);

        let mut cleared = true;
        if let Err(error) = self.shaper.clear(name).await {
            errors.push(format!("{name}: tc clear after teardown: {error:#}"));
            cleared = false;
        }
        if let Err(error) = self.forwarding.clear(name).await {
            errors.push(format!("{name}: nft clear after teardown: {error:#}"));
            cleared = false;
        }

        if cleared {
            self.known
                .lock()
                .expect("known interfaces lock")
                .remove(name);
        } else {
            // Keep the name so the (now idempotent) teardown + clear run again.
            tracing::warn!(
                interface = %name,
                "interface removed but cleanup failed, will retry"
            );
        }
    }

    async fn apply_one(&self, interface: &DesiredInterface) -> Result<()> {
        self.awg
            .ensure_interface(interface)
            .await
            .with_context(|| format!("ensure interface {}", interface.name))?;
        self.awg
            .apply_interface(interface)
            .await
            .with_context(|| format!("apply netlink state {}", interface.name))?;
        self.shaper
            .apply(interface)
            .await
            .with_context(|| format!("apply tc {}", interface.name))?;
        self.forwarding
            .apply(interface)
            .await
            .with_context(|| format!("apply forwarding {}", interface.name))?;
        Ok(())
    }

    pub async fn collect(&self, state: &DesiredState) -> Result<StatsReport> {
        let mut reports = Vec::new();
        let mut runtimes = Vec::new();
        for interface in &state.interfaces {
            if !interface.enabled {
                continue;
            }
            match self.awg.read_interface(interface).await {
                Ok(runtime) => runtimes.push((interface, runtime)),
                Err(error) => {
                    tracing::warn!(interface = %interface.name, %error, "failed to read counters");
                }
            }
        }

        let (reports, snapshot) = {
            let mut book = self.counters.lock().expect("counter lock");
            for (interface, runtime) in runtimes {
                let mut peer_reports = Vec::new();
                let mut rx_total = 0u64;
                let mut tx_total = 0u64;
                for peer in &runtime.peers {
                    let Some(desired) = interface
                        .peers
                        .iter()
                        .find(|p| p.public_key == peer.public_key)
                    else {
                        continue;
                    };
                    let key = format!("{}|{}", interface.name, peer.public_key);
                    let (rx, tx) = book.observe(&key, peer.rx_bytes, peer.tx_bytes);
                    rx_total = rx_total.saturating_add(peer.rx_bytes);
                    tx_total = tx_total.saturating_add(peer.tx_bytes);
                    peer_reports.push(PeerReport {
                        peer_id: desired.peer_id,
                        device_id: desired.device_id,
                        public_key: peer.public_key.clone(),
                        rx_total: rx,
                        tx_total: tx,
                        last_handshake: peer.last_handshake,
                    });
                }
                reports.push(InterfaceReport {
                    interface_id: interface.id,
                    rx_total,
                    tx_total,
                    peers: peer_reports,
                });
            }
            let snapshot = book.clone();
            (reports, snapshot)
        };

        let resets = snapshot.resets;
        let repo = self.counter_repo.clone();
        tokio::task::spawn_blocking(move || repo.save(&snapshot))
            .await
            .context("counter save task panicked")??;
        if resets > 0 {
            tracing::debug!(resets, "kernel counter resets observed");
        }

        Ok(StatsReport {
            interfaces: reports,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{DesiredPeer, WireObf};
    use std::sync::Mutex as StdMutex;

    #[derive(Default, Clone)]
    struct Events(Arc<StdMutex<Vec<String>>>);

    impl Events {
        fn push(&self, event: impl Into<String>) {
            self.0.lock().unwrap().push(event.into());
        }

        fn snapshot(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }
    }

    struct FakeAwg {
        events: Events,
        fail_apply: Arc<StdMutex<bool>>,
        fail_teardown: Arc<StdMutex<bool>>,
        existing: Vec<String>,
    }

    #[async_trait]
    impl AwgControl for FakeAwg {
        async fn ensure_interface(&self, interface: &DesiredInterface) -> Result<()> {
            self.events.push(format!("ensure {}", interface.name));
            Ok(())
        }

        async fn apply_interface(&self, interface: &DesiredInterface) -> Result<()> {
            self.events.push(format!("apply {}", interface.name));
            if *self.fail_apply.lock().unwrap() {
                anyhow::bail!("netlink refused");
            }
            Ok(())
        }

        async fn teardown(&self, name: &str) -> Result<()> {
            self.events.push(format!("teardown {name}"));
            if *self.fail_teardown.lock().unwrap() {
                anyhow::bail!("device is busy");
            }
            Ok(())
        }

        async fn read_interface(&self, _interface: &DesiredInterface) -> Result<InterfaceRuntime> {
            Ok(InterfaceRuntime::default())
        }

        async fn list_interfaces(&self) -> Result<Vec<String>> {
            Ok(self.existing.clone())
        }
    }

    struct FakeShaper {
        events: Events,
    }

    #[async_trait]
    impl TrafficShaper for FakeShaper {
        async fn apply(&self, interface: &DesiredInterface) -> Result<()> {
            self.events.push(format!("tc apply {}", interface.name));
            Ok(())
        }

        async fn clear(&self, name: &str) -> Result<()> {
            self.events.push(format!("tc clear {name}"));
            Ok(())
        }
    }

    struct FakeForwarding {
        events: Events,
    }

    #[async_trait]
    impl ForwardingControl for FakeForwarding {
        async fn apply(&self, interface: &DesiredInterface) -> Result<()> {
            self.events.push(format!("nft apply {}", interface.name));
            Ok(())
        }

        async fn clear(&self, name: &str) -> Result<()> {
            self.events.push(format!("nft clear {name}"));
            Ok(())
        }
    }

    struct FakeCounters;

    impl CounterRepository for FakeCounters {
        fn load(&self) -> Result<CounterBook> {
            Ok(CounterBook::default())
        }

        fn save(&self, _book: &CounterBook) -> Result<()> {
            Ok(())
        }
    }

    fn iface(name: &str) -> DesiredInterface {
        DesiredInterface {
            id: Uuid::new_v4(),
            name: name.to_string(),
            listen_port: 51820,
            mtu: 1420,
            private_key: String::new(),
            public_key: String::new(),
            enabled: true,
            obf: WireObf {
                h1: "1".into(),
                h2: "2".into(),
                h3: "3".into(),
                h4: "4".into(),
                s1: 1,
                s2: 2,
                s3: 3,
                s4: 4,
                header_protection_key: String::new(),
                random_trailers: false,
            },
            addresses: vec![],
            peers: vec![DesiredPeer {
                peer_id: Uuid::new_v4(),
                device_id: Uuid::new_v4(),
                user_id: Uuid::new_v4(),
                public_key: "peer".into(),
                preshared_key: String::new(),
                allowed_ips: vec!["10.0.0.2/32".into()],
                addresses: vec![],
                down_kbps: 0,
                up_kbps: 0,
            }],
            group_down_kbps: 0,
            group_up_kbps: 0,
            user_limits: vec![],
            forwarding: vec![],
        }
    }

    fn state(revision: &str, interfaces: Vec<DesiredInterface>) -> DesiredState {
        DesiredState {
            revision: revision.to_string(),
            interfaces,
        }
    }

    struct Harness {
        service: ReconcileService,
        events: Events,
        fail_apply: Arc<StdMutex<bool>>,
        fail_teardown: Arc<StdMutex<bool>>,
    }

    fn harness(existing: Vec<String>) -> Harness {
        let events = Events::default();
        let fail_apply = Arc::new(StdMutex::new(false));
        let fail_teardown = Arc::new(StdMutex::new(false));
        let service = ReconcileService::new(
            Box::new(FakeAwg {
                events: events.clone(),
                fail_apply: Arc::clone(&fail_apply),
                fail_teardown: Arc::clone(&fail_teardown),
                existing,
            }),
            Box::new(FakeShaper {
                events: events.clone(),
            }),
            Box::new(FakeForwarding {
                events: events.clone(),
            }),
            Box::new(FakeCounters),
        )
        .expect("service");
        Harness {
            service,
            events,
            fail_apply,
            fail_teardown,
        }
    }

    #[tokio::test]
    async fn identical_revision_is_not_applied_twice() {
        let harness = harness(Vec::new());
        let desired = state("rev-1", vec![iface("awg0")]);

        harness.service.apply(&desired).await.expect("first apply");
        assert_eq!(harness.service.applied_revision().as_deref(), Some("rev-1"));
        let after_first = harness.events.snapshot();

        harness.service.apply(&desired).await.expect("second apply");
        assert_eq!(
            harness.events.snapshot(),
            after_first,
            "no-op revision must not touch the dataplane"
        );
    }

    #[tokio::test]
    async fn empty_revision_is_applied_every_time() {
        let harness = harness(Vec::new());
        let desired = state("", vec![iface("awg0")]);

        harness.service.apply(&desired).await.expect("first apply");
        harness.service.apply(&desired).await.expect("second apply");

        assert_eq!(
            harness
                .events
                .snapshot()
                .iter()
                .filter(|event| event.starts_with("apply awg0"))
                .count(),
            2,
            "an empty revision must never be treated as already applied"
        );
        assert_eq!(
            harness.service.applied_revision(),
            None,
            "an unknown revision must not be remembered"
        );
    }

    #[tokio::test]
    async fn changed_revision_is_applied_again() {
        let harness = harness(Vec::new());
        harness
            .service
            .apply(&state("rev-1", vec![iface("awg0")]))
            .await
            .expect("first apply");
        harness
            .service
            .apply(&state("rev-2", vec![iface("awg0")]))
            .await
            .expect("second apply");
        assert_eq!(harness.service.applied_revision().as_deref(), Some("rev-2"));
        assert_eq!(
            harness
                .events
                .snapshot()
                .iter()
                .filter(|event| event.starts_with("apply awg0"))
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn failed_apply_does_not_record_the_revision() {
        let harness = harness(Vec::new());
        *harness.fail_apply.lock().unwrap() = true;
        let desired = state("rev-1", vec![iface("awg0")]);
        assert!(harness.service.apply(&desired).await.is_err());
        assert_eq!(harness.service.applied_revision(), None);

        *harness.fail_apply.lock().unwrap() = false;
        harness.service.apply(&desired).await.expect("retry");
        assert_eq!(harness.service.applied_revision().as_deref(), Some("rev-1"));
    }

    #[tokio::test]
    async fn removed_interface_is_torn_down_before_cleanup() {
        let harness = harness(Vec::new());
        harness
            .service
            .apply(&state("rev-1", vec![iface("awg0")]))
            .await
            .expect("create");
        harness
            .service
            .apply(&state("rev-2", Vec::new()))
            .await
            .expect("remove");

        let events = harness.events.snapshot();
        let teardown = events
            .iter()
            .position(|event| event == "teardown awg0")
            .expect("teardown recorded");
        let tc_clear = events
            .iter()
            .position(|event| event == "tc clear awg0")
            .expect("tc clear recorded");
        let nft_clear = events
            .iter()
            .position(|event| event == "nft clear awg0")
            .expect("nft clear recorded");
        assert!(teardown < tc_clear, "teardown must run before tc clear");
        assert!(tc_clear < nft_clear, "tc clear must run before nft clear");
        assert!(harness.service.known_interfaces().is_empty());
    }

    #[tokio::test]
    async fn failed_teardown_keeps_the_interface_known() {
        let harness = harness(Vec::new());
        harness
            .service
            .apply(&state("rev-1", vec![iface("awg0")]))
            .await
            .expect("create");
        *harness.fail_teardown.lock().unwrap() = true;

        let error = harness
            .service
            .apply(&state("rev-2", Vec::new()))
            .await
            .expect_err("teardown must fail the apply");
        assert!(
            format!("{error:#}").contains("teardown failed"),
            "{error:#}"
        );
        assert_eq!(harness.service.known_interfaces(), vec!["awg0"]);
        assert!(
            !harness
                .events
                .snapshot()
                .iter()
                .any(|event| event == "tc clear awg0"),
            "tc cleanup must wait for a successful teardown"
        );
    }

    #[tokio::test]
    async fn orphan_interfaces_are_removed_on_the_first_apply_only() {
        let harness = harness(vec!["awg0".to_string(), "stale0".to_string()]);
        harness
            .service
            .apply(&state("rev-1", vec![iface("awg0")]))
            .await
            .expect("first apply");
        assert!(
            harness
                .events
                .snapshot()
                .contains(&"teardown stale0".to_string())
        );

        harness
            .service
            .apply(&state("rev-2", vec![iface("awg0")]))
            .await
            .expect("second apply");
        assert_eq!(
            harness
                .events
                .snapshot()
                .iter()
                .filter(|event| *event == "teardown stale0")
                .count(),
            1,
            "orphan cleanup must not run again"
        );
    }

    #[test]
    fn teardown_backoff_is_capped() {
        assert_eq!(teardown_backoff(0), Duration::from_secs(1));
        assert_eq!(teardown_backoff(3), Duration::from_secs(8));
        assert_eq!(teardown_backoff(6), Duration::from_secs(60));
        assert_eq!(teardown_backoff(30), Duration::from_secs(60));
    }
}
