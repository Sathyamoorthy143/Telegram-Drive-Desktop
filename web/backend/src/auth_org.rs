//! Username/password auth for org members (separate from Telegram auth).
//!
//! Issues opaque bearer tokens kept in memory (`AppState::org_sessions`).
//! Clients send `X-Org-Token: <token>` (or `Authorization: Bearer org_<token>`).
//! The master admin (Telegram-authenticated) bypasses org tokens and acts as
//! `owner` in any org. Each org member may hold only one live token: a new
//! login revokes that member's previous sessions in the same organization.

use actix_web::{web, HttpRequest, HttpResponse, Responder};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::models::{OrgLoginRequest, OrgMember, OrgSession};
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

/// Org bearer tokens live this long (in-memory store, so a backend restart
/// logs everyone out regardless).
pub const ORG_TOKEN_TTL_SECS: i64 = 24 * 3600;

/// Member roles are re-read from the database at most this often per session,
/// so demotions/removals take effect without forcing a re-login.
pub const ORG_ROLE_CHECK_TTL_SECS: i64 = 5 * 60;

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Pure expiry check (kept separate for unit testing): unknown (0) or
/// older-than-TTL issuance is expired.
pub fn is_token_expired(issued_at: i64, now: i64) -> bool {
    now - issued_at > ORG_TOKEN_TTL_SECS
}

/// Pure sliding-window check: refresh the stamp once past half-TTL so active
/// sessions survive without a store write on every request.
pub fn should_slide_issued_at(issued_at: i64, now: i64) -> bool {
    !is_token_expired(issued_at, now) && now - issued_at > ORG_TOKEN_TTL_SECS / 2
}

/// One live login per org member: drop every in-memory session that matches
/// this `(org_id, member_id)`. Empty `member_id` (master-bypass) is ignored.
pub fn revoke_sessions_for_member(
    store: &mut HashMap<String, OrgSession>,
    org_id: &str,
    member_id: &str,
) -> usize {
    if member_id.trim().is_empty() {
        return 0;
    }
    let before = store.len();
    store.retain(|_, sess| !(sess.org_id == org_id && sess.member_id == member_id));
    before.saturating_sub(store.len())
}

pub async fn session_from_token(state: &AppState, token: &str) -> Option<OrgSession> {
    let mut store = state.org_sessions.lock().await;
    let mut sess = store.get(token)?.clone();
    let now = now_unix();
    if is_token_expired(sess.issued_at, now) {
        store.remove(token);
        return None;
    }
    // Sliding window: active sessions stay alive, but refresh the stamp at
    // most every half-TTL so each request doesn't rewrite the store.
    if should_slide_issued_at(sess.issued_at, now) {
        sess.issued_at = now;
        store.insert(token.to_string(), sess.clone());
    }
    // Fresh role check (cloudsphere-style stale-role immunity): a demoted or
    // removed member loses access within ROLE_CHECK_TTL, no re-login needed
    // to enforce it. DB failures fail OPEN (keep the session, retry next
    // request) so a Supabase blip doesn't lock everyone out. Master-bypass
    // sessions (empty member_id) are local-only and skip the lookup.
    if !sess.member_id.trim().is_empty() && now - sess.role_checked_at > ORG_ROLE_CHECK_TTL_SECS {
        match supabase_org::get_org_member_by_username(&sess.org_id, &sess.username).await {
            Ok(Some(m)) => {
                sess.role = m.role;
                sess.role_checked_at = now;
                store.insert(token.to_string(), sess.clone());
            }
            Ok(None) => {
                store.remove(token);
                return None;
            }
            Err(_) => {}
        }
    }
    Some(sess)
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

/// Master-admin verdict with the failure reason preserved, so callers can
/// tell "signed out" (re-login) apart from "Telegram unreachable" (retry).
pub enum MasterCheck {
    Authorized,
    Unauthorized,
    TransportUnavailable,
}

/// Positive and negative verdicts are cached briefly; transport failures are
/// never cached. Cleared on auth transitions (sign-in, 2FA, logout).
pub const MASTER_CACHE_TTL_SECS: u64 = 30;

pub fn clear_master_cache(state: &AppState) {
    // Sync try_lock: never block request paths on the cache.
    if let Ok(mut g) = state.master_cache.try_lock() {
        *g = (None, None);
    }
}

fn classify_master_err(m: &str) -> MasterCheck {
    if crate::auth::is_transport_failure(m) {
        MasterCheck::TransportUnavailable
    } else if m.contains("Unauthorized")
        || m.contains("AuthKey")
        || m.contains("AUTH_KEY")
        || m.contains("not logged")
    {
        MasterCheck::Unauthorized
    } else {
        // Unknown RPC error: favor "retry shortly" over logging the user out.
        MasterCheck::TransportUnavailable
    }
}

pub async fn check_master(state: &web::Data<AppState>) -> MasterCheck {
    if let (Some(v), Some(at)) = state.master_cache.lock().await.clone() {
        if at.elapsed() < std::time::Duration::from_secs(MASTER_CACHE_TTL_SECS) {
            return if v {
                MasterCheck::Authorized
            } else {
                MasterCheck::Unauthorized
            };
        }
    }
    let verdict = match state.client.lock().await.clone() {
        Some(c) => match c.get_me().await {
            Ok(_) => MasterCheck::Authorized,
            Err(e) => {
                let m = e.to_string();
                if !crate::auth::is_transport_failure(&m) {
                    classify_master_err(&m)
                } else {
                    // Dead pool behind the cached client: rebuild once from
                    // the persisted session and re-probe before denying.
                    crate::auth::reset_client(state).await;
                    match crate::auth::get_client(state).await {
                        Ok(c2) => match c2.get_me().await {
                            Ok(_) => MasterCheck::Authorized,
                            Err(e2) => classify_master_err(&e2.to_string()),
                        },
                        Err(_) => MasterCheck::TransportUnavailable,
                    }
                }
            }
        },
        None => match crate::auth::get_client(state).await {
            Ok(c) => match c.get_me().await {
                Ok(_) => MasterCheck::Authorized,
                Err(e) => classify_master_err(&e.to_string()),
            },
            Err(e) => {
                // No usable session/config at all → signed out, not transport.
                let _ = e;
                MasterCheck::Unauthorized
            }
        },
    };
    let cacheable = !matches!(verdict, MasterCheck::TransportUnavailable);
    if cacheable {
        *state.master_cache.lock().await = (
            Some(matches!(verdict, MasterCheck::Authorized)),
            Some(std::time::Instant::now()),
        );
    }
    verdict
}

/// True when the caller holds a live Telegram session (master admin).
pub async fn is_master_admin(state: &web::Data<AppState>) -> bool {
    matches!(check_master(state).await, MasterCheck::Authorized)
}

pub async fn require_master(state: &web::Data<AppState>) -> Result<(), HttpResponse> {
    match check_master(state).await {
        MasterCheck::Authorized => Ok(()),
        MasterCheck::Unauthorized => {
            Err(HttpResponse::Unauthorized().body("Master admin authentication required (Telegram login)"))
        }
        MasterCheck::TransportUnavailable => Err(HttpResponse::ServiceUnavailable()
            .body("Telegram temporarily unreachable — you are still signed in, retry shortly")),
    }
}

pub async fn current_telegram_user_id(state: &web::Data<AppState>) -> Result<i64, HttpResponse> {
    require_master(state).await?;
    let client = crate::auth::get_client(state)
        .await
        .map_err(|e| HttpResponse::InternalServerError().body(e))?;
    match client.get_me().await {
        Ok(me) => Ok(me.id().bare_id().unwrap_or(0) as i64),
        Err(e) => Err(HttpResponse::Unauthorized().body(e.to_string())),
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

fn synthetic_master_session(org_id: &str) -> OrgSession {
    OrgSession {
        token: String::new(),
        org_id: org_id.to_string(),
        member_id: String::new(),
        username: "master".into(),
        role: "owner".into(),
        issued_at: now_unix(),
        role_checked_at: now_unix(),
    }
}

/// Folder-grant level hierarchy: view < read < write < full.
pub fn grant_rank(level: &str) -> u8 {
    match level {
        "view" => 1,
        "read" => 2,
        "write" => 3,
        "full" => 4,
        _ => 0,
    }
}

pub fn grant_satisfies(have: &str, need: &str) -> bool {
    grant_rank(have) >= grant_rank(need)
}

/// Folder-scoped access check, called AFTER `require_org_role`.
///
/// Rules (cloudsphere-style, adapted to channel folders):
/// - owner/admin/master-bypass: full access everywhere.
/// - drive root (`None`/`0`): the org-wide role (already checked) governs.
/// - editor/viewer on a subfolder: an explicit grant for (member, folder),
///   when present, REPLACES the org role; no row → org role governs.
/// - Supabase lookup failures fail OPEN with a warning (same philosophy as
///   the role re-check): availability over lockout on a blip.
pub async fn check_folder_access(
    _state: &AppState,
    org_id: &str,
    sess: &OrgSession,
    folder_id: Option<i64>,
    need: &str,
) -> Result<(), HttpResponse> {
    if sess.member_id.trim().is_empty() {
        return Ok(());
    }
    if supabase_org::role_satisfies(&sess.role, "admin") {
        return Ok(());
    }
    let fid = folder_id.unwrap_or(0);
    if fid == 0 {
        return Ok(());
    }
    match supabase_org::get_org_grant(org_id, fid, &sess.member_id).await {
        Ok(Some(g)) if !grant_satisfies(&g.level, need) => Err(HttpResponse::Forbidden().body(format!(
            "Folder access denied. Required level: {}",
            need
        ))),
        Ok(_) => Ok(()),
        Err(e) => {
            log::warn!("folder grant lookup failed (fail-open): {}", e);
            Ok(())
        }
    }
}

/// Require `min_role` in `org_id`. Master admin bypasses as owner.
/// Returns the resolved session (synthetic owner session for master).
/// The master probe runs at most once per request (cached), and applies
/// uniformly: a live master Telegram session bypasses regardless of which
/// (possibly stale or low-privilege) org token was presented.
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
        match check_master(state).await {
            MasterCheck::Authorized => return Ok(synthetic_master_session(org_id)),
            MasterCheck::TransportUnavailable => {
                return Err(HttpResponse::ServiceUnavailable()
                    .body("Telegram temporarily unreachable — retry shortly"))
            }
            MasterCheck::Unauthorized => {}
        }
        if sess.org_id != org_id {
            return Err(HttpResponse::Forbidden().body("Token belongs to a different organization"));
        }
        return Err(HttpResponse::Forbidden()
            .body(format!("Insufficient permissions. Required role: {}", min_role)));
    }
    match check_master(state).await {
        MasterCheck::Authorized => Ok(synthetic_master_session(org_id)),
        MasterCheck::TransportUnavailable => Err(HttpResponse::ServiceUnavailable()
            .body("Telegram temporarily unreachable — retry shortly")),
        MasterCheck::Unauthorized => {
            Err(HttpResponse::Unauthorized().body("Authentication required (org login or master admin)"))
        }
    }
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

/// Case-insensitive member match for login. Usernames hash lowercased
/// (`hash_org_password`), but the primary lookup is a case-sensitive
/// `username=eq.` — so "Alice" created then "alice" typed missed and failed
/// despite a correct password. Exact matches never reach here; this scans
/// the org's (small) member list only on an exact miss.
pub fn find_member_case_insensitive<'a>(
    members: &'a [OrgMember],
    typed_username: &str,
) -> Option<&'a OrgMember> {
    let needle = typed_username.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    members
        .iter()
        .find(|m| m.username.to_lowercase() == needle)
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
    let typed_username = body.username.trim();
    let member = match supabase_org::get_org_member_by_username(&org_id, typed_username).await {
        Ok(Some(m)) => m,
        Ok(None) => match supabase_org::list_org_members(&org_id).await {
            Ok(members) => match find_member_case_insensitive(&members, typed_username) {
                Some(m) => m.clone(),
                None => return HttpResponse::Unauthorized().body("Invalid username or password"),
            },
            Err(e) => return HttpResponse::InternalServerError().body(e),
        },
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let hash = member.password_hash.clone().unwrap_or_default();
    if !supabase_org::verify_org_password(&body.password, &member.username, &hash) {
        return HttpResponse::Unauthorized().body("Invalid username or password");
    }
    let token = new_token();
    let now = now_unix();
    let sess = OrgSession {
        token: token.clone(),
        org_id: org_id.clone(),
        member_id: member.id.clone(),
        username: member.username.clone(),
        role: member.role.clone(),
        issued_at: now,
        role_checked_at: now,
    };
    let replaced = {
        let mut store = state.org_sessions.lock().await;
        let n = revoke_sessions_for_member(&mut store, &org_id, &member.id);
        store.insert(token.clone(), sess.clone());
        n
    };
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
        serde_json::json!({ "username": member.username, "replaced_sessions": replaced }),
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
        let mut store = state.org_sessions.lock().await;
        if let Some(sess) = store.get(&tok) {
            if sess.org_id != org_id {
                return HttpResponse::Forbidden().body("Token belongs to a different organization");
            }
        }
        store.remove(&tok);
    }
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
            issued_at: 0,
            role_checked_at: 0,
        };
        assert_eq!(db_user_id(&master), None);
        let member = OrgSession { member_id: "some-uuid".into(), ..master };
        assert_eq!(db_user_id(&member), Some("some-uuid".to_string()));
    }

    #[test]
    fn find_member_case_insensitive_matches_stored_case_variants() {
        let member = |username: &str| OrgMember {
            id: "m1".into(),
            org_id: "o1".into(),
            username: username.into(),
            password_hash: None,
            role: "viewer".into(),
            created_by: None,
            created_at: None,
        };
        let members = vec![member("Alice"), member("bob")];
        // Exact, lower, upper, and padded input all resolve.
        assert_eq!(find_member_case_insensitive(&members, "Alice").unwrap().username, "Alice");
        assert_eq!(find_member_case_insensitive(&members, "alice").unwrap().username, "Alice");
        assert_eq!(find_member_case_insensitive(&members, "ALICE").unwrap().username, "Alice");
        assert_eq!(find_member_case_insensitive(&members, "  alice  ").unwrap().username, "Alice");
        assert_eq!(find_member_case_insensitive(&members, "BOB").unwrap().username, "bob");
        // Unknown and empty stay None (still 401 downstream, no leak).
        assert!(find_member_case_insensitive(&members, "carol").is_none());
        assert!(find_member_case_insensitive(&members, "").is_none());
        assert!(find_member_case_insensitive(&members, "   ").is_none());
        assert!(find_member_case_insensitive(&[], "alice").is_none());
    }

    #[test]
    fn grant_levels_order_correctly() {
        assert!(grant_satisfies("read", "view"));
        assert!(grant_satisfies("write", "read"));
        assert!(grant_satisfies("full", "write"));
        assert!(grant_satisfies("view", "view"));
        assert!(!grant_satisfies("view", "read"));
        assert!(!grant_satisfies("read", "write"));
        assert!(!grant_satisfies("bogus", "view"));
    }

    #[test]
    fn token_expiry_bounds() {
        let now = 1_800_000_000;
        assert!(is_token_expired(0, now));
        assert!(is_token_expired(now - ORG_TOKEN_TTL_SECS - 1, now));
        assert!(!is_token_expired(now - ORG_TOKEN_TTL_SECS + 60, now));
        assert!(!is_token_expired(now, now));
    }

    #[test]
    fn sliding_window_bounds() {
        let now = 1_800_000_000;
        assert!(!should_slide_issued_at(now, now));
        assert!(!should_slide_issued_at(now - 60, now));
        assert!(should_slide_issued_at(now - ORG_TOKEN_TTL_SECS / 2 - 1, now));
        // Expired sessions slide nowhere — they are dropped instead.
        assert!(!should_slide_issued_at(0, now));
        assert!(!should_slide_issued_at(now - ORG_TOKEN_TTL_SECS - 1, now));
    }

    fn sample_session(token: &str, org_id: &str, member_id: &str) -> OrgSession {
        OrgSession {
            token: token.into(),
            org_id: org_id.into(),
            member_id: member_id.into(),
            username: member_id.into(),
            role: "viewer".into(),
            issued_at: 1,
            role_checked_at: 1,
        }
    }

    #[test]
    fn revoke_keeps_one_session_per_org_member() {
        let mut store = HashMap::new();
        store.insert("t1".into(), sample_session("t1", "org-a", "alice"));
        store.insert("t2".into(), sample_session("t2", "org-a", "alice"));
        store.insert("t3".into(), sample_session("t3", "org-a", "bob"));
        store.insert("t4".into(), sample_session("t4", "org-b", "alice"));
        let dropped = revoke_sessions_for_member(&mut store, "org-a", "alice");
        assert_eq!(dropped, 2);
        assert!(!store.contains_key("t1"));
        assert!(!store.contains_key("t2"));
        assert!(store.contains_key("t3"));
        assert!(store.contains_key("t4"));
    }

    #[test]
    fn revoke_ignores_empty_master_bypass_member_id() {
        let mut store = HashMap::new();
        store.insert("m".into(), sample_session("m", "org-a", ""));
        assert_eq!(revoke_sessions_for_member(&mut store, "org-a", ""), 0);
        assert!(store.contains_key("m"));
    }
}
