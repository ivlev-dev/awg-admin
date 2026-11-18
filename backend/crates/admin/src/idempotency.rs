use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::{Body, HttpBody as _, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use uuid::Uuid;

use awg_shared::crypto::Sealer;
use awg_shared::{CoreError, CoreResult};
use awg_storage::{StorageError, Store, Table};

use crate::error::ApiError;
use crate::state::AppState;

pub const IDEMPOTENCY_HEADER: &str = "idempotency-key";
pub const IDEMPOTENCY_TTL_SECS: i64 = 86_400;
pub const IDEMPOTENCY_PROCESSING_TTL_SECS: i64 = 300;
pub const IDEMPOTENCY_KEY_MIN_LEN: usize = 8;
pub const IDEMPOTENCY_KEY_MAX_LEN: usize = 128;

const API_PREFIX: &str = "/api/v1/";
const EXCLUDED_PREFIXES: [&str; 2] = ["/api/v1/auth/", "/api/v1/billing/webhook/"];
const EXCLUDED_PATHS: [&str; 1] = ["/api/v1/app/devices"];
const MAX_CACHED_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024 * 1024;
const JSON_CONTENT_TYPE: &str = "application/json";
const ANONYMOUS_SCOPE: &str = "anon";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdempotencyState {
    Processing,
    #[default]
    Ready,
}

/// Persisted form of a cached response. The body is always sealed with the
/// master key, so the redb table never holds response payloads in plaintext.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IdempotencyRecord {
    pub status: u16,
    #[serde(default)]
    pub body_sealed: String,
    #[serde(default)]
    pub content_type: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    #[serde(default)]
    pub state: IdempotencyState,
    #[serde(default)]
    pub fingerprint: String,
}

impl IdempotencyRecord {
    pub fn new(status: u16, body_sealed: String, content_type: Option<String>) -> Self {
        let created_at = Utc::now().timestamp();
        Self {
            status,
            body_sealed,
            content_type,
            created_at,
            expires_at: created_at + IDEMPOTENCY_TTL_SECS,
            state: IdempotencyState::Ready,
            fingerprint: String::new(),
        }
    }

    fn processing(fingerprint: &str) -> Self {
        let created_at = Utc::now().timestamp();
        Self {
            status: 0,
            body_sealed: String::new(),
            content_type: None,
            created_at,
            expires_at: created_at + IDEMPOTENCY_TTL_SECS,
            state: IdempotencyState::Processing,
            fingerprint: fingerprint.to_string(),
        }
    }

    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at <= now
    }

    pub fn is_stale_processing(&self, now: i64) -> bool {
        self.state == IdempotencyState::Processing
            && self.created_at + IDEMPOTENCY_PROCESSING_TTL_SECS <= now
    }

    fn is_ready(&self) -> bool {
        self.state == IdempotencyState::Ready && !self.body_sealed.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum BeginOutcome {
    Started,
    Ready(IdempotentResponse),
    InFlight,
    FingerprintMismatch,
}

/// Decrypted view of a cached response, ready to be replayed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IdempotentResponse {
    pub status: u16,
    pub body: Value,
    pub content_type: Option<String>,
}

impl IdempotentResponse {
    pub fn new(status: u16, body: Value, content_type: Option<String>) -> Self {
        Self {
            status,
            body,
            content_type,
        }
    }
}

impl IntoResponse for IdempotentResponse {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::OK);
        let body = serde_json::to_vec(&self.body).unwrap_or_else(|_| b"null".to_vec());
        let content_type = self
            .content_type
            .unwrap_or_else(|| JSON_CONTENT_TYPE.to_string());
        let mut response = Response::new(Body::from(body));
        *response.status_mut() = status;
        if let Ok(value) = HeaderValue::from_str(&content_type) {
            response.headers_mut().insert(header::CONTENT_TYPE, value);
        }
        response
    }
}

pub struct IdempotencyStore {
    store: Arc<Store>,
    sealer: Arc<Sealer>,
    locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl IdempotencyStore {
    pub fn new(store: Arc<Store>, sealer: Arc<Sealer>) -> Self {
        Self {
            store,
            sealer,
            locks: Mutex::new(HashMap::new()),
        }
    }

    /// Takes the per-key lock so that requests with the same idempotency key
    /// are serialized while different keys proceed in parallel. Idle entries
    /// are dropped lazily: an entry with no waiters has a single strong
    /// reference and is removed on the next acquisition.
    pub async fn lock(&self, key: &str) -> OwnedMutexGuard<()> {
        let mutex = {
            let mut locks = self.locks.lock().unwrap_or_else(|error| error.into_inner());
            locks.retain(|existing, mutex| existing == key || Arc::strong_count(mutex) > 1);
            locks
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        mutex.lock_owned().await
    }

    #[cfg(test)]
    fn tracked_locks(&self) -> usize {
        self.locks
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }

    pub fn prune_expired(&self, now: i64) -> CoreResult<usize> {
        self.store
            .retain::<IdempotencyRecord>(Table::Idempotency, |_, record| !record.is_expired(now))
            .map_err(map_err)
    }

    pub fn get(&self, key: &str) -> CoreResult<Option<IdempotentResponse>> {
        let Some(record) = self
            .store
            .get::<IdempotencyRecord>(Table::Idempotency, key)
            .map_err(map_err)?
        else {
            return Ok(None);
        };
        if record.is_expired(Utc::now().timestamp()) {
            self.store
                .delete(Table::Idempotency, key)
                .map_err(map_err)?;
            return Ok(None);
        }
        if !record.is_ready() {
            return Ok(None);
        }
        self.decode(record).map(Some)
    }

    pub fn begin(&self, key: &str, fingerprint: &str) -> CoreResult<BeginOutcome> {
        enum State {
            Started,
            Ready(IdempotencyRecord),
            InFlight,
            Mismatch,
        }

        let outcome = self
            .store
            .update::<IdempotencyRecord, _>(Table::Idempotency, key, |current| {
                let now = Utc::now().timestamp();
                match current {
                    None => (
                        Some(IdempotencyRecord::processing(fingerprint)),
                        State::Started,
                    ),
                    Some(record) if record.is_expired(now) => (
                        Some(IdempotencyRecord::processing(fingerprint)),
                        State::Started,
                    ),
                    Some(record) => match record.state {
                        IdempotencyState::Ready if record.is_ready() => {
                            (Some(record.clone()), State::Ready(record))
                        }
                        IdempotencyState::Ready => (
                            Some(IdempotencyRecord::processing(fingerprint)),
                            State::Started,
                        ),
                        IdempotencyState::Processing if record.is_stale_processing(now) => (
                            Some(IdempotencyRecord::processing(fingerprint)),
                            State::Started,
                        ),
                        IdempotencyState::Processing if record.fingerprint == fingerprint => {
                            (Some(record), State::InFlight)
                        }
                        IdempotencyState::Processing => (Some(record), State::Mismatch),
                    },
                }
            })
            .map_err(map_err)?;

        match outcome {
            State::Started => Ok(BeginOutcome::Started),
            State::Ready(record) => Ok(BeginOutcome::Ready(self.decode(record)?)),
            State::InFlight => Ok(BeginOutcome::InFlight),
            State::Mismatch => Ok(BeginOutcome::FingerprintMismatch),
        }
    }

    pub fn complete(
        &self,
        key: &str,
        fingerprint: &str,
        response: &IdempotentResponse,
    ) -> CoreResult<()> {
        let body = serde_json::to_string(&response.body)
            .map_err(|error| CoreError::Codec(format!("failed to encode cached body: {error}")))?;
        let body_sealed = self.sealer.seal_str(&body)?;
        let record =
            IdempotencyRecord::new(response.status, body_sealed, response.content_type.clone());
        self.store
            .update::<IdempotencyRecord, _>(Table::Idempotency, key, |current| match current {
                Some(existing)
                    if existing.state == IdempotencyState::Processing
                        && existing.fingerprint == fingerprint =>
                {
                    (Some(record), ())
                }
                Some(existing) => (Some(existing), ()),
                None => (Some(record), ()),
            })
            .map_err(map_err)
    }

    pub fn abort(&self, key: &str, fingerprint: &str) -> CoreResult<()> {
        self.store
            .update::<IdempotencyRecord, _>(Table::Idempotency, key, |current| match current {
                Some(record)
                    if record.state == IdempotencyState::Processing
                        && record.fingerprint == fingerprint =>
                {
                    (None, ())
                }
                other => (other, ()),
            })
            .map_err(map_err)
    }

    fn decode(&self, record: IdempotencyRecord) -> CoreResult<IdempotentResponse> {
        let plaintext = self.sealer.open_str(&record.body_sealed)?;
        let body = serde_json::from_str::<Value>(&plaintext)
            .map_err(|error| CoreError::Codec(format!("invalid cached body: {error}")))?;
        Ok(IdempotentResponse::new(
            record.status,
            body,
            record.content_type,
        ))
    }

    pub fn put(&self, key: &str, response: &IdempotentResponse) -> CoreResult<()> {
        let body = serde_json::to_string(&response.body)
            .map_err(|error| CoreError::Codec(format!("failed to encode cached body: {error}")))?;
        let body_sealed = self.sealer.seal_str(&body)?;
        let record =
            IdempotencyRecord::new(response.status, body_sealed, response.content_type.clone());
        self.put_record(key, &record)
    }

    pub fn delete(&self, key: &str) -> CoreResult<()> {
        self.store.delete(Table::Idempotency, key).map_err(map_err)
    }

    fn put_record(&self, key: &str, record: &IdempotencyRecord) -> CoreResult<()> {
        self.store
            .put(Table::Idempotency, key, record)
            .map_err(map_err)
    }
}

/// Storage key for the application endpoint, which owns its own
/// idempotency handling.
pub fn user_key(user_id: Uuid, key: &str) -> String {
    format!("user:{user_id}:{key}")
}

pub fn valid_key(key: &str) -> bool {
    (IDEMPOTENCY_KEY_MIN_LEN..=IDEMPOTENCY_KEY_MAX_LEN).contains(&key.len())
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub fn cache_key(
    authorization: Option<&str>,
    method: &str,
    target: &str,
    idempotency_key: &str,
) -> String {
    let scope = authorization
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(ANONYMOUS_SCOPE);
    let mut hasher = Sha256::new();
    for part in [scope, method, target, idempotency_key] {
        hasher.update(part.as_bytes());
        hasher.update(b"\n");
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub async fn middleware(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    if !is_tracked(&request) {
        return next.run(request).await;
    }
    let key = match idempotency_key(request.headers()) {
        Some(key) => key,
        None => return ApiError::InvalidIdempotencyKey.into_response(),
    };
    let storage_key = storage_key(&request, key);

    let (parts, body) = request.into_parts();
    let body = match to_bytes(body, MAX_REQUEST_BODY_BYTES).await {
        Ok(body) => body,
        Err(error) => {
            return ApiError::BadRequest(format!("failed to read request body: {error}"))
                .into_response();
        }
    };
    let fingerprint = body_fingerprint(&body);
    let request = Request::from_parts(parts, Body::from(body));

    match state.idempotency.begin(&storage_key, &fingerprint) {
        Ok(BeginOutcome::Ready(cached)) => return cached.into_response(),
        Ok(BeginOutcome::InFlight) => return ApiError::IdempotencyInProgress.into_response(),
        Ok(BeginOutcome::FingerprintMismatch) => {
            return ApiError::IdempotencyKeyMismatch.into_response();
        }
        Ok(BeginOutcome::Started) => {}
        Err(error) => {
            tracing::warn!(%error, "failed to claim the idempotency record");
            return ApiError::Internal(error.to_string()).into_response();
        }
    }

    let response = next.run(request).await;
    if !response.status().is_success() {
        if let Err(error) = state.idempotency.abort(&storage_key, &fingerprint) {
            tracing::warn!(%error, "failed to release the idempotency record");
        }
        return response;
    }
    if response
        .body()
        .size_hint()
        .upper()
        .is_none_or(|len| len > MAX_CACHED_BODY_BYTES as u64)
    {
        let _ = state.idempotency.abort(&storage_key, &fingerprint);
        return response;
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let (parts, body) = response.into_parts();
    let bytes = match to_bytes(body, MAX_CACHED_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::warn!(%error, "failed to read the response body for idempotency");
            let _ = state.idempotency.abort(&storage_key, &fingerprint);
            return ApiError::Internal(error.to_string()).into_response();
        }
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => {
            let cached = IdempotentResponse::new(parts.status.as_u16(), value, content_type);
            if let Err(error) = state
                .idempotency
                .complete(&storage_key, &fingerprint, &cached)
            {
                tracing::warn!(%error, "failed to persist the idempotency record");
            }
        }
        Err(_) => {
            let _ = state.idempotency.abort(&storage_key, &fingerprint);
        }
    }
    Response::from_parts(parts, Body::from(bytes))
}

pub fn body_fingerprint(body: &[u8]) -> String {
    let digest = Sha256::digest(body);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_tracked(request: &Request) -> bool {
    request.method() == Method::POST
        && request.headers().contains_key(IDEMPOTENCY_HEADER)
        && in_scope(request.uri().path())
}

fn in_scope(path: &str) -> bool {
    path.starts_with(API_PREFIX)
        && !EXCLUDED_PREFIXES
            .iter()
            .any(|prefix| path.starts_with(prefix))
        && !EXCLUDED_PATHS.contains(&path)
}

fn idempotency_key(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(IDEMPOTENCY_HEADER)?;
    let key = value.to_str().ok()?.trim();
    valid_key(key).then_some(key)
}

fn storage_key(request: &Request, key: &str) -> String {
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let path = request.uri().path();
    let target = match request.uri().query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_string(),
    };
    cache_key(authorization, request.method().as_str(), &target, key)
}

fn map_err(error: StorageError) -> CoreError {
    CoreError::Io(std::io::Error::other(error.to_string()))
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use serde_json::json;

    use super::*;

    fn store() -> (IdempotencyStore, Arc<Store>) {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let key = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
        let sealer = Arc::new(Sealer::from_master_key(&key).unwrap());
        (IdempotencyStore::new(store.clone(), sealer), store)
    }

    #[test]
    fn accepts_keys_within_the_allowed_alphabet() {
        assert!(valid_key("device-create-1"));
        assert!(valid_key("ABCDEFGH"));
        assert!(valid_key(&"a".repeat(IDEMPOTENCY_KEY_MAX_LEN)));
        assert!(valid_key("req_2026.11.18"));
    }

    #[test]
    fn rejects_short_or_malformed_keys() {
        assert!(!valid_key("short"));
        assert!(!valid_key(""));
        assert!(!valid_key(&"a".repeat(IDEMPOTENCY_KEY_MAX_LEN + 1)));
        assert!(!valid_key("with space"));
        assert!(!valid_key("with/slash"));
        assert!(!valid_key("кириллица-ключ"));
        assert!(!valid_key("semi;colon"));
    }

    #[test]
    fn round_trip_stores_and_reads_the_record() {
        let (store, _) = store();
        let record = IdempotentResponse::new(
            200,
            json!({"device": {"id": "abc"}}),
            Some(JSON_CONTENT_TYPE.into()),
        );

        store.put("scope:key-12345678", &record).unwrap();

        assert_eq!(
            store.get("scope:key-12345678").unwrap(),
            Some(record.clone())
        );
        assert_eq!(store.get("scope:other-key-1").unwrap(), None);
        assert_eq!(store.get("other:key-12345678").unwrap(), None);
    }

    #[test]
    fn stored_body_is_sealed_at_rest() {
        let (store, raw) = store();
        let record = IdempotentResponse::new(
            200,
            json!({
                "config": {
                    "conf": "[Interface]\nPrivateKey = very-secret-private-key\n"
                },
                "device": {"name": "Phone"}
            }),
            Some(JSON_CONTENT_TYPE.into()),
        );

        store.put("scope:sealed-key-1", &record).unwrap();

        let bytes = raw
            .get_raw(Table::Idempotency, "scope:sealed-key-1")
            .unwrap()
            .unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains("very-secret-private-key"), "{text}");
        assert!(!text.contains("PrivateKey"), "{text}");
        assert!(!text.contains("Phone"), "{text}");
        assert!(text.contains("body_sealed"), "{text}");
        assert_eq!(
            store.get("scope:sealed-key-1").unwrap().unwrap().body,
            record.body
        );
    }

    #[test]
    fn prune_expired_removes_only_expired_records() {
        let (store, raw) = store();
        let body_sealed = store.sealer.seal_str(r#"{"ok":true}"#).unwrap();
        let mut expired = IdempotencyRecord::new(200, body_sealed.clone(), None);
        expired.created_at = Utc::now().timestamp() - IDEMPOTENCY_TTL_SECS - 1;
        expired.expires_at = expired.created_at + IDEMPOTENCY_TTL_SECS;
        store.put_record("scope:expired-prune-1", &expired).unwrap();
        let active = IdempotencyRecord::new(200, body_sealed, None);
        store.put_record("scope:active-prune-1", &active).unwrap();

        assert_eq!(store.prune_expired(Utc::now().timestamp()).unwrap(), 1);
        assert_eq!(raw.count(Table::Idempotency).unwrap(), 1);
        assert!(
            raw.get::<IdempotencyRecord>(Table::Idempotency, "scope:active-prune-1")
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn different_keys_are_not_serialized() {
        let (store, _) = store();
        let guard = store.lock("scope:key-a").await;
        let other = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            store.lock("scope:key-b"),
        )
        .await;
        assert!(other.is_ok(), "a different key must not wait for the lock");
        drop(other.unwrap());
        drop(guard);
    }

    #[tokio::test]
    async fn the_same_key_is_serialized() {
        let (store, _) = store();
        let guard = store.lock("scope:key-a").await;
        let blocked = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            store.lock("scope:key-a"),
        )
        .await;
        assert!(blocked.is_err(), "the same key must wait for the lock");
        drop(guard);
        let acquired = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            store.lock("scope:key-a"),
        )
        .await;
        assert!(acquired.is_ok(), "the lock must be released with the guard");
    }

    #[tokio::test]
    async fn idle_keys_are_pruned_from_the_lock_map() {
        let (store, _) = store();
        {
            let _guard = store.lock("scope:key-a").await;
        }
        assert_eq!(store.tracked_locks(), 1);
        let _guard = store.lock("scope:key-b").await;
        assert_eq!(store.tracked_locks(), 1, "the idle key is removed lazily");
    }

    #[test]
    fn begin_claims_once_and_complete_publishes_the_response() {
        let (store, _) = store();
        assert_eq!(
            store.begin("scope:claim-key-1", "fingerprint-a").unwrap(),
            BeginOutcome::Started
        );
        assert_eq!(
            store.begin("scope:claim-key-1", "fingerprint-a").unwrap(),
            BeginOutcome::InFlight
        );
        assert_eq!(
            store.begin("scope:claim-key-1", "fingerprint-b").unwrap(),
            BeginOutcome::FingerprintMismatch
        );
        assert_eq!(store.get("scope:claim-key-1").unwrap(), None);

        let response = IdempotentResponse::new(200, json!({"ok": true}), None);
        store
            .complete("scope:claim-key-1", "fingerprint-a", &response)
            .unwrap();

        assert_eq!(
            store.begin("scope:claim-key-1", "fingerprint-b").unwrap(),
            BeginOutcome::Ready(response)
        );
    }

    #[test]
    fn abort_allows_a_retry_after_a_failure() {
        let (store, _) = store();
        store.begin("scope:abort-key-1", "fingerprint-a").unwrap();
        store.abort("scope:abort-key-1", "fingerprint-a").unwrap();
        assert_eq!(
            store.begin("scope:abort-key-1", "fingerprint-a").unwrap(),
            BeginOutcome::Started
        );
    }

    #[test]
    fn stale_processing_claims_are_reclaimed() {
        let (store, raw) = store();
        let mut record = IdempotencyRecord::processing("fingerprint-a");
        record.created_at = Utc::now().timestamp() - IDEMPOTENCY_PROCESSING_TTL_SECS - 1;
        store.put_record("scope:stale-key-1", &record).unwrap();
        assert_eq!(
            store.begin("scope:stale-key-1", "fingerprint-b").unwrap(),
            BeginOutcome::Started
        );
        let stored = raw
            .get::<IdempotencyRecord>(Table::Idempotency, "scope:stale-key-1")
            .unwrap()
            .unwrap();
        assert_eq!(stored.fingerprint, "fingerprint-b");
    }

    #[test]
    fn body_fingerprint_is_stable_and_body_specific() {
        assert_eq!(body_fingerprint(b""), body_fingerprint(b""));
        assert_ne!(body_fingerprint(b"a"), body_fingerprint(b"b"));
        assert_eq!(body_fingerprint(b"a").len(), 64);
    }

    #[test]
    fn expired_record_is_ignored_and_removed() {
        let (store, raw) = store();
        let body_sealed = store.sealer.seal_str(r#"{"ok":true}"#).unwrap();
        let mut record = IdempotencyRecord::new(200, body_sealed, None);
        record.created_at = Utc::now().timestamp() - IDEMPOTENCY_TTL_SECS - 1;
        record.expires_at = record.created_at + IDEMPOTENCY_TTL_SECS;
        store.put_record("scope:expired-key-1", &record).unwrap();

        assert_eq!(store.get("scope:expired-key-1").unwrap(), None);
        assert_eq!(raw.count(Table::Idempotency).unwrap(), 0);
    }

    #[test]
    fn record_ttl_is_twenty_four_hours() {
        let record = IdempotencyRecord::new(200, "sealed".into(), None);
        assert_eq!(record.expires_at - record.created_at, IDEMPOTENCY_TTL_SECS);
        assert!(!record.is_expired(record.created_at));
        assert!(record.is_expired(record.expires_at));
    }

    #[test]
    fn user_key_is_scoped_by_user() {
        let user = Uuid::new_v4();
        assert_eq!(user_key(user, "key-1"), format!("user:{user}:key-1"));
        assert_ne!(user_key(user, "key-1"), user_key(Uuid::new_v4(), "key-1"));
    }

    #[test]
    fn cache_key_is_stable_and_scope_dependent() {
        let first = cache_key(
            Some("Bearer token-a"),
            "POST",
            "/api/v1/users",
            "same-key-1",
        );
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            first,
            cache_key(
                Some("Bearer token-a"),
                "POST",
                "/api/v1/users",
                "same-key-1"
            )
        );
        assert_ne!(
            first,
            cache_key(
                Some("Bearer token-b"),
                "POST",
                "/api/v1/users",
                "same-key-1"
            )
        );
        assert_ne!(
            first,
            cache_key(
                Some("Bearer token-a"),
                "POST",
                "/api/v1/groups",
                "same-key-1"
            )
        );
        assert_ne!(
            first,
            cache_key(Some("Bearer token-a"), "PUT", "/api/v1/users", "same-key-1")
        );
        assert_ne!(
            first,
            cache_key(
                Some("Bearer token-a"),
                "POST",
                "/api/v1/users",
                "same-key-2"
            )
        );
        assert_ne!(
            first,
            cache_key(None, "POST", "/api/v1/users", "same-key-1")
        );
        assert_eq!(
            cache_key(None, "POST", "/api/v1/users", "same-key-1"),
            cache_key(Some("   "), "POST", "/api/v1/users", "same-key-1")
        );
    }

    #[test]
    fn only_plain_post_requests_are_tracked() {
        assert!(in_scope("/api/v1/users"));
        assert!(in_scope("/api/v1/groups"));
        assert!(!in_scope("/api/v1/auth/login"));
        assert!(!in_scope("/api/v1/auth/refresh"));
        assert!(!in_scope("/api/v1/billing/webhook/mock"));
        assert!(!in_scope("/api/v1/app/devices"));
        assert!(!in_scope("/ready"));
        assert!(!in_scope("/api/v1"));
    }

    #[test]
    fn request_tracking_requires_post_and_a_header() {
        let post = Request::builder()
            .method("POST")
            .uri("/api/v1/users")
            .header(IDEMPOTENCY_HEADER, "key-12345678")
            .body(Body::empty())
            .unwrap();
        assert!(is_tracked(&post));

        let get = Request::builder()
            .method("GET")
            .uri("/api/v1/users")
            .header(IDEMPOTENCY_HEADER, "key-12345678")
            .body(Body::empty())
            .unwrap();
        assert!(!is_tracked(&get));

        let without_header = Request::builder()
            .method("POST")
            .uri("/api/v1/users")
            .body(Body::empty())
            .unwrap();
        assert!(!is_tracked(&without_header));

        let auth = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/login")
            .header(IDEMPOTENCY_HEADER, "key-12345678")
            .body(Body::empty())
            .unwrap();
        assert!(!is_tracked(&auth));
    }

    #[test]
    fn storage_key_includes_method_path_and_query() {
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/users?limit=10")
            .header(axum::http::header::AUTHORIZATION, "Bearer token-a")
            .body(Body::empty())
            .unwrap();
        let key = storage_key(&request, "key-12345678");
        assert_eq!(
            key,
            cache_key(
                Some("Bearer token-a"),
                "POST",
                "/api/v1/users?limit=10",
                "key-12345678"
            )
        );

        let plain = Request::builder()
            .method("POST")
            .uri("/api/v1/users")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            storage_key(&plain, "key-12345678"),
            cache_key(None, "POST", "/api/v1/users", "key-12345678")
        );
    }
}
