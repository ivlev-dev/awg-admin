use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, Method, header};
use axum::middleware::Next;
use axum::response::Response;
use ipnet::IpNet;
use uuid::Uuid;

use awg_audit::{AuditEntry, NewAuditEntry};

use crate::state::AppState;

const API_PREFIX: &str = "/api/v1";
const LOGIN_PATH: &str = "/api/v1/auth/login";
const MAX_ACTOR_LOGIN_LEN: usize = 254;

pub async fn middleware(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let authorization = header_string(request.headers(), header::AUTHORIZATION);
    let ip = client_ip(Some(peer), request.headers(), &state.config.trusted_proxies);

    let response = next.run(request).await;

    if !is_mutating(&method)
        || !path.starts_with(API_PREFIX)
        || path == LOGIN_PATH
        || !response.status().is_success()
    {
        return response;
    }
    let Some((entity, entity_id)) = audit_target(&path) else {
        return response;
    };

    let (actor_id, actor_login) = match resolve_actor(&state, authorization.as_deref()) {
        Some((id, email)) => (Some(id), truncate_actor_login(&email)),
        None => (None, "anonymous".to_string()),
    };
    let entry = AuditEntry::from_new(NewAuditEntry {
        actor_id,
        actor_login,
        action: method.as_str().to_string(),
        entity,
        entity_id,
        status: response.status().as_u16(),
        ip,
        details: Some(format!("{method} {path}")),
    });
    crate::metrics::record_audit(method.as_str(), response.status().as_u16());
    if let Err(error) = state.audit.record(entry) {
        tracing::warn!(%error, "failed to record audit entry");
    }
    response
}

pub fn record_login(
    state: &AppState,
    ip: Option<String>,
    email: &str,
    actor_id: Option<Uuid>,
    status: u16,
    details: Option<String>,
) {
    let actor_login = truncate_actor_login(email);
    let entry = AuditEntry::from_new(NewAuditEntry {
        actor_id,
        actor_login,
        action: Method::POST.as_str().to_string(),
        entity: "auth/login".into(),
        entity_id: None,
        status,
        ip,
        details,
    });
    crate::metrics::record_audit(Method::POST.as_str(), status);
    if let Err(error) = state.audit.record(entry) {
        tracing::warn!(%error, "failed to record audit entry");
    }
}

fn truncate_actor_login(email: &str) -> String {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        return "anonymous".to_string();
    }
    trimmed.chars().take(MAX_ACTOR_LOGIN_LEN).collect()
}

fn resolve_actor(state: &AppState, authorization: Option<&str>) -> Option<(Uuid, String)> {
    let token = authorization?.strip_prefix("Bearer ")?;
    let principal = state.identity.authenticate(token).ok()?;
    let user = state.identity.find(principal.user_id).ok()?;
    Some((user.id, user.email))
}

/// Resolves the client address for rate limiting and audit records.
///
/// Forwarding headers are only honoured when the direct peer belongs to
/// `trusted` (configured with `AWG_TRUSTED_PROXIES`). The right-most
/// `X-Forwarded-For` hop that is not itself a trusted proxy is returned, so a
/// client cannot spoof its address by prepending entries to the header.
pub fn client_ip(
    peer: Option<SocketAddr>,
    headers: &HeaderMap,
    trusted: &[IpNet],
) -> Option<String> {
    let peer_ip = peer?.ip();
    if !is_trusted(peer_ip, trusted) {
        return Some(peer_ip.to_string());
    }
    if let Some(value) = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        for part in value.split(',').rev() {
            let Ok(ip) = IpAddr::from_str(part.trim()) else {
                continue;
            };
            if !is_trusted(ip, trusted) {
                return Some(ip.to_string());
            }
        }
    }
    if let Some(ip) = headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| IpAddr::from_str(value.trim()).ok())
        && !is_trusted(ip, trusted)
    {
        return Some(ip.to_string());
    }
    Some(peer_ip.to_string())
}

fn is_trusted(ip: IpAddr, trusted: &[IpNet]) -> bool {
    trusted.iter().any(|net| net.contains(&ip))
}

pub fn is_mutating(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PATCH | Method::PUT | Method::DELETE
    )
}

pub fn audit_target(path: &str) -> Option<(String, Option<String>)> {
    let rest = path.strip_prefix(API_PREFIX)?.trim_start_matches('/');
    if rest.is_empty() {
        return None;
    }
    let segments: Vec<&str> = rest.split('/').filter(|part| !part.is_empty()).collect();
    let mut entity_parts: Vec<&str> = Vec::new();
    let mut entity_id = None;
    for (index, segment) in segments.iter().enumerate() {
        let uuid = Uuid::parse_str(segment).is_ok();
        let share_token = segments.first() == Some(&"shares") && index == 1;
        if uuid || share_token {
            if entity_id.is_none() {
                entity_id = Some((*segment).to_string());
            }
            continue;
        }
        entity_parts.push(segment);
    }
    if entity_parts.is_empty() {
        return None;
    }
    Some((entity_parts.join("/"), entity_id))
}

fn header_string(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_logins_are_truncated_and_default_to_anonymous() {
        assert_eq!(truncate_actor_login("   "), "anonymous");
        assert_eq!(truncate_actor_login(" admin@local "), "admin@local");
        let long = "я".repeat(300);
        let truncated = truncate_actor_login(&long);
        assert_eq!(truncated.chars().count(), MAX_ACTOR_LOGIN_LEN);
        let ascii = "a".repeat(500);
        assert_eq!(truncate_actor_login(&ascii).len(), MAX_ACTOR_LOGIN_LEN);
    }

    #[test]
    fn mutating_methods_are_detected() {
        assert!(is_mutating(&Method::POST));
        assert!(is_mutating(&Method::PATCH));
        assert!(is_mutating(&Method::PUT));
        assert!(is_mutating(&Method::DELETE));
        assert!(!is_mutating(&Method::GET));
        assert!(!is_mutating(&Method::OPTIONS));
        assert!(!is_mutating(&Method::HEAD));
    }

    #[test]
    fn target_extracts_entity_and_id() {
        let id = Uuid::new_v4();
        assert_eq!(
            audit_target(&format!("/api/v1/devices/{id}")),
            Some(("devices".to_string(), Some(id.to_string())))
        );
        assert_eq!(
            audit_target("/api/v1/tariffs"),
            Some(("tariffs".to_string(), None))
        );
        assert_eq!(
            audit_target("/api/v1/auth/login"),
            Some(("auth/login".to_string(), None))
        );
    }

    #[test]
    fn target_handles_nested_routes() {
        let device = Uuid::new_v4();
        let interface = Uuid::new_v4();
        assert_eq!(
            audit_target(&format!("/api/v1/devices/{device}/profiles/{interface}")),
            Some(("devices/profiles".to_string(), Some(device.to_string())))
        );
        assert_eq!(
            audit_target(&format!("/api/v1/users/{device}/password")),
            Some(("users/password".to_string(), Some(device.to_string())))
        );
        assert_eq!(
            audit_target("/api/v1/groups/pools"),
            Some(("groups/pools".to_string(), None))
        );
    }

    #[test]
    fn target_treats_share_token_as_id() {
        assert_eq!(
            audit_target("/api/v1/shares/abc123def"),
            Some(("shares".to_string(), Some("abc123def".to_string())))
        );
    }

    #[test]
    fn target_ignores_non_api_paths() {
        assert_eq!(audit_target("/health"), None);
        assert_eq!(audit_target("/api/v1"), None);
        assert_eq!(audit_target("/api/v1/"), None);
    }

    fn peer() -> SocketAddr {
        "192.0.2.10:54321".parse().unwrap()
    }

    fn proxies() -> Vec<IpNet> {
        vec!["192.0.2.0/24".parse().unwrap()]
    }

    #[test]
    fn client_ip_ignores_forwarded_headers_from_untrusted_peers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.5".parse().unwrap());
        headers.insert("x-real-ip", "198.51.100.9".parse().unwrap());
        assert_eq!(
            client_ip(Some(peer()), &headers, &[]),
            Some("192.0.2.10".to_string())
        );
        assert_eq!(
            client_ip(Some(peer()), &headers, &proxies()),
            Some("203.0.113.5".to_string())
        );
    }

    #[test]
    fn client_ip_returns_the_rightmost_untrusted_hop() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "203.0.113.5, 198.51.100.7, 192.0.2.20".parse().unwrap(),
        );
        assert_eq!(
            client_ip(Some(peer()), &headers, &proxies()),
            Some("198.51.100.7".to_string())
        );
    }

    #[test]
    fn client_ip_falls_back_to_peer_when_the_chain_is_trusted() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "192.0.2.20, 192.0.2.30".parse().unwrap());
        assert_eq!(
            client_ip(Some(peer()), &headers, &proxies()),
            Some("192.0.2.10".to_string())
        );
    }

    #[test]
    fn client_ip_uses_real_ip_only_from_a_trusted_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "198.51.100.9".parse().unwrap());
        assert_eq!(
            client_ip(Some(peer()), &headers, &proxies()),
            Some("198.51.100.9".to_string())
        );

        let headers = HeaderMap::new();
        assert_eq!(
            client_ip(Some(peer()), &headers, &proxies()),
            Some("192.0.2.10".into())
        );
        assert_eq!(client_ip(None, &headers, &proxies()), None);
    }

    #[test]
    fn client_ip_skips_malformed_forwarded_entries() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "not-an-ip, 203.0.113.5, also-bad".parse().unwrap(),
        );
        assert_eq!(
            client_ip(Some(peer()), &headers, &proxies()),
            Some("203.0.113.5".to_string())
        );
    }
}
