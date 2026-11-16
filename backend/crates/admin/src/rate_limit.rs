use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct WindowState {
    hits: HashMap<String, VecDeque<Instant>>,
    last_cleanup: Option<Instant>,
}

pub struct SlidingWindowLimiter {
    limit: u32,
    window: Duration,
    state: Mutex<WindowState>,
}

impl SlidingWindowLimiter {
    pub fn new(limit: u32, window: Duration) -> Self {
        Self {
            limit,
            window,
            state: Mutex::new(WindowState {
                hits: HashMap::new(),
                last_cleanup: None,
            }),
        }
    }

    pub fn check(&self, key: &str) -> Result<(), u64> {
        self.check_at(key, Instant::now())
    }

    pub fn reset(&self, key: &str) {
        let mut state = self.lock();
        state.hits.remove(key);
    }

    pub fn cleanup(&self) {
        self.cleanup_now(Instant::now());
    }

    fn check_at(&self, key: &str, now: Instant) -> Result<(), u64> {
        if self.limit == 0 {
            return Ok(());
        }
        let mut state = self.lock();
        self.cleanup_locked(&mut state, now);
        let hits = state.hits.entry(key.to_string()).or_default();
        while let Some(front) = hits.front() {
            if now.saturating_duration_since(*front) >= self.window {
                hits.pop_front();
            } else {
                break;
            }
        }
        if hits.len() as u32 >= self.limit {
            let retry_after = hits
                .front()
                .map(|front| {
                    self.window
                        .saturating_sub(now.saturating_duration_since(*front))
                        .as_secs()
                        + 1
                })
                .unwrap_or(1);
            return Err(retry_after.max(1));
        }
        hits.push_back(now);
        Ok(())
    }

    fn cleanup_now(&self, now: Instant) {
        let mut state = self.lock();
        self.cleanup_locked(&mut state, now);
    }

    #[cfg(test)]
    fn cleanup_at(&self, now: Instant) {
        self.cleanup_now(now);
    }

    fn cleanup_locked(&self, state: &mut WindowState, now: Instant) {
        let due = match state.last_cleanup {
            Some(last) => now.saturating_duration_since(last) >= self.window,
            None => true,
        };
        if !due {
            return;
        }
        state.hits.retain(|_, hits| {
            while let Some(front) = hits.front() {
                if now.saturating_duration_since(*front) >= self.window {
                    hits.pop_front();
                } else {
                    break;
                }
            }
            !hits.is_empty()
        });
        state.last_cleanup = Some(now);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, WindowState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limiter(limit: u32, window_secs: u64) -> SlidingWindowLimiter {
        SlidingWindowLimiter::new(limit, Duration::from_secs(window_secs))
    }

    #[test]
    fn allows_up_to_limit_then_rejects_with_retry_after() {
        let limiter = limiter(3, 60);
        let now = Instant::now();
        assert!(limiter.check_at("ip:login", now).is_ok());
        assert!(
            limiter
                .check_at("ip:login", now + Duration::from_secs(1))
                .is_ok()
        );
        assert!(
            limiter
                .check_at("ip:login", now + Duration::from_secs(2))
                .is_ok()
        );

        let retry = limiter
            .check_at("ip:login", now + Duration::from_secs(3))
            .unwrap_err();
        assert!((58..=60).contains(&retry), "retry_after was {retry}");
    }

    #[test]
    fn window_slides_and_resets_after_expiry() {
        let limiter = limiter(2, 10);
        let now = Instant::now();
        assert!(limiter.check_at("key", now).is_ok());
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(5))
                .is_ok()
        );
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(9))
                .is_err()
        );
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(10))
                .is_ok()
        );
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(11))
                .is_err()
        );
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(16))
                .is_ok()
        );
    }

    #[test]
    fn keys_are_independent() {
        let limiter = limiter(1, 30);
        let now = Instant::now();
        assert!(limiter.check_at("a", now).is_ok());
        assert!(limiter.check_at("b", now).is_ok());
        assert!(limiter.check_at("a", now + Duration::from_secs(1)).is_err());
    }

    #[test]
    fn reset_clears_counter() {
        let limiter = limiter(1, 30);
        let now = Instant::now();
        assert!(limiter.check_at("key", now).is_ok());
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(1))
                .is_err()
        );
        limiter.reset("key");
        assert!(
            limiter
                .check_at("key", now + Duration::from_secs(2))
                .is_ok()
        );
    }

    #[test]
    fn zero_limit_disables_limiting() {
        let limiter = limiter(0, 30);
        let now = Instant::now();
        for second in 0..100 {
            assert!(
                limiter
                    .check_at("key", now + Duration::from_secs(second))
                    .is_ok()
            );
        }
    }

    #[test]
    fn cleanup_drops_expired_keys() {
        let limiter = limiter(5, 10);
        let now = Instant::now();
        assert!(limiter.check_at("old", now).is_ok());
        assert!(
            limiter
                .check_at("fresh", now + Duration::from_secs(9))
                .is_ok()
        );

        limiter.cleanup_at(now + Duration::from_secs(20));
        let state = limiter.lock();
        assert!(!state.hits.contains_key("old"));
        assert!(!state.hits.contains_key("fresh"));
        assert!(state.hits.is_empty());
    }
}
