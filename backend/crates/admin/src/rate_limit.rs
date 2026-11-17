use std::collections::{HashMap, VecDeque};
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use awg_storage::{Store, Table};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub trait RateLimiter: Send + Sync {
    fn check(&self, key: &str, limit: u32, window: Duration) -> Result<(), u64>;
    fn reset(&self, key: &str);
    fn cleanup(&self);
}

struct MemoryEntry {
    hits: VecDeque<Instant>,
    window: Duration,
}

struct MemoryState {
    entries: HashMap<String, MemoryEntry>,
    last_cleanup: Option<Instant>,
}

pub struct MemoryRateLimiter {
    state: Mutex<MemoryState>,
}

impl MemoryRateLimiter {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(MemoryState {
                entries: HashMap::new(),
                last_cleanup: None,
            }),
        }
    }

    fn check_at(&self, key: &str, limit: u32, window: Duration, now: Instant) -> Result<(), u64> {
        if limit == 0 {
            return Ok(());
        }
        let window = window.max(Duration::from_secs(1));
        let mut state = self.lock();
        self.cleanup_locked(&mut state, now, false);
        let entry = state
            .entries
            .entry(key.to_string())
            .or_insert_with(|| MemoryEntry {
                hits: VecDeque::new(),
                window,
            });
        entry.window = window;
        while let Some(front) = entry.hits.front() {
            if now.saturating_duration_since(*front) >= window {
                entry.hits.pop_front();
            } else {
                break;
            }
        }
        if entry.hits.len() as u32 >= limit {
            let retry_after = entry
                .hits
                .front()
                .map(|front| {
                    window
                        .saturating_sub(now.saturating_duration_since(*front))
                        .as_secs()
                        + 1
                })
                .unwrap_or(1);
            return Err(retry_after.max(1));
        }
        entry.hits.push_back(now);
        Ok(())
    }

    fn cleanup_now(&self, now: Instant) {
        let mut state = self.lock();
        self.cleanup_locked(&mut state, now, true);
    }

    fn cleanup_locked(&self, state: &mut MemoryState, now: Instant, force: bool) {
        let due = force
            || match state.last_cleanup {
                Some(last) => now.saturating_duration_since(last) >= Duration::from_secs(60),
                None => true,
            };
        if !due {
            return;
        }
        state.entries.retain(|_, entry| {
            while let Some(front) = entry.hits.front() {
                if now.saturating_duration_since(*front) >= entry.window {
                    entry.hits.pop_front();
                } else {
                    break;
                }
            }
            !entry.hits.is_empty()
        });
        state.last_cleanup = Some(now);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MemoryState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

impl Default for MemoryRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter for MemoryRateLimiter {
    fn check(&self, key: &str, limit: u32, window: Duration) -> Result<(), u64> {
        self.check_at(key, limit, window, Instant::now())
    }

    fn reset(&self, key: &str) {
        let mut state = self.lock();
        state.entries.remove(key);
    }

    fn cleanup(&self) {
        self.cleanup_now(Instant::now());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RateLimitRecord {
    hits: Vec<u64>,
    window_secs: u64,
    updated_at: u64,
}

pub struct StoreRateLimiter {
    store: Arc<Store>,
}

impl StoreRateLimiter {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    fn check_at(&self, key: &str, limit: u32, window: Duration, now: u64) -> Result<(), u64> {
        if limit == 0 {
            return Ok(());
        }
        let window_secs = window.as_secs().max(1);
        let outcome = self
            .store
            .update::<RateLimitRecord, _>(Table::RateLimits, key, |current| {
                let mut record = current.unwrap_or(RateLimitRecord {
                    hits: Vec::new(),
                    window_secs,
                    updated_at: now,
                });
                record.window_secs = window_secs;
                record
                    .hits
                    .retain(|hit| now.saturating_sub(*hit) < window_secs);
                if record.hits.len() as u32 >= limit {
                    let oldest = record.hits[0];
                    let retry_after = window_secs
                        .saturating_sub(now.saturating_sub(oldest))
                        .saturating_add(1)
                        .max(1);
                    return (Some(record), Err(retry_after));
                }
                record.hits.push(now);
                record.updated_at = now;
                (Some(record), Ok(()))
            });
        match outcome {
            Ok(result) => result,
            Err(error) => {
                tracing::error!(%error, key, "failed to update the shared rate limiter");
                Err(window_secs)
            }
        }
    }

    fn cleanup_at(&self, now: u64) -> usize {
        match self
            .store
            .retain::<RateLimitRecord>(Table::RateLimits, |_, record| {
                let last_hit = record
                    .updated_at
                    .max(record.hits.last().copied().unwrap_or(0));
                now.saturating_sub(last_hit) < record.window_secs.max(1)
            }) {
            Ok(removed) => removed,
            Err(error) => {
                tracing::warn!(%error, "failed to clean up shared rate limit entries");
                0
            }
        }
    }
}

impl RateLimiter for StoreRateLimiter {
    fn check(&self, key: &str, limit: u32, window: Duration) -> Result<(), u64> {
        self.check_at(key, limit, window, unix_now())
    }

    fn reset(&self, key: &str) {
        if let Err(error) = self.store.delete(Table::RateLimits, key) {
            tracing::warn!(%error, key, "failed to reset a shared rate limit entry");
        }
    }

    fn cleanup(&self) {
        let removed = self.cleanup_at(unix_now());
        if removed > 0 {
            tracing::info!(removed, "expired shared rate limit entries removed");
        }
    }
}

#[derive(Clone)]
pub struct RateLimitScope {
    limiter: Arc<dyn RateLimiter>,
    prefix: &'static str,
    limit: u32,
    window: Duration,
}

impl RateLimitScope {
    pub fn new(
        limiter: Arc<dyn RateLimiter>,
        prefix: &'static str,
        limit: u32,
        window: Duration,
    ) -> Self {
        Self {
            limiter,
            prefix,
            limit,
            window,
        }
    }

    pub fn check(&self, key: &str) -> Result<(), u64> {
        self.limiter
            .check(&scoped_key(self.prefix, key), self.limit, self.window)
    }

    pub fn reset(&self, key: &str) {
        self.limiter.reset(&scoped_key(self.prefix, key));
    }
}

fn scoped_key(scope: &str, key: &str) -> String {
    format!("{scope}:{}", hash_key(key))
}

fn hash_key(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> MemoryRateLimiter {
        MemoryRateLimiter::new()
    }

    fn store_backend() -> Arc<Store> {
        Arc::new(Store::open_in_memory().unwrap())
    }

    fn records(store: &Store) -> Vec<(String, RateLimitRecord)> {
        store
            .list_prefix::<RateLimitRecord>(Table::RateLimits, "")
            .unwrap()
    }

    #[test]
    fn memory_allows_up_to_limit_then_rejects_with_retry_after() {
        let limiter = memory();
        let window = Duration::from_secs(60);
        let now = Instant::now();
        assert!(limiter.check_at("ip:login", 3, window, now).is_ok());
        assert!(
            limiter
                .check_at("ip:login", 3, window, now + Duration::from_secs(1))
                .is_ok()
        );
        assert!(
            limiter
                .check_at("ip:login", 3, window, now + Duration::from_secs(2))
                .is_ok()
        );

        let retry = limiter
            .check_at("ip:login", 3, window, now + Duration::from_secs(3))
            .unwrap_err();
        assert!((58..=60).contains(&retry), "retry_after was {retry}");
    }

    #[test]
    fn memory_window_slides_and_resets_after_expiry() {
        let limiter = memory();
        let window = Duration::from_secs(10);
        let now = Instant::now();
        assert!(limiter.check_at("key", 2, window, now).is_ok());
        assert!(
            limiter
                .check_at("key", 2, window, now + Duration::from_secs(5))
                .is_ok()
        );
        assert!(
            limiter
                .check_at("key", 2, window, now + Duration::from_secs(9))
                .is_err()
        );
        assert!(
            limiter
                .check_at("key", 2, window, now + Duration::from_secs(10))
                .is_ok()
        );
        assert!(
            limiter
                .check_at("key", 2, window, now + Duration::from_secs(11))
                .is_err()
        );
        assert!(
            limiter
                .check_at("key", 2, window, now + Duration::from_secs(16))
                .is_ok()
        );
    }

    #[test]
    fn memory_keys_are_independent() {
        let limiter = memory();
        let window = Duration::from_secs(30);
        let now = Instant::now();
        assert!(limiter.check_at("a", 1, window, now).is_ok());
        assert!(limiter.check_at("b", 1, window, now).is_ok());
        assert!(
            limiter
                .check_at("a", 1, window, now + Duration::from_secs(1))
                .is_err()
        );
    }

    #[test]
    fn memory_reset_clears_counter() {
        let limiter = memory();
        let window = Duration::from_secs(30);
        let now = Instant::now();
        assert!(limiter.check_at("key", 1, window, now).is_ok());
        assert!(
            limiter
                .check_at("key", 1, window, now + Duration::from_secs(1))
                .is_err()
        );
        limiter.reset("key");
        assert!(
            limiter
                .check_at("key", 1, window, now + Duration::from_secs(2))
                .is_ok()
        );
    }

    #[test]
    fn memory_zero_limit_disables_limiting() {
        let limiter = memory();
        let window = Duration::from_secs(30);
        let now = Instant::now();
        for second in 0..100 {
            assert!(
                limiter
                    .check_at("key", 0, window, now + Duration::from_secs(second))
                    .is_ok()
            );
        }
    }

    #[test]
    fn memory_cleanup_drops_expired_keys() {
        let limiter = memory();
        let window = Duration::from_secs(10);
        let now = Instant::now();
        assert!(limiter.check_at("old", 5, window, now).is_ok());
        assert!(
            limiter
                .check_at("fresh", 5, window, now + Duration::from_secs(9))
                .is_ok()
        );

        limiter.cleanup_now(now + Duration::from_secs(20));
        let state = limiter.lock();
        assert!(!state.entries.contains_key("old"));
        assert!(!state.entries.contains_key("fresh"));
        assert!(state.entries.is_empty());
    }

    #[test]
    fn store_replicas_share_the_same_counter() {
        let store = store_backend();
        let replica_a = StoreRateLimiter::new(store.clone());
        let replica_b = StoreRateLimiter::new(store.clone());
        let window = Duration::from_secs(60);

        assert!(replica_a.check_at("login:ip", 2, window, 100).is_ok());
        assert!(replica_b.check_at("login:ip", 2, window, 101).is_ok());
        assert!(replica_a.check_at("login:ip", 2, window, 102).is_err());
        assert!(replica_b.check_at("login:ip", 2, window, 103).is_err());
    }

    #[test]
    fn store_window_slides_and_resets_after_expiry() {
        let store = store_backend();
        let limiter = StoreRateLimiter::new(store);
        let window = Duration::from_secs(10);

        assert!(limiter.check_at("key", 2, window, 100).is_ok());
        assert!(limiter.check_at("key", 2, window, 105).is_ok());
        assert_eq!(limiter.check_at("key", 2, window, 109), Err(2));
        assert!(limiter.check_at("key", 2, window, 110).is_ok());
        assert!(limiter.check_at("key", 2, window, 111).is_err());
        assert!(limiter.check_at("key", 2, window, 116).is_ok());
    }

    #[test]
    fn store_reset_clears_counter() {
        let store = store_backend();
        let limiter = StoreRateLimiter::new(store.clone());
        let window = Duration::from_secs(30);

        assert!(limiter.check_at("key", 1, window, 100).is_ok());
        assert!(limiter.check_at("key", 1, window, 101).is_err());
        limiter.reset("key");
        assert_eq!(records(&store).len(), 0);
        assert!(limiter.check_at("key", 1, window, 102).is_ok());
    }

    #[test]
    fn store_zero_limit_disables_limiting_and_stores_nothing() {
        let store = store_backend();
        let limiter = StoreRateLimiter::new(store.clone());
        let window = Duration::from_secs(30);

        for second in 0..100 {
            assert!(limiter.check_at("key", 0, window, 100 + second).is_ok());
        }
        assert_eq!(records(&store).len(), 0);
    }

    #[test]
    fn store_cleanup_removes_only_expired_entries() {
        let store = store_backend();
        let limiter = StoreRateLimiter::new(store.clone());
        let window = Duration::from_secs(10);

        assert!(limiter.check_at("old", 5, window, 100).is_ok());
        assert!(limiter.check_at("fresh", 5, window, 106).is_ok());
        assert!(
            limiter
                .check_at("short", 5, Duration::from_secs(3), 110)
                .is_ok()
        );

        assert_eq!(limiter.cleanup_at(115), 2);
        let keys: Vec<String> = records(&store).into_iter().map(|(key, _)| key).collect();
        assert!(keys.contains(&"fresh".to_string()));
        assert!(!keys.contains(&"short".to_string()));
        assert!(!keys.contains(&"old".to_string()));

        assert_eq!(limiter.cleanup_at(200), 1);
        assert!(records(&store).is_empty());
    }

    #[test]
    fn store_parallel_checks_never_exceed_the_limit() {
        let store = store_backend();
        let limiter = Arc::new(StoreRateLimiter::new(store));
        let window = Duration::from_secs(60);

        let handles: Vec<_> = (0..20)
            .map(|_| {
                let limiter = limiter.clone();
                std::thread::spawn(move || limiter.check_at("key", 5, window, 100).is_ok())
            })
            .collect();
        let allowed = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(|allowed| *allowed)
            .count();

        assert_eq!(allowed, 5);
    }

    #[test]
    fn store_never_keeps_more_hits_than_the_limit() {
        let store = store_backend();
        let limiter = StoreRateLimiter::new(store.clone());
        let window = Duration::from_secs(60);

        assert!(limiter.check_at("key", 3, window, 100).is_ok());
        assert!(limiter.check_at("key", 3, window, 101).is_ok());
        assert!(limiter.check_at("key", 3, window, 102).is_ok());
        assert!(limiter.check_at("key", 3, window, 103).is_err());

        let records = records(&store);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].1.hits, vec![100, 101, 102]);
        assert_eq!(records[0].1.window_secs, 60);
    }

    #[test]
    fn scoped_keys_use_scope_and_hashed_key() {
        let first = scoped_key("login", "10.0.0.1:alice");
        let second = scoped_key("login", "10.0.0.1:alice");
        let other_scope = scoped_key("refresh", "10.0.0.1:alice");
        let other_key = scoped_key("login", "10.0.0.1:bob");

        assert_eq!(first, second);
        assert_ne!(first, other_scope);
        assert_ne!(first, other_key);
        assert!(first.starts_with("login:"));
        assert!(!first.contains("alice"));
        assert_eq!(first.len(), "login:".len() + 64);
    }

    #[test]
    fn scope_applies_configured_limit_and_window() {
        let store = store_backend();
        let backend: Arc<dyn RateLimiter> = Arc::new(StoreRateLimiter::new(store.clone()));
        let scope = RateLimitScope::new(backend, "login", 2, Duration::from_secs(10));

        assert!(scope.check("client").is_ok());
        assert!(scope.check("client").is_ok());
        assert!(scope.check("client").is_err());
        scope.reset("client");
        assert!(scope.check("client").is_ok());
    }
}
