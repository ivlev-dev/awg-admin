use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use uuid::Uuid;

use awg_identity::domain::{AuthClaims, TokenKind};
use awg_identity::{
    Argon2Hasher, CaptureMailer, IdentityService, JwtIssuer, NewUser,
    RedbEmailVerificationRepository, RedbUserRepository, Role, SessionMetadata, TokenIssuer,
    UserChanges,
};
use awg_shared::crypto::Sealer;
use awg_storage::Store;

const SECRET: &[u8] = b"test-secret-with-at-least-32-bytes!!";
const ISSUER: &str = "awg-admin";
const AUDIENCE: &str = "awg-admin";

fn sealer() -> Arc<Sealer> {
    let key = STANDARD.encode([9u8; 32]);
    Arc::new(Sealer::from_master_key(&key).unwrap())
}

fn service() -> IdentityService {
    service_with_ttl(900, 86_400)
}

fn service_with_ttl(access_ttl: u64, refresh_ttl: u64) -> IdentityService {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let users = Arc::new(RedbUserRepository::new(store.clone()));
    let hasher = Arc::new(Argon2Hasher::default());
    let tokens = Arc::new(JwtIssuer::new(
        SECRET,
        access_ttl,
        refresh_ttl,
        ISSUER,
        AUDIENCE,
        store.clone(),
    ));
    let verifications = Arc::new(RedbEmailVerificationRepository::new(store));
    let mailer = Arc::new(CaptureMailer::new());
    IdentityService::new(
        users,
        hasher,
        tokens,
        verifications,
        mailer,
        sealer(),
        "https://panel.test".into(),
    )
}

fn metadata() -> SessionMetadata {
    SessionMetadata {
        user_agent: Some("test-agent".into()),
        ip: Some("203.0.113.9".into()),
    }
}

fn create_user(service: &IdentityService, local: &str) -> awg_identity::User {
    service
        .create(NewUser {
            email: format!("{local}@example.com"),
            full_name: None,
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap()
}

fn base_claims(user_id: Uuid) -> AuthClaims {
    let now = Utc::now();
    AuthClaims {
        sub: user_id,
        role: Role::Admin,
        iss: ISSUER.into(),
        aud: AUDIENCE.into(),
        exp: (now + Duration::minutes(15)).timestamp() as usize,
        nbf: now.timestamp() as usize,
        iat: now.timestamp() as usize,
        jti: Uuid::new_v4(),
        kind: TokenKind::Access,
    }
}

fn mint(claims: &AuthClaims) -> String {
    encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(SECRET),
    )
    .unwrap()
}

#[test]
fn seeds_admin_once_and_logs_in() {
    let service = service();
    let admin = service.seed_admin("admin@local", "password123").unwrap();
    assert!(admin.is_some());
    assert_eq!(admin.as_ref().unwrap().email, "admin@local");
    assert!(admin.as_ref().unwrap().full_name.is_none());
    assert!(
        service
            .seed_admin("other@local", "password123")
            .unwrap()
            .is_none()
    );

    assert!(
        service
            .login("admin@local", "wrong-password", &metadata())
            .is_err()
    );
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();
    assert_eq!(session.user.role, Role::Admin);

    let principal = service.authenticate(&session.access_token).unwrap();
    assert!(principal.is_admin());
    assert_eq!(principal.user_id, session.user.id);
}

#[test]
fn seeds_admin_with_configured_email() {
    let service = service();
    let admin = service
        .seed_admin(" Owner@Example.COM ", "password123")
        .unwrap()
        .unwrap();
    assert_eq!(admin.email, "owner@example.com");
    assert_eq!(admin.role, Role::Admin);

    assert!(
        service
            .login("owner@example.com", "password123", &metadata())
            .is_ok()
    );
    assert!(
        service
            .seed_admin("other@example.com", "password123")
            .unwrap()
            .is_none()
    );
}

#[test]
fn refresh_rotates_tokens_in_the_same_family() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();
    let family = service.sessions(session.user.id).unwrap()[0].family_id;

    let refreshed = service
        .refresh(&session.refresh_token, &metadata())
        .unwrap();
    assert_ne!(refreshed.access_token, session.access_token);
    assert_ne!(refreshed.refresh_token, session.refresh_token);

    let sessions = service.sessions(session.user.id).unwrap();
    let rotated = sessions
        .iter()
        .find(|item| !item.used && !item.revoked)
        .unwrap();
    assert_eq!(rotated.family_id, family);
}

#[test]
fn reused_refresh_revokes_the_whole_family() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();
    let rotated = service
        .refresh(&session.refresh_token, &metadata())
        .unwrap();

    let error = service
        .refresh(&session.refresh_token, &metadata())
        .unwrap_err();
    assert!(error.to_string().contains("reuse detected"));
    assert!(
        service
            .refresh(&rotated.refresh_token, &metadata())
            .is_err()
    );
}

#[test]
fn access_and_refresh_kinds_are_not_interchangeable() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();

    assert!(service.refresh(&session.access_token, &metadata()).is_err());
    assert!(service.authenticate(&session.refresh_token).is_err());
}

#[test]
fn rejects_tokens_with_wrong_issuer_or_audience() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();

    let mut wrong_issuer = base_claims(session.user.id);
    wrong_issuer.iss = "another-issuer".into();
    let mut wrong_audience = base_claims(session.user.id);
    wrong_audience.aud = "another-audience".into();
    assert!(service.authenticate(&mint(&wrong_issuer)).is_err());
    assert!(service.authenticate(&mint(&wrong_audience)).is_err());
}

#[test]
fn rejects_expired_and_not_yet_valid_tokens() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();
    let now = Utc::now().timestamp();

    let mut expired = base_claims(session.user.id);
    expired.iat = (now - 7200) as usize;
    expired.nbf = (now - 7200) as usize;
    expired.exp = (now - 3600) as usize;

    let mut not_yet_valid = base_claims(session.user.id);
    not_yet_valid.nbf = (now + 3600) as usize;
    not_yet_valid.exp = (now + 7200) as usize;

    assert!(service.authenticate(&mint(&expired)).is_err());
    assert!(service.authenticate(&mint(&not_yet_valid)).is_err());
}

#[test]
fn password_change_and_role_update() {
    let service = service();
    let admin = service
        .seed_admin("admin@local", "password123")
        .unwrap()
        .unwrap();
    let user = create_user(&service, "user");
    let session = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    assert!(
        service
            .change_password(user.id, "", None, "newpassword123")
            .is_err(),
        "the current password is required"
    );
    assert!(
        service
            .change_password(user.id, "wrong-password", None, "newpassword123")
            .is_err()
    );
    service
        .change_password(user.id, "password123", None, "newpassword123")
        .unwrap();
    assert!(
        service
            .login("user@example.com", "newpassword123", &metadata())
            .is_ok()
    );
    assert!(
        service
            .login("user@example.com", "password123", &metadata())
            .is_err()
    );
    assert!(
        service
            .refresh(&session.refresh_token, &metadata())
            .is_err()
    );

    let updated = service
        .update(
            user.id,
            UserChanges {
                full_name: None,
                email: None,
                role: Some(Role::Admin),
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(false),
            },
        )
        .unwrap();
    assert_eq!(updated.role, Role::Admin);
    assert!(service.list().unwrap().iter().any(|u| u.id == admin.id));
}

#[test]
fn create_and_update_bind_users_to_a_node() {
    let service = service();
    let node_id = Uuid::new_v4();
    let user = service
        .create(NewUser {
            email: "node-user@example.com".into(),
            full_name: None,
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: Some(node_id),
        })
        .unwrap();
    assert_eq!(user.node_id, Some(node_id));

    let untouched = service
        .update(
            user.id,
            UserChanges {
                full_name: None,
                email: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: None,
            },
        )
        .unwrap();
    assert_eq!(untouched.node_id, Some(node_id));

    let cleared = service
        .update(
            user.id,
            UserChanges {
                full_name: None,
                email: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: Some(None),
                disabled: None,
            },
        )
        .unwrap();
    assert_eq!(cleared.node_id, None);

    let another = Uuid::new_v4();
    let rebound = service
        .update(
            user.id,
            UserChanges {
                full_name: None,
                email: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: Some(Some(another)),
                disabled: None,
            },
        )
        .unwrap();
    assert_eq!(rebound.node_id, Some(another));
}

#[test]
fn create_uses_email_as_primary_identifier() {
    let service = service();
    let user = service
        .create(NewUser {
            email: " New.User@Example.COM ".into(),
            full_name: None,
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap();
    assert_eq!(user.email, "new.user@example.com");

    let duplicate = service
        .create(NewUser {
            email: "NEW.USER@example.com".into(),
            full_name: None,
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap_err();
    assert!(
        duplicate
            .to_string()
            .contains("email is already registered"),
        "{duplicate}"
    );

    let other = service
        .create(NewUser {
            email: "new.user@another.example".into(),
            full_name: None,
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap();
    assert_eq!(other.email, "new.user@another.example");

    let session = service
        .login("NEW.USER@EXAMPLE.COM", "password123", &metadata())
        .unwrap();
    assert_eq!(session.user.id, user.id);
    assert!(
        service
            .login("new.user", "password123", &metadata())
            .is_err(),
        "a bare login is no longer accepted"
    );
}

#[test]
fn full_name_is_created_trimmed_and_updated() {
    let service = service();
    let user = service
        .create(NewUser {
            email: "named@example.com".into(),
            full_name: Some("  Иван Петров  ".into()),
            password: "password123".into(),
            role: Role::User,
            tariff_id: None,
            group_id: None,
            node_id: None,
        })
        .unwrap();
    assert_eq!(user.full_name.as_deref(), Some("Иван Петров"));

    let cleared = service
        .update(
            user.id,
            UserChanges {
                email: None,
                full_name: Some(None),
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: None,
            },
        )
        .unwrap();
    assert!(cleared.full_name.is_none());

    let invalid = service
        .update(
            user.id,
            UserChanges {
                email: None,
                full_name: Some(Some("x".repeat(201))),
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: None,
            },
        )
        .unwrap_err();
    assert!(invalid.to_string().contains("full_name"), "{invalid}");
}

#[test]
fn update_changes_email_with_uniqueness() {
    let service = service();
    let alice = create_user(&service, "alice");
    let bob = create_user(&service, "bob");

    let updated = service
        .update(
            alice.id,
            UserChanges {
                full_name: None,
                email: Some(" Alice.New@Example.COM ".into()),
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: None,
            },
        )
        .unwrap();
    assert_eq!(updated.email, "alice.new@example.com");

    let conflict = service
        .update(
            bob.id,
            UserChanges {
                full_name: None,
                email: Some("ALICE.NEW@example.com".into()),
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: None,
            },
        )
        .unwrap_err();
    assert!(
        conflict.to_string().contains("email is already registered"),
        "{conflict}"
    );
    assert_eq!(service.find(bob.id).unwrap().email, "bob@example.com");

    assert!(
        service
            .login("alice.new@example.com", "password123", &metadata())
            .is_ok()
    );
    assert!(
        service
            .login("alice@example.com", "password123", &metadata())
            .is_err()
    );
    assert!(
        service.login("alice", "password123", &metadata()).is_err(),
        "a bare login is no longer accepted"
    );
}

#[test]
fn disabled_user_cannot_log_in_and_loses_sessions() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let user = create_user(&service, "user");
    let session = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    service
        .update(
            user.id,
            UserChanges {
                full_name: None,
                email: None,
                role: None,
                tariff_id: None,
                group_id: None,
                node_id: None,
                disabled: Some(true),
            },
        )
        .unwrap();
    assert!(
        service
            .login("user@example.com", "password123", &metadata())
            .is_err()
    );
    assert!(service.authenticate(&session.access_token).is_err());
    assert!(
        service
            .refresh(&session.refresh_token, &metadata())
            .is_err()
    );
}

#[test]
fn deleted_user_loses_access_and_sessions() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let user = create_user(&service, "user");
    let session = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    service.delete(user.id).unwrap();
    assert!(service.authenticate(&session.access_token).is_err());
    assert!(
        service
            .refresh(&session.refresh_token, &metadata())
            .is_err()
    );
}

#[test]
fn lists_and_revokes_sessions_per_user() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let user = create_user(&service, "user");
    let other = create_user(&service, "other");

    let session = service
        .login("user@example.com", "password123", &metadata())
        .unwrap();

    let sessions = service.sessions(user.id).unwrap();
    assert_eq!(sessions.len(), 1);
    let listed = &sessions[0];
    assert_eq!(
        listed.user_agent.as_deref(),
        Some("test-agent"),
        "session metadata comes from the request"
    );
    assert_eq!(listed.ip.as_deref(), Some("203.0.113.9"));
    assert!(listed.expires_at > listed.created_at);
    assert!(!listed.revoked);
    assert!(!listed.used);

    assert!(service.revoke_session(other.id, listed.jti).is_err());
    service.revoke_session(user.id, listed.jti).unwrap();

    let sessions = service.sessions(user.id).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].revoked);
    assert!(
        service
            .refresh(&session.refresh_token, &metadata())
            .is_err()
    );
}

#[test]
fn logout_all_revokes_every_refresh_token() {
    let service = service();
    service.seed_admin("admin@local", "password123").unwrap();
    let session = service
        .login("admin@local", "password123", &metadata())
        .unwrap();

    let revoked = service.logout_all(session.user.id).unwrap();
    assert_eq!(revoked, 1);
    assert!(
        service
            .refresh(&session.refresh_token, &metadata())
            .is_err()
    );
}

#[test]
fn prune_removes_expired_records() {
    let store = Arc::new(Store::open_in_memory().unwrap());
    let tokens = JwtIssuer::new(SECRET, 900, 0, ISSUER, AUDIENCE, store);
    let now = Utc::now();
    let user = awg_identity::User {
        id: uuid::Uuid::new_v4(),
        email: "user@example.com".into(),
        full_name: None,
        password_hash: String::new(),
        role: Role::User,
        tariff_id: None,
        group_id: None,
        node_id: None,
        disabled: false,
        status: awg_identity::UserStatus::Active,
        totp_secret_sealed: None,
        totp_enabled: false,
        recovery_codes: Vec::new(),
        totp_pending_secret_sealed: None,
        totp_pending_recovery_codes: Vec::new(),
        last_totp_step: None,
        created_at: now,
        updated_at: now,
    };
    tokens.issue(&user, &metadata()).unwrap();

    assert_eq!(tokens.prune_expired().unwrap(), 1);
    assert_eq!(tokens.prune_expired().unwrap(), 0);
}
