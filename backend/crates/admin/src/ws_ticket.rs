use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use awg_shared::crypto::random_bytes;
use awg_statistics::StatsScope;
use uuid::Uuid;

/// Short-lived, single-use tickets for the statistics WebSocket. Keeping the
/// access token out of the query string prevents it from leaking through
/// access logs, proxies and browser history.
pub const WS_TICKET_TTL_SECS: u64 = 30;

/// Hard bound on the in-memory ticket map. Expired tickets are swept on every
/// issue; if the map is still full the oldest entries are evicted.
const MAX_TICKETS: usize = 10_000;

#[derive(Debug, Clone, Copy)]
struct TicketEntry {
    user_id: Uuid,
    scope: StatsScope,
    expires_at: Instant,
}

pub struct WsTicketStore {
    tickets: Mutex<HashMap<String, TicketEntry>>,
}

impl WsTicketStore {
    pub fn new() -> Self {
        Self {
            tickets: Mutex::new(HashMap::new()),
        }
    }

    /// Issues a single-use ticket bound to `user_id` and `scope`.
    pub fn issue(&self, user_id: Uuid, scope: StatsScope) -> (String, u64) {
        self.issue_with_ttl(user_id, scope, Duration::from_secs(WS_TICKET_TTL_SECS))
    }

    fn issue_with_ttl(&self, user_id: Uuid, scope: StatsScope, ttl: Duration) -> (String, u64) {
        let now = Instant::now();
        let mut tickets = self.lock();
        tickets.retain(|_, entry| entry.expires_at > now);
        while tickets.len() >= MAX_TICKETS {
            let Some(key) = tickets.keys().next().cloned() else {
                break;
            };
            tickets.remove(&key);
        }

        let ticket = hex(&random_bytes::<32>());
        tickets.insert(
            ticket.clone(),
            TicketEntry {
                user_id,
                scope,
                expires_at: now + ttl,
            },
        );
        (ticket, ttl.as_secs())
    }

    /// Consumes a ticket. A ticket can be redeemed only once, even if it has
    /// not expired yet. Expired tickets are rejected and removed.
    pub fn consume(&self, ticket: &str) -> Option<(Uuid, StatsScope)> {
        let now = Instant::now();
        let mut tickets = self.lock();
        let entry = tickets.remove(ticket)?;
        if entry.expires_at <= now {
            return None;
        }
        Some((entry.user_id, entry.scope))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, TicketEntry>> {
        self.tickets
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

impl Default for WsTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticket_can_be_consumed_exactly_once() {
        let store = WsTicketStore::new();
        let user = Uuid::new_v4();
        let (ticket, expires_in) = store.issue(user, StatsScope::Global);

        assert_eq!(ticket.len(), 64);
        assert!(ticket.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(expires_in, WS_TICKET_TTL_SECS);
        assert_eq!(store.consume(&ticket), Some((user, StatsScope::Global)));
        assert_eq!(store.consume(&ticket), None, "tickets are single-use");
    }

    #[test]
    fn expired_ticket_is_rejected() {
        let store = WsTicketStore::new();
        let user = Uuid::new_v4();
        let scope = StatsScope::User(user);
        let (ticket, _) = store.issue_with_ttl(user, scope, Duration::from_millis(1));

        std::thread::sleep(Duration::from_millis(5));

        assert_eq!(store.consume(&ticket), None);
        assert!(store.lock().is_empty(), "an expired ticket is removed");
    }

    #[test]
    fn issued_tickets_are_independent_and_unique() {
        let store = WsTicketStore::new();
        let user = Uuid::new_v4();
        let other = Uuid::new_v4();
        let (first, _) = store.issue(user, StatsScope::Global);
        let (second, _) = store.issue(other, StatsScope::User(other));

        assert_ne!(first, second);
        assert_eq!(store.consume(&first), Some((user, StatsScope::Global)));
        assert_eq!(
            store.consume(&second),
            Some((other, StatsScope::User(other)))
        );
    }

    #[test]
    fn expired_tickets_are_swept_on_issue() {
        let store = WsTicketStore::new();
        let user = Uuid::new_v4();
        let (expired, _) = store.issue_with_ttl(user, StatsScope::Global, Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(5));

        let (_fresh, _) = store.issue(user, StatsScope::Global);

        assert_eq!(store.lock().len(), 1);
        assert_eq!(store.consume(&expired), None);
    }
}
