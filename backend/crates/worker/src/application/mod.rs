use std::collections::HashSet;
use std::sync::Mutex;

use anyhow::{Context, Result};
use async_trait::async_trait;
use uuid::Uuid;

use crate::domain::{CounterBook, DesiredInterface, DesiredState, InterfaceRuntime};

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

pub struct ReconcileService {
    awg: Box<dyn AwgControl>,
    shaper: Box<dyn TrafficShaper>,
    forwarding: Box<dyn ForwardingControl>,
    counters: Mutex<CounterBook>,
    counter_repo: Box<dyn CounterRepository>,
    known: Mutex<HashSet<String>>,
}

impl ReconcileService {
    pub fn new(
        awg: Box<dyn AwgControl>,
        shaper: Box<dyn TrafficShaper>,
        forwarding: Box<dyn ForwardingControl>,
        counter_repo: Box<dyn CounterRepository>,
    ) -> anyhow::Result<Self> {
        let counters = counter_repo.load().unwrap_or_default();
        Ok(Self {
            awg,
            shaper,
            forwarding,
            counters: Mutex::new(counters),
            counter_repo,
            known: Mutex::new(HashSet::new()),
        })
    }

    pub async fn apply(&self, state: &DesiredState) -> Result<()> {
        let mut desired_names = HashSet::new();
        let mut errors: Vec<String> = Vec::new();

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
            let _ = self.shaper.clear(&name).await;
            let _ = self.forwarding.clear(&name).await;
            let _ = self.awg.teardown(&name).await;
            self.known
                .lock()
                .expect("known interfaces lock")
                .remove(&name);
        }

        {
            let mut known = self.known.lock().expect("known interfaces lock");
            for name in desired_names {
                known.insert(name);
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            anyhow::bail!(errors.join("; "))
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

        {
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
            self.counter_repo.save(&book)?;
        }

        Ok(StatsReport {
            interfaces: reports,
        })
    }
}
