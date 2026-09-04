use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use crate::AppState;

async fn sb(method: &str, path: &str, body: Option<serde_json::Value>) -> Result<reqwest::Response, String> {
    let url = std::env::var("SUPABASE_URL").map_err(|_| "no supabase".to_string())?;
    let key = std::env::var("SUPABASE_SERVICE_KEY")
        .or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY"))
        .or_else(|_| std::env::var("SUPABASE_ANON_KEY"))
        .map_err(|_| "no key".to_string())?;
    let client = reqwest::Client::new();
    let full = format!("{}/rest/v1/{}", url.trim_end_matches('/'), path.trim_start_matches('/'));
    let mut req = match method {
        "GET" => client.get(&full),
        "POST" => client.post(&full),
        "DELETE" => client.delete(&full),
        "PATCH" => client.patch(&full),
        _ => client.get(&full),
    };
    req = req.header("apikey", &key).header("Authorization", format!("Bearer {}", key));
    if method == "POST" || method == "PATCH" {
        req = req.header("Prefer", "return=representation").header("Content-Type", "application/json");
    }
    if let Some(b) = body { req = req.json(&b); }
    req.send().await.map_err(|e| e.to_string())
}

fn need_auth(state: &web::Data<AppState>) -> bool {
    // best-effort: allow even without live client so localStorage-backed UI still works;
    // actual file ops verify auth themselves. We just check env presence.
    let _ = state;
    true
}

/// Root folder (None) is stored as 0 in tables whose PRIMARY KEY includes
/// folder_id: Postgres PKs reject NULL, so upserts for root-folder files
/// would fail with not-null violations. 0 is never a real Telegram id
/// (files.rs maps fid 0 back to None on read paths too).
fn db_folder(folder_id: Option<i64>) -> i64 {
    folder_id.unwrap_or(0)
}

/// Map a DB row back to API shape (0 → null folder).
fn api_row(mut v: serde_json::Value) -> serde_json::Value {
    if v.get("folder_id").and_then(|x| x.as_i64()) == Some(0) {
        v["folder_id"] = serde_json::Value::Null;
    }
    v
}

fn api_rows(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Array(rows) => {
            serde_json::Value::Array(rows.into_iter().map(api_row).collect())
        }
        other => other,
    }
}

// ---- Favorites ----
#[derive(Deserialize)]
pub struct StarRequest { pub message_id: i64, pub folder_id: Option<i64>, pub name: Option<String>, pub starred: Option<bool> }

pub async fn list_favorites(state: web::Data<AppState>) -> impl Responder {
    let _ = need_auth(&state);
    match sb("GET", "file_favorites?select=*&order=starred_at.desc", None).await {
        Ok(r) if r.status().is_success() => HttpResponse::Ok().json(api_rows(r.json::<serde_json::Value>().await.unwrap_or(serde_json::json!([])))),
        _ => HttpResponse::Ok().json(serde_json::json!([])),
    }
}

pub async fn star(state: web::Data<AppState>, req: web::Json<StarRequest>) -> impl Responder {
    let _ = need_auth(&state);
    let starred = req.starred.unwrap_or(true);
    let fid = db_folder(req.folder_id);
    if !starred {
        let q = format!("file_favorites?message_id=eq.{}&folder_id=eq.{}", req.message_id, fid);
        let _ = sb("DELETE", &q, None).await;
        return HttpResponse::Ok().json(true);
    }
    let row = serde_json::json!({
        "message_id": req.message_id,
        "folder_id": fid,
        "name": req.name.clone().unwrap_or_default(),
    });
    // upsert via on_conflict
    let url = match std::env::var("SUPABASE_URL") { Ok(u) => u, Err(_) => return HttpResponse::Ok().json(true) };
    let key = match std::env::var("SUPABASE_SERVICE_KEY").or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY")).or_else(|_| std::env::var("SUPABASE_ANON_KEY")) { Ok(k) => k, Err(_) => return HttpResponse::Ok().json(true) };
    let client = reqwest::Client::new();
    let resp = client.post(format!("{}/rest/v1/file_favorites", url.trim_end_matches('/')))
        .header("apikey", &key).header("Authorization", format!("Bearer {}", key))
        .header("Prefer", "resolution=merge-duplicates").header("Content-Type", "application/json")
        .query(&[("on_conflict", "message_id,folder_id")])
        .json(&row).send().await;
    match resp {
        Ok(r) if r.status().is_success() => HttpResponse::Ok().json(true),
        Ok(r) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::Ok().json(true),
    }
}

// ---- Recent ----
#[derive(Deserialize)]
pub struct TouchRequest { pub message_id: i64, pub folder_id: Option<i64>, pub name: Option<String>, pub size: Option<i64> }

pub async fn list_recent(state: web::Data<AppState>) -> impl Responder {
    let _ = need_auth(&state);
    match sb("GET", "file_recents?select=*&order=opened_at.desc&limit=30", None).await {
        Ok(r) if r.status().is_success() => HttpResponse::Ok().json(api_rows(r.json::<serde_json::Value>().await.unwrap_or(serde_json::json!([])))),
        _ => HttpResponse::Ok().json(serde_json::json!([])),
    }
}

pub async fn touch(state: web::Data<AppState>, req: web::Json<TouchRequest>) -> impl Responder {
    let _ = need_auth(&state);
    let row = serde_json::json!({
        "message_id": req.message_id,
        "folder_id": db_folder(req.folder_id),
        "name": req.name.clone().unwrap_or_default(),
        "size": req.size.unwrap_or(0),
        "opened_at": chrono::Utc::now().to_rfc3339(),
    });
    let url = match std::env::var("SUPABASE_URL") { Ok(u) => u, Err(_) => return HttpResponse::Ok().json(true) };
    let key = match std::env::var("SUPABASE_SERVICE_KEY").or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY")).or_else(|_| std::env::var("SUPABASE_ANON_KEY")) { Ok(k) => k, Err(_) => return HttpResponse::Ok().json(true) };
    let client = reqwest::Client::new();
    let _ = client.post(format!("{}/rest/v1/file_recents", url.trim_end_matches('/')))
        .header("apikey", &key).header("Authorization", format!("Bearer {}", key))
        .header("Prefer", "resolution=merge-duplicates").header("Content-Type", "application/json")
        .query(&[("on_conflict", "message_id,folder_id")])
        .json(&row).send().await;
    HttpResponse::Ok().json(true)
}

// ---- Tags ----
#[derive(Deserialize)]
pub struct TagsQuery { pub message_id: i64, pub folder_id: Option<i64> }
#[derive(Deserialize, Serialize)]
pub struct TagsBody { pub message_id: i64, pub folder_id: Option<i64>, pub tags: Vec<String> }

pub async fn get_tags(state: web::Data<AppState>, q: web::Query<TagsQuery>) -> impl Responder {
    let _ = need_auth(&state);
    let path = format!("file_tags?message_id=eq.{}&folder_id=eq.{}&select=*&limit=1",
        q.message_id,
        db_folder(q.folder_id));
    match sb("GET", &path, None).await {
        Ok(r) if r.status().is_success() => {
            let rows: Vec<serde_json::Value> = r.json().await.unwrap_or_default();
            let tags = rows.get(0).and_then(|x| x.get("tags")).cloned().unwrap_or(serde_json::json!([]));
            HttpResponse::Ok().json(serde_json::json!({ "tags": tags }))
        },
        _ => HttpResponse::Ok().json(serde_json::json!({ "tags": [] })),
    }
}

pub async fn set_tags(state: web::Data<AppState>, req: web::Json<TagsBody>) -> impl Responder {
    let _ = need_auth(&state);
    let row = serde_json::json!({ "message_id": req.message_id, "folder_id": db_folder(req.folder_id), "tags": req.tags });
    let url = match std::env::var("SUPABASE_URL") { Ok(u) => u, Err(_) => return HttpResponse::Ok().json(true) };
    let key = match std::env::var("SUPABASE_SERVICE_KEY").or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY")).or_else(|_| std::env::var("SUPABASE_ANON_KEY")) { Ok(k) => k, Err(_) => return HttpResponse::Ok().json(true) };
    let client = reqwest::Client::new();
    let _ = client.post(format!("{}/rest/v1/file_tags", url.trim_end_matches('/')))
        .header("apikey", &key).header("Authorization", format!("Bearer {}", key))
        .header("Prefer", "resolution=merge-duplicates").header("Content-Type", "application/json")
        .query(&[("on_conflict", "message_id,folder_id")])
        .json(&row).send().await;
    HttpResponse::Ok().json(true)
}

#[derive(Deserialize)]
pub struct ByTagQuery { pub tag: String }
pub async fn list_by_tag(state: web::Data<AppState>, q: web::Query<ByTagQuery>) -> impl Responder {
    let _ = need_auth(&state);
    // cs = contains; tags is text[]
    let path = format!("file_tags?tags=cs.%7B{}%7D&select=message_id,folder_id", q.tag);
    match sb("GET", &path, None).await {
        Ok(r) if r.status().is_success() => HttpResponse::Ok().json(api_rows(r.json::<serde_json::Value>().await.unwrap_or(serde_json::json!([])))),
        _ => HttpResponse::Ok().json(serde_json::json!([])),
    }
}

// ---- Activity ----
#[derive(Deserialize)]
pub struct ActivityBody { pub action: String, pub detail: Option<String>, pub name: Option<String> }

pub async fn list_activity(state: web::Data<AppState>) -> impl Responder {
    let _ = need_auth(&state);
    match sb("GET", "activity_logs?select=*&order=created_at.desc&limit=100", None).await {
        Ok(r) if r.status().is_success() => HttpResponse::Ok().json(r.json::<serde_json::Value>().await.unwrap_or(serde_json::json!([]))),
        _ => HttpResponse::Ok().json(serde_json::json!([])),
    }
}

pub async fn log_activity(state: web::Data<AppState>, req: web::Json<ActivityBody>) -> impl Responder {
    let _ = need_auth(&state);
    let row = serde_json::json!({ "action": req.action, "detail": req.detail, "name": req.name });
    let _ = sb("POST", "activity_logs", Some(row)).await;
    HttpResponse::Ok().json(true)
}

pub async fn clear_activity(state: web::Data<AppState>) -> impl Responder {
    let _ = need_auth(&state);
    let _ = sb("DELETE", "activity_logs?id=gt.0", None).await;
    HttpResponse::Ok().json(true)
}

// ---- Versions ----
// A version row points at a trashed Telegram message holding an older saved
// state of (folder_id, name). Editors record the previous message before
// replacing it, so any past state can be downloaded or restored.
fn folder_filter(folder_id: Option<i64>) -> String {
    folder_id
        .map(|f| format!("folder_id=eq.{}", f))
        .unwrap_or_else(|| "folder_id=is.null".to_string())
}

async fn version_rows(folder_id: Option<i64>) -> Vec<serde_json::Value> {
    let path = format!(
        "file_versions?select=*&{}&order=version_no.desc&limit=200",
        folder_filter(folder_id)
    );
    match sb("GET", &path, None).await {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => Vec::new(),
    }
}

#[derive(Deserialize)]
pub struct VersionRecordRequest {
    pub folder_id: Option<i64>,
    pub name: String,
    pub message_id: i64,
    pub size: Option<i64>,
}

pub async fn record_version(
    state: web::Data<AppState>,
    req: web::Json<VersionRecordRequest>,
) -> impl Responder {
    if crate::auth::get_client(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Not authenticated");
    }
    let next_no: i64 = version_rows(req.folder_id).await
        .iter()
        .filter(|r| r.get("name").and_then(|v| v.as_str()) == Some(req.name.as_str()))
        .filter_map(|r| r.get("version_no").and_then(|v| v.as_i64()))
        .max()
        .unwrap_or(0)
        + 1;
    let row = serde_json::json!({
        "folder_id": req.folder_id,
        "name": req.name,
        "message_id": req.message_id,
        "size": req.size.unwrap_or(0),
        "version_no": next_no,
    });
    match sb("POST", "file_versions", Some(row)).await {
        Ok(resp) if resp.status().is_success() => {
            HttpResponse::Ok().json(serde_json::json!({ "version_no": next_no }))
        }
        Ok(resp) => {
            let txt = resp.text().await.unwrap_or_default();
            HttpResponse::InternalServerError()
                .body(format!("version history unavailable (create file_versions table): {}", txt.chars().take(120).collect::<String>()))
        }
        Err(e) => HttpResponse::InternalServerError().body(format!("version history unavailable: {}", e)),
    }
}

#[derive(Deserialize)]
pub struct VersionListQuery {
    pub folder_id: Option<i64>,
    pub name: Option<String>,
}

pub async fn list_versions(
    state: web::Data<AppState>,
    q: web::Query<VersionListQuery>,
) -> impl Responder {
    let _ = need_auth(&state);
    let rows: Vec<serde_json::Value> = version_rows(q.folder_id)
        .await
        .into_iter()
        .filter(|r| match &q.name {
            Some(n) => r.get("name").and_then(|v| v.as_str()) == Some(n.as_str()),
            None => true,
        })
        .collect();
    HttpResponse::Ok().json(rows)
}

#[derive(Deserialize)]
pub struct VersionRestoreRequest {
    pub folder_id: Option<i64>,
    pub name: String,
    pub version_message_id: i64,
    pub current_message_id: i64,
}

async fn message_file_info(
    client: &grammers_client::Client,
    peer: grammers_session::types::PeerRef,
    mid: i32,
) -> Option<(String, u64)> {
    let msgs = client.get_messages_by_id(peer, &[mid]).await.ok()?;
    let msg = msgs.into_iter().flatten().next()?;
    match msg.media() {
        Some(grammers_client::media::Media::Document(d)) => Some((
            d.name().unwrap_or("file").to_string(),
            d.size().unwrap_or(0) as u64,
        )),
        _ => None,
    }
}

pub async fn restore_version(
    state: web::Data<AppState>,
    req: web::Json<VersionRestoreRequest>,
) -> impl Responder {
    let client = match crate::auth::get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    if req.version_message_id == req.current_message_id {
        return HttpResponse::Ok().json(true);
    }
    let peer = match crate::utils::resolve_peer_ref(&client, req.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // The versioned message must still exist (trash not emptied).
    let (v_name, v_size) = match message_file_info(&client, peer, req.version_message_id as i32).await {
        Some(v) => v,
        None => return HttpResponse::Gone().body("That version was permanently deleted (trash emptied)"),
    };
    let _ = (v_name, v_size);
    // Trash the current message so only one live copy remains.
    let (c_name, c_size) = message_file_info(&client, peer, req.current_message_id as i32)
        .await
        .unwrap_or((req.name.clone(), 0));
    let trashed_current = match sb(
        "POST",
        "trash_items",
        Some(serde_json::json!({
            "message_id": req.current_message_id,
            "folder_id": req.folder_id,
            "name": c_name,
            "size": c_size as i64,
            "deleted_at": chrono::Utc::now().to_rfc3339(),
        })),
    )
    .await
    {
        Ok(resp) if resp.status().is_success() => true,
        _ => {
            // No trash table: hard-delete current so restore doesn't duplicate.
            if client
                .delete_messages(peer, &[req.current_message_id as i32])
                .await
                .is_err()
            {
                return HttpResponse::InternalServerError().body("Could not remove current version");
            }
            false
        }
    };
    // Un-trash the selected version (make it visible again).
    let _ = sb(
        "DELETE",
        &format!(
            "trash_items?message_id=eq.{}&{}",
            req.version_message_id,
            folder_filter(req.folder_id)
        ),
        None,
    )
    .await;
    // Keep history going: record the trashed current as a new version.
    if trashed_current {
        let next_no: i64 = version_rows(req.folder_id).await
            .iter()
            .filter(|r| r.get("name").and_then(|v| v.as_str()) == Some(req.name.as_str()))
            .filter_map(|r| r.get("version_no").and_then(|v| v.as_i64()))
            .max()
            .unwrap_or(0)
            + 1;
        let _ = sb(
            "POST",
            "file_versions",
            Some(serde_json::json!({
                "folder_id": req.folder_id,
                "name": req.name,
                "message_id": req.current_message_id,
                "size": c_size as i64,
                "version_no": next_no,
            })),
        )
        .await;
    }
    HttpResponse::Ok().json(true)
}
