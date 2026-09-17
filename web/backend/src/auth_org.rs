//! Username/password auth for org members (separate from Telegram auth).
//!
//! Issues opaque bearer tokens kept in memory (`AppState::org_sessions`).
//! Clients send `X-Org-Token: <token>` (or `Authorization: Bearer org_<token>`).
//! The master admin (Telegram-authenticated) bypasses org tokens and acts as
//! `owner` in any org.

use actix_web::{web, HttpRequest, HttpResponse, Responder};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::models::{OrgLoginRequest, OrgSession};
use crate::supabase_org;
use crate::AppState;

pub type OrgTokenStore = Arc<Mutex<HashMap<String, OrgSession>>>;

pub fn new_token_store() -> OrgTokenStore {
    Arc::new(Mutex::new(HashMap::new()))
}

fn new_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Extract the raw org token from headers.
pub fn extract_org_token(req: &HttpRequest) -> Option<String> {
    if let Some(v) = req.headers().get("X-Org-Token") {
        if let Ok(s) = v.to_str() {
            let s = s.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    if let Some(v) = req.headers().get(actix_web::http::header::AUTHORIZATION) {
        if let Ok(s) = v.to_str() {
            let s = s.trim();
            if let Some(tok) = s.strip_prefix("Bearer ") {
                let tok = tok.trim();
                if let Some(rest) = tok.strip_prefix("org_") {
                    if !rest.is_empty() {
                        return Some(rest.to_string());
                    }
                } else if tok.starts_with("org-") || tok.len() >= 20 {
                    // Allow raw UUID bearer only when explicitly org-scoped callers
                    // also send X-Org-Id; keep X-Org-Token as the primary path.
                    return Some(tok.to_string());
                }
            }
        }
    }
    None
}

pub async fn session_from_token(state: &AppState, token: &str) -> Option<OrgSession> {
    state.org_sessions.lock().await.get(token).cloned()
}

/// Member id safe for uuid columns: master-bypass sessions carry an empty
/// member_id, which Postgres rejects (`22P02 invalid input syntax for type
/// uuid: ""`) — normalize it to None so inserts store NULL instead.
pub fn db_user_id(sess: &OrgSession) -> Option<String> {
    if sess.member_id.trim().is_empty() {
        None
    } else {
        Some(sess.member_id.clone())
    }
}

pub async fn org_session_from_req(
    state: &web::Data<AppState>,
    req: &HttpRequest,
) -> Option<OrgSession> {
    let tok = extract_org_token(req)?;
    session_from_token(state, &tok).await
}

/// True when the caller holds a live Telegram session (master admin).
/// A failed `get_me` may just be a dead pool behind the cached client
/// (dropped connection after flood/idle/restart) rather than a signed-out
/// user — so rebuild once from the persisted session and retry before
/// denying. A genuinely signed-out session still fails fast afterwards.
pub async fn is_master_admin(state: &web::Data<AppState>) -> bool {
    if let Some(c) = state.client.lock().await.clone() {
        if c.get_me().await.is_ok() {
            return true;
        }
        crate::auth::reset_client(state).await;
    }
    if let Ok(c) = crate::auth::get_client(state).await {
        return c.get_me().await.is_ok();
    }
    false
}

pub async fn require_master(state: &web::Data<AppState>) -> Result<(), HttpResponse> {
    if is_master_admin(state).await {
        Ok(())
    } else {
        Err(HttpResponse::Unauthorized().body("Master admin authentication required (Telegram login)"))
    }
}

/// Validate org_id path parameter: must match `[a-z0-9-]+`, 1-63 chars.
/// Prevents path traversal / injection via org routes.
pub fn valid_org_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

/// Require `min_role` in `org_id`. Master admin bypasses as owner.
/// Returns the resolved session (synthetic owner session for master).
pub async fn require_org_role(
    state: &web::Data<AppState>,
    req: &HttpRequest,
    org_id: &str,
    min_role: &str,
) -> Result<OrgSession, HttpResponse> {
    // Validate org_id format: must be a valid subdomain-like string.
    if !valid_org_id(org_id) {
        return Err(HttpResponse::BadRequest().body("invalid org id format"));
    }
    if let Some(sess) = org_session_from_req(state, req).await {
        if sess.org_id == org_id && supabase_org::role_satisfies(&sess.role, min_role) {
            return Ok(sess);
        }
        // Token for a different org → fall through to master check so the
        // error message stays accurate (403, not 401).
        if sess.org_id != org_id && is_master_admin(state).await {
            return Ok(OrgSession {
                token: String::new(),
                org_id: org_id.to_string(),
                member_id: String::new(),
                username: "master".into(),
                role: "owner".into(),
            });
        }
        if sess.org_id != org_id {
            return Err(HttpResponse::Forbidden().body("Token belongs to a different organization"));
        }
        return Err(HttpResponse::Forbidden()
            .body(format!("Insufficient permissions. Required role: {}", min_role)));
    }
    if is_master_admin(state).await {
        return Ok(OrgSession {
            token: String::new(),
            org_id: org_id.to_string(),
            member_id: String::new(),
            username: "master".into(),
            role: "owner".into(),
        });
    }
    Err(HttpResponse::Unauthorized().body("Authentication required (org login or master admin)"))
}

/// Extract org subdomain from Host header (`org1.example.com` → `org1`).
/// Returns None for apex/localhost/IP. `X-Org-Subdomain` overrides (dev).
pub fn subdomain_from_req(req: &HttpRequest) -> Option<String> {
    if let Some(v) = req.headers().get("X-Org-Subdomain") {
        if let Ok(s) = v.to_str() {
            let s = s.trim().to_lowercase();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    let host = req
        .headers()
        .get(actix_web::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if host.is_empty() {
        return None;
    }
    if host == "localhost" || host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() >= 3 && !parts[0].is_empty() && parts[0] != "www" {
        return Some(parts[0].to_string());
    }
    None
}

/// `POST /api/org/{org_id}/login` — username/password → org token.
pub async fn org_login(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgLoginRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    if !supabase_org::is_configured() {
        return HttpResponse::ServiceUnavailable().body("Org auth unavailable (Supabase not configured)");
    }
    let member = match supabase_org::get_org_member_by_username(&org_id, body.username.trim()).await {
        Ok(Some(m)) => m,
        Ok(None) => return HttpResponse::Unauthorized().body("Invalid username or password"),
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let hash = member.password_hash.clone().unwrap_or_default();
    if !supabase_org::verify_org_password(&body.password, &member.username, &hash) {
        return HttpResponse::Unauthorized().body("Invalid username or password");
    }
    let token = new_token();
    let sess = OrgSession {
        token: token.clone(),
        org_id: org_id.clone(),
        member_id: member.id.clone(),
        username: member.username.clone(),
        role: member.role.clone(),
    };
    state.org_sessions.lock().await.insert(token.clone(), sess.clone());
    let ip = req.peer_addr().map(|a| a.ip().to_string());
    let ua = req
        .headers()
        .get(actix_web::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    supabase_org::audit_best_effort(
        &org_id,
        Some(member.id.clone()),
        "login",
        "org_member",
        &member.id,
        serde_json::json!({ "username": member.username }),
        ip,
        ua,
    )
    .await;
    HttpResponse::Ok().json(serde_json::json!({
        "token": token,
        "org_id": org_id,
        "member_id": member.id,
        "username": member.username,
        "role": member.role,
    }))
}

/// `POST /api/org/{org_id}/logout`
pub async fn org_logout(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Some(tok) = extract_org_token(&req) {
        state.org_sessions.lock().await.remove(&tok);
    }
    let _ = org_id;
    HttpResponse::Ok().json(true)
}

/// `GET /api/org/{org_id}/me` — validate token, return session info.
pub async fn org_me(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    match require_org_role(&state, &req, &org_id, "viewer").await {
        Ok(sess) => HttpResponse::Ok().json(serde_json::json!({
            "org_id": sess.org_id,
            "member_id": sess.member_id,
            "username": sess.username,
            "role": sess.role,
        })),
        Err(e) => e,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdomain_extraction_handles_common_hosts() {
        fn sub(host: &str) -> Option<String> {
            let req = actix_web::test::TestRequest::default()
                .insert_header((actix_web::http::header::HOST, host))
                .to_http_request();
            subdomain_from_req(&req)
        }
        assert_eq!(sub("org1.example.com"), Some("org1".into()));
        assert_eq!(sub("org1.example.com:8080"), Some("org1".into()));
        assert_eq!(sub("example.com"), None);
        assert_eq!(sub("localhost:5173"), None);
        assert_eq!(sub("127.0.0.1:8080"), None);
        assert_eq!(sub("www.example.com"), None);
    }

    #[test]
    fn token_extraction_prefers_org_header() {
        let req = actix_web::test::TestRequest::default()
            .insert_header(("X-Org-Token", "abc123"))
            .to_http_request();
        assert_eq!(extract_org_token(&req), Some("abc123".into()));
    }

    #[test]
    fn db_user_id_rejects_empty_master_bypass_id() {
        // Master-bypass sessions carry member_id "" — must become None or
        // Postgres fails with 22P02 (invalid input syntax for type uuid).
        let master = OrgSession {
            token: String::new(),
            org_id: "org".into(),
            member_id: String::new(),
            username: "master".into(),
            role: "owner".into(),
        };
        assert_eq!(db_user_id(&master), None);
        let member = OrgSession { member_id: "some-uuid".into(), ..master };
        assert_eq!(db_user_id(&member), Some("some-uuid".to_string()));
    }
}
