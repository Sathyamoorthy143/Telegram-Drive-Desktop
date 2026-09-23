//! Organization CRUD, member management, org settings, org trash, org audit.
//!
//! Master-admin routes (Telegram auth) live under `/api/admin/organizations`.
//! Org-token routes (member auth, viewer+) live under `/api/org/{org_id}/...`
//! and share the same handlers via [`require_org_role`] fallbacks.

use actix_web::{web, HttpRequest, HttpResponse, Responder};

use crate::auth_org::{current_telegram_user_id, is_master_admin, require_master, require_org_role, subdomain_from_req};
use crate::entry_unlock::{evaluate_org_unlock, EntryUnlockError};
use crate::models::{
    CreateMemberRequest, CreateOrgRequest, LogOrgActivityRequest, NewPasswordBody, PasswordBody,
    UpdateOrgRequest, UpdateOrgSettingsRequest,
};
use crate::supabase_org;
use crate::AppState;

fn supabase_unavailable() -> HttpResponse {
    HttpResponse::ServiceUnavailable().body("Supabase not configured (set SUPABASE_URL + key)")
}

fn valid_subdomain(s: &str) -> bool {
    let s = s.trim().to_lowercase();
    !s.is_empty()
        && s.len() <= 63
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

fn valid_role(role: &str) -> bool {
    matches!(role, "viewer" | "editor" | "admin" | "owner")
}

fn is_reserved_slug(s: &str) -> bool {
    let reserved = [
        "files", "settings", "trash", "members", "activity", "admin", "api", "auth",
        "login", "logout", "share", "s", "health", "version", "stream", "preview",
        "thumbnail", "debug", "account", "bandwidth", "folders", "meta", "versions",
    ];
    reserved.contains(&s)
}

// ---- Current-org resolution (frontend boot) ----

/// `GET /api/current-org?subdomain=...` — resolve org from Host header.
/// Returns `{ org: {...} | null, subdomain: string | null }`.
pub async fn current_org(state: web::Data<AppState>, req: HttpRequest, q: web::Query<std::collections::HashMap<String, String>>) -> impl Responder {
    let _ = state;
    let sub = q
        .get("subdomain")
        .cloned()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .or_else(|| subdomain_from_req(&req));
    let Some(sub) = sub else {
        return HttpResponse::Ok().json(serde_json::json!({ "org": null, "subdomain": null }));
    };
    if is_reserved_slug(&sub) {
        return HttpResponse::Ok().json(serde_json::json!({ "org": null, "subdomain": null }));
    }
    if !supabase_org::is_configured() {
        return HttpResponse::Ok().json(serde_json::json!({ "org": null, "subdomain": sub }));
    }
    match supabase_org::get_org_by_subdomain(&sub).await {
        Ok(Some(org)) => HttpResponse::Ok().json(serde_json::json!({ "org": strip_org(&org), "subdomain": sub })),
        // Unknown slug (e.g. the apex domain label) is a normal outcome for
        // this speculative resolver — 200/null, not 404 noise in consoles.
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({ "org": null, "subdomain": sub })),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

fn strip_org(org: &crate::models::Organization) -> serde_json::Value {
    serde_json::json!({
        "id": org.id,
        "name": org.name,
        "subdomain": org.subdomain,
        "active": org.active,
        "created_at": org.created_at,
    })
}

// ---- Master: org CRUD ----

/// `GET /api/admin/organizations`
pub async fn list_organizations(state: web::Data<AppState>) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::list_organizations().await {
        Ok(orgs) => HttpResponse::Ok().json(orgs),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `POST /api/admin/organizations` — create org + empty settings row.
pub async fn create_organization(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateOrgRequest>,
) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let name = body.name.trim();
    let sub = body.subdomain.trim().to_lowercase();
    if name.is_empty() {
        return HttpResponse::BadRequest().body("name is required");
    }
    if !valid_subdomain(&sub) {
        return HttpResponse::BadRequest().body("invalid subdomain (a-z, 0-9, hyphen, max 63 chars)");
    }
    if is_reserved_slug(&sub) {
        return HttpResponse::BadRequest().body("subdomain is reserved and cannot be used as an org slug");
    }
    let entry_password = body.entry_password.trim();
    if entry_password.len() < 4 {
        return HttpResponse::BadRequest().body("entry_password must be at least 4 characters");
    }
    let uid = match current_telegram_user_id(&state).await {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    let uid_s = uid.to_string();
    let org = match supabase_org::create_organization(name, &sub, Some(&uid_s), None).await {
        Ok(o) => o,
        Err(e) => {
            if e.contains("duplicate") || e.contains("unique") || e.contains("409") {
                return HttpResponse::Conflict().body("Subdomain already taken");
            }
            return HttpResponse::InternalServerError().body(e);
        }
    };
    let hash = supabase_org::hash_org_entry_password(entry_password, &org.id);
    let _ = supabase_org::sb_req(
        "PATCH",
        &format!("organizations?id=eq.{}", org.id),
        Some(serde_json::json!({ "entry_password_hash": hash })),
    )
    .await;
    // Initialize empty settings row so later upserts merge cleanly.
    let _ = supabase_org::upsert_org_settings(&org.id, &serde_json::json!({})).await;
    let ip = req.peer_addr().map(|a| a.ip().to_string());
    supabase_org::audit_best_effort(
        &org.id, None, "org.create", "organization", &org.id,
        serde_json::json!({ "name": org.name, "subdomain": org.subdomain }),
        ip, None,
    )
    .await;
    HttpResponse::Ok().json(supabase_org::strip_entry_hash_fields(&org))
}

fn org_unlock_status_response(err: EntryUnlockError) -> HttpResponse {
    match err {
        EntryUnlockError::MissingHash => {
            HttpResponse::Conflict().body("Set an entry password in Organizations first")
        }
        EntryUnlockError::WrongPassword => HttpResponse::Unauthorized().body("Wrong password"),
        EntryUnlockError::Inactive => HttpResponse::Forbidden().body("Organization is inactive"),
        EntryUnlockError::NotOwner => HttpResponse::Forbidden().body("Not the owner of this organization"),
    }
}

pub async fn list_my_organizations(state: web::Data<AppState>) -> impl Responder {
    let uid = match current_telegram_user_id(&state).await {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let uid_s = uid.to_string();
    match supabase_org::list_organizations().await {
        Ok(orgs) => {
            let mut mine: Vec<serde_json::Value> = Vec::new();
            for o in &orgs {
                if !supabase_org::org_visible_to(o, &uid_s) {
                    continue;
                }
                // Legacy org created before ownership tracking: claim it for
                // this Telegram account so it keeps showing up (self-heal).
                if !supabase_org::org_owned_by(o, &uid_s) {
                    let _ = supabase_org::sb_req(
                        "PATCH",
                        &format!("organizations?id=eq.{}", o.id),
                        Some(serde_json::json!({ "master_admin_id": uid_s })),
                    )
                    .await;
                }
                mine.push(supabase_org::strip_entry_hash_fields(o));
            }
            HttpResponse::Ok().json(serde_json::json!({ "orgs": mine }))
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn unlock_organization(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<PasswordBody>,
) -> impl Responder {
    let uid = match current_telegram_user_id(&state).await {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let org_id = path.into_inner();
    let org = match supabase_org::get_org_by_id(&org_id).await {
        Ok(Some(o)) => o,
        Ok(None) => return HttpResponse::NotFound().body("Organization not found"),
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let uid_s = uid.to_string();
    let ip = req.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let key = format!("{}:org:{}", ip, org.id);
    {
        let mut tracker = state.unlock_attempts.lock().await;
        if let Err(retry) = tracker.check(&key) {
            return HttpResponse::TooManyRequests()
                .insert_header(("Retry-After", retry.to_string()))
                .body("Too many attempts — try again shortly");
        }
    }
    match evaluate_org_unlock(
        org.entry_password_hash.as_deref(),
        &body.password,
        &org.id,
        org.active.unwrap_or(true),
        org.master_admin_id.as_deref(),
        &uid_s,
    ) {
        Ok(()) => {
            state.unlock_attempts.lock().await.record(&key, true);
            let ip = req.peer_addr().map(|a| a.ip().to_string());
            supabase_org::audit_best_effort(
                &org.id,
                None,
                "org.unlock",
                "organization",
                &org.id,
                serde_json::json!({ "subdomain": org.subdomain }),
                ip,
                None,
            )
            .await;
            HttpResponse::Ok().json(serde_json::json!({
                "ok": true,
                "org": { "id": org.id, "name": org.name, "subdomain": org.subdomain },
            }))
        }
        Err(e) => {
            state.unlock_attempts.lock().await.record(&key, false);
            org_unlock_status_response(e)
        },
    }
}

pub async fn reset_entry_password(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<NewPasswordBody>,
) -> impl Responder {
    let uid = match current_telegram_user_id(&state).await {
        Ok(id) => id,
        Err(resp) => return resp,
    };
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let new_password = body.new_password.trim();
    if new_password.len() < 4 {
        return HttpResponse::BadRequest().body("new_password must be at least 4 characters");
    }
    let org_id = path.into_inner();
    let org = match supabase_org::get_org_by_id(&org_id).await {
        Ok(Some(o)) => o,
        Ok(None) => return HttpResponse::NotFound().body("Organization not found"),
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let uid_s = uid.to_string();
    match org.master_admin_id.as_deref() {
        Some(owner) if owner != uid_s => {
            return HttpResponse::Forbidden().body("Not the owner of this organization");
        }
        _ => {}
    }
    let hash = supabase_org::hash_org_entry_password(new_password, &org.id);
    // Legacy org without an owner: claim it best-effort, but never let the
    // claim break the password reset. Old deployments type `master_admin_id`
    // as uuid, where a numeric Telegram id is rejected (SQLSTATE 22P02).
    if org.master_admin_id.is_none() {
        let _ = supabase_org::sb_req(
            "PATCH",
            &format!("organizations?id=eq.{}", org.id),
            Some(serde_json::json!({ "master_admin_id": uid_s })),
        )
        .await;
    }
    let patch = serde_json::json!({ "entry_password_hash": hash });
    match supabase_org::sb_req("PATCH", &format!("organizations?id=eq.{}", org.id), Some(patch)).await {
        Ok(resp) if resp.status().is_success() => {
            let ip = req.peer_addr().map(|a| a.ip().to_string());
            supabase_org::audit_best_effort(
                &org.id,
                None,
                "org.entry_password.reset",
                "organization",
                &org.id,
                serde_json::json!({}),
                ip,
                None,
            )
            .await;
            HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
        }
        Ok(resp) => {
            let txt = resp.text().await.unwrap_or_default();
            HttpResponse::InternalServerError().body(txt)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `GET /api/admin/organizations/{id}`
pub async fn get_organization(state: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::get_org_by_id(&path.into_inner()).await {
        Ok(Some(o)) => HttpResponse::Ok().json(o),
        Ok(None) => HttpResponse::NotFound().body("Organization not found"),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `PUT /api/admin/organizations/{id}`
pub async fn update_organization(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UpdateOrgRequest>,
) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let org_id = path.into_inner();
    let mut patch = serde_json::json!({});
    if let Some(n) = &body.name {
        if n.trim().is_empty() {
            return HttpResponse::BadRequest().body("name cannot be empty");
        }
        patch["name"] = serde_json::Value::String(n.trim().to_string());
    }
    if let Some(a) = body.active {
        patch["active"] = serde_json::Value::Bool(a);
    }
    match supabase_org::sb_req(
        "PATCH",
        &format!("organizations?id=eq.{}", org_id),
        Some(patch),
    )
    .await
    {
        Ok(resp) if resp.status().is_success() => HttpResponse::Ok().json(true),
        Ok(resp) => {
            let txt = resp.text().await.unwrap_or_default();
            HttpResponse::InternalServerError().body(txt)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `DELETE /api/admin/organizations/{id}[?hard=true]` — soft-deactivate by
/// default; `hard=true` permanently deletes (cascades to members/trash/audit).
pub async fn delete_organization(
    state: web::Data<AppState>,
    path: web::Path<String>,
    q: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let org_id = path.into_inner();
    let hard = q.get("hard").map(|v| v == "true" || v == "1").unwrap_or(false);
    let res = if hard {
        supabase_org::sb_req("DELETE", &format!("organizations?id=eq.{}", org_id), None).await
    } else {
        supabase_org::sb_req(
            "PATCH",
            &format!("organizations?id=eq.{}", org_id),
            Some(serde_json::json!({ "active": false })),
        )
        .await
    };
    match res {
        Ok(resp) if resp.status().is_success() => HttpResponse::Ok().json(true),
        Ok(resp) => {
            let txt = resp.text().await.unwrap_or_default();
            HttpResponse::InternalServerError().body(txt)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

// ---- Org settings ----

/// `GET /api/admin/organizations/{id}/settings` (master) and
/// `GET /api/org/{id}/settings` (org member, viewer+) share this logic via
/// [`get_org_settings_hdl`]; registered twice in main.rs.
pub async fn get_org_settings_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    let is_admin_path = req.path().starts_with("/api/admin/");
    if is_admin_path {
        if require_master(&state).await.is_err() {
            return HttpResponse::Unauthorized().body("Master admin authentication required");
        }
    } else if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::get_org_settings(&org_id).await {
        Ok(Some(s)) => HttpResponse::Ok().json(s),
        Ok(None) => HttpResponse::Ok().json(serde_json::json!({ "org_id": org_id })),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `PUT` counterpart — master or org admin+.
pub async fn put_org_settings_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<UpdateOrgSettingsRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let is_admin_path = req.path().starts_with("/api/admin/");
    let actor: Option<String>;
    if is_admin_path {
        if require_master(&state).await.is_err() {
            return HttpResponse::Unauthorized().body("Master admin authentication required");
        }
        actor = None;
    } else {
        match require_org_role(&state, &req, &org_id, "admin").await {
            Ok(s) => actor = crate::auth_org::db_user_id(&s),
            Err(e) => return e,
        }
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let mut patch = serde_json::json!({});
    if let Some(v) = body.channel_id {
        patch["channel_id"] = serde_json::json!(v);
    }
    if let Some(v) = body.backup_channel_id {
        patch["backup_channel_id"] = serde_json::json!(v);
    }
    if let Some(v) = &body.lock_pin_hash {
        patch["lock_pin_hash"] = serde_json::json!(v);
    }
    if let Some(v) = body.lock_interval_ms {
        patch["lock_interval_ms"] = serde_json::json!(v);
    }
    if let Some(v) = &body.notification_mode {
        patch["notification_mode"] = serde_json::json!(v);
    }
    match supabase_org::upsert_org_settings(&org_id, &patch).await {
        Ok(s) => {
            supabase_org::audit_best_effort(
                &org_id, actor, "org.settings.update", "org_setting", &org_id,
                patch, None, None,
            )
            .await;
            HttpResponse::Ok().json(s)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

// ---- Folder grants (admin+) ----

#[derive(serde::Deserialize)]
pub struct OrgGrantRequest {
    pub folder_id: i64,
    pub member_id: String,
    pub level: Option<String>,
}

fn valid_grant_level(level: &str) -> bool {
    matches!(level, "view" | "read" | "write" | "full")
}

/// `GET /api/org/{id}/grants` — admin+. List folder grants.
pub async fn list_grants_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "admin").await {
        return e;
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::list_org_grants(&org_id).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `POST /api/org/{id}/grants` — admin+. Create/update a member's level on a folder.
pub async fn upsert_grant_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgGrantRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "admin").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let level = body.level.as_deref().unwrap_or("view");
    if !valid_grant_level(level) {
        return HttpResponse::BadRequest().body("level must be view|read|write|full");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let actor = crate::auth_org::db_user_id(&sess);
    match supabase_org::upsert_org_grant(&org_id, body.folder_id, &body.member_id, level, actor.as_deref()).await {
        Ok(g) => {
            supabase_org::audit_best_effort(
                &org_id, actor, "grant.upsert", "org_folder_grant", &g.id,
                serde_json::json!({ "folder_id": body.folder_id, "member_id": body.member_id, "level": level }),
                None, None,
            )
            .await;
            HttpResponse::Ok().json(g)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `POST /api/org/{id}/grants/delete` — admin+. Remove a grant (falls back to org role).
pub async fn delete_grant_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgGrantRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "admin").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let actor = crate::auth_org::db_user_id(&sess);
    match supabase_org::delete_org_grant(&org_id, body.folder_id, &body.member_id).await {
        Ok(()) => {
            supabase_org::audit_best_effort(
                &org_id, actor, "grant.delete", "org_folder_grant", &body.member_id,
                serde_json::json!({ "folder_id": body.folder_id }),
                None, None,
            )
            .await;
            HttpResponse::Ok().json(true)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

// ---- Org members ----

pub async fn list_members_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    let is_admin_path = req.path().starts_with("/api/admin/");
    if is_admin_path {
        if require_master(&state).await.is_err() {
            return HttpResponse::Unauthorized().body("Master admin authentication required");
        }
    } else if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    // Strip password hashes before returning.
    match supabase_org::list_org_members(&org_id).await {
        Ok(members) => {
            let safe: Vec<serde_json::Value> = members
                .into_iter()
                .map(|m| {
                    serde_json::json!({
                        "id": m.id, "org_id": m.org_id, "username": m.username,
                        "role": m.role, "created_at": m.created_at,
                    })
                })
                .collect();
            HttpResponse::Ok().json(safe)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn create_member_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CreateMemberRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let is_admin_path = req.path().starts_with("/api/admin/");
    let actor: Option<String>;
    if is_admin_path {
        if require_master(&state).await.is_err() {
            return HttpResponse::Unauthorized().body("Master admin authentication required");
        }
        actor = None;
    } else {
        match require_org_role(&state, &req, &org_id, "admin").await {
            Ok(s) => actor = crate::auth_org::db_user_id(&s),
            Err(e) => return e,
        }
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let username = body.username.trim();
    if username.is_empty() || username.len() > 64 {
        return HttpResponse::BadRequest().body("invalid username");
    }
    if body.password.len() < 4 {
        return HttpResponse::BadRequest().body("password must be at least 4 characters");
    }
    let role = body.role.clone().unwrap_or_else(|| "viewer".into());
    if !valid_role(&role) {
        return HttpResponse::BadRequest().body("invalid role (viewer / editor / admin / owner)");
    }
    // Only master/owner may create admin/owner accounts.
    if (role == "admin" || role == "owner") && !is_admin_path {
        if let Ok(sess) = require_org_role(&state, &req, &org_id, "viewer").await {
            if sess.role != "owner" && is_master_admin(&state).await == false {
                return HttpResponse::Forbidden().body("Only owner/master can create admin accounts");
            }
        }
    }
    let hash = supabase_org::hash_org_password(&body.password, username);
    match supabase_org::create_org_member(
        &org_id, username, &hash, &role, actor.as_deref(),
    )
    .await
    {
        Ok(m) => {
            supabase_org::audit_best_effort(
                &org_id, actor, "org.member.create", "org_member", &m.id,
                serde_json::json!({ "username": m.username, "role": m.role }),
                None, None,
            )
            .await;
            HttpResponse::Ok().json(serde_json::json!({
                "id": m.id, "org_id": m.org_id, "username": m.username, "role": m.role,
            }))
        }
        Err(e) => {
            if e.contains("duplicate") || e.contains("unique") || e.contains("409") {
                return HttpResponse::Conflict().body("Username already taken in this org");
            }
            HttpResponse::InternalServerError().body(e)
        }
    }
}

pub async fn delete_member_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<(String, String)>,
) -> impl Responder {
    let (org_id, member_id) = path.into_inner();
    let is_admin_path = req.path().starts_with("/api/admin/");
    let actor: Option<String>;
    if is_admin_path {
        if require_master(&state).await.is_err() {
            return HttpResponse::Unauthorized().body("Master admin authentication required");
        }
        actor = None;
    } else {
        match require_org_role(&state, &req, &org_id, "admin").await {
            Ok(s) => {
                if !s.member_id.is_empty() && s.member_id == member_id {
                    return HttpResponse::BadRequest().body("Cannot delete your own account");
                }
                actor = crate::auth_org::db_user_id(&s);
            }
            Err(e) => return e,
        }
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::delete_org_member(&org_id, &member_id).await {
        Ok(_) => {
            supabase_org::audit_best_effort(
                &org_id, actor, "org.member.delete", "org_member", &member_id,
                serde_json::json!({}), None, None,
            )
            .await;
            HttpResponse::Ok().json(true)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

// ---- Org activity ----

pub async fn list_activity_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    let is_admin_path = req.path().starts_with("/api/admin/");
    if is_admin_path {
        if require_master(&state).await.is_err() {
            return HttpResponse::Unauthorized().body("Master admin authentication required");
        }
    } else if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::list_org_audit(&org_id, 200).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn post_activity_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<LogOrgActivityRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "viewer").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    let ip = req.peer_addr().map(|a| a.ip().to_string());
    let ua = req
        .headers()
        .get(actix_web::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let user_id = crate::auth_org::db_user_id(&sess);
    supabase_org::audit_best_effort(
        &org_id, user_id, &body.action,
        body.target_type.as_deref().unwrap_or(""),
        body.target_id.as_deref().unwrap_or(""),
        body.details.clone().unwrap_or(serde_json::json!({})),
        ip, ua,
    )
    .await;
    HttpResponse::Ok().json(true)
}

async fn alerts_for_org(state: &web::Data<AppState>, org_id: &str) -> HttpResponse {
    let _ = state;
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::list_org_audit(org_id, 50).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `GET /api/org/{id}/alerts` — viewer+. Returns recent audit log entries
/// (last ~50) for toast notifications in the org Dashboard.
pub async fn list_alerts(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    alerts_for_org(&state, &org_id).await
}

/// `GET /api/admin/organizations/{id}/alerts` — master only. Same feed for
/// the cross-org alerts overview.
pub async fn list_alerts_admin_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    let _ = req;
    alerts_for_org(&state, &org_id).await
}

// ---- Org trash (org_trash table; Telegram msg kept until purge) ----

pub async fn list_trash_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::models::LimitQuery>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::list_org_trash(&org_id, Some(crate::models::clamp_limit(query.limit, 500))).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[derive(serde::Deserialize)]
pub struct OrgTrashOp {
    pub message_id: i64,
    pub folder_id: Option<i64>,
}

/// `POST /api/org/{id}/trash/restore` — un-trash (delete row; viewer+ cannot
/// restore without editor).
pub async fn restore_trash_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgTrashOp>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, body.folder_id, "write").await {
        return e;
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    match supabase_org::delete_org_trash_item(&org_id, body.message_id, body.folder_id).await {
        Ok(_) => {
            let uid = crate::auth_org::db_user_id(&sess);
            supabase_org::audit_best_effort(
                &org_id, uid, "file.restore", "file", &body.message_id.to_string(),
                serde_json::json!({ "folder_id": body.folder_id }), None, None,
            )
            .await;
            HttpResponse::Ok().json(true)
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `POST /api/org/{id}/trash/purge` — permanently delete Telegram msg + row.
pub async fn purge_trash_hdl(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgTrashOp>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, body.folder_id, "write").await {
        return e;
    }
    // Best-effort Telegram delete from the org's channel.
    if let Ok(client) = crate::auth::get_client(&state).await {
        let channel = supabase_org::get_org_settings(&org_id)
            .await
            .ok()
            .flatten()
            .and_then(|s| s.channel_id);
        let folder = body.folder_id.or(channel);
        if let Some(fid) = folder {
            if let Ok(peer) = crate::utils::resolve_peer_ref(&client, Some(fid), &state.peer_cache).await {
                let _ = client.delete_messages(peer, &[body.message_id as i32]).await;
            }
        }
    }
    if supabase_org::is_configured() {
        let _ = supabase_org::delete_org_trash_item(&org_id, body.message_id, body.folder_id).await;
    }
    let uid = crate::auth_org::db_user_id(&sess);
    supabase_org::audit_best_effort(
        &org_id, uid, "file.purge", "file", &body.message_id.to_string(),
        serde_json::json!({ "folder_id": body.folder_id }), None, None,
    )
    .await;
    HttpResponse::Ok().json(true)
}

// ---- Per-org storage provisioning ----

/// `POST /api/admin/organizations/{id}/provision` — find-or-create the org's
/// MAIN + BACKUP Telegram channels (unique per-org markers) and persist ids
/// to `org_settings`. Master only.
pub async fn provision_org_storage(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    let org_id = path.into_inner();
    let org_name = if supabase_org::is_configured() {
        supabase_org::get_org_by_id(&org_id)
            .await
            .ok()
            .flatten()
            .map(|o| o.name)
            .unwrap_or_else(|| org_id.clone())
    } else {
        org_id.clone()
    };
    match crate::storage::ensure_storage_for_org(&state, &org_id, &org_name).await {
        Ok((main, backup)) => {
            if supabase_org::is_configured() {
                let _ = supabase_org::upsert_org_settings(
                    &org_id,
                    &serde_json::json!({ "channel_id": main, "backup_channel_id": backup }),
                )
                .await;
            }
            supabase_org::audit_best_effort(
                &org_id, None, "org.provision", "org_setting", &org_id,
                serde_json::json!({ "channel_id": main, "backup_channel_id": backup }),
                None, None,
            )
            .await;
            HttpResponse::Ok().json(serde_json::json!({
                "main_channel_id": main, "backup_channel_id": backup,
            }))
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_slugs_match_frontend_parity_pin() {
        // MUST stay identical to RESERVED_SLUGS in web/frontend/src/orgRouting.ts.
        let mut got = [
            "files", "settings", "trash", "members", "activity", "admin", "api", "auth",
            "login", "logout", "share", "s", "health", "version", "stream", "preview",
            "thumbnail", "debug", "account", "bandwidth", "folders", "meta", "versions",
        ];
        got.sort_unstable();
        let mut probed: Vec<&str> = got.iter().copied().filter(|s| is_reserved_slug(s)).collect();
        probed.sort_unstable();
        assert_eq!(probed, got);
        assert!(!is_reserved_slug("sdpk"));
        assert!(!is_reserved_slug("acme-corp"));
    }

    #[test]
    fn valid_subdomain_rejects_bad_input() {
        assert!(valid_subdomain("acme"));
        assert!(valid_subdomain("acme-corp-1"));
        assert!(!valid_subdomain(""));
        assert!(!valid_subdomain("-acme"));
        assert!(!valid_subdomain("acme-"));
        assert!(!valid_subdomain("ac me"));
        assert!(!valid_subdomain("acme_corp"));
    }
}
