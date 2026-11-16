use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, Method, header};
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

use awg_audit::{AuditEntry, NewAuditEntry};

use crate::state::AppState;

const API_PREFIX: &str = "/api/v1";
const LOGIN_PATH: &str = "/api/v1/auth/login";

pub async fn middleware(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let authorization = header_string(request.headers(), header::AUTHORIZATION);
    let ip = client_ip(request.headers(), Some(peer));

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
        Some((id, login)) => (Some(id), login),
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
    login: &str,
    actor_id: Option<Uuid>,
    status: u16,
    details: Option<String>,
) {
    let actor_login = match login.trim() {
        "" => "anonymous".to_string(),
        value => value.to_string(),
    };
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

fn resolve_actor(state: &AppState, authorization: Option<&str>) -> Option<(Uuid, String)> {
    let token = authorization?.strip_prefix("Bearer ")?;
    let principal = state.identity.authenticate(token).ok()?;
    let user = state.identity.find(principal.user_id).ok()?;
    Some((user.id, user.login))
}

pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
    for name in ["x-forwarded-for", "x-real-ip"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok())
            && let Some(first) = value
                .split(',')
                .map(str::trim)
                .find(|part| !part.is_empty())
        {
            return Some(first.to_string());
        }
    }
    peer.map(|addr| addr.ip().to_string())
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

    #[test]
    fn client_ip_prefers_forwarded_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.5, 192.0.2.1".parse().unwrap());
        assert_eq!(
            client_ip(&headers, Some(peer())),
            Some("203.0.113.5".to_string())
        );
    }

    #[test]
    fn client_ip_uses_real_ip_then_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "198.51.100.9".parse().unwrap());
        assert_eq!(
            client_ip(&headers, Some(peer())),
            Some("198.51.100.9".to_string())
        );

        let headers = HeaderMap::new();
        assert_eq!(client_ip(&headers, Some(peer())), Some("192.0.2.10".into()));
        assert_eq!(client_ip(&headers, None), None);
    }
}
