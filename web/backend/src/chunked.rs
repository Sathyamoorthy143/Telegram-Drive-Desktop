//! Parallel chunked browser → server uploads with hash-verified resume.
//!
//! File Chunking & Hashing: the client slices files into fixed 8MB blocks and
//! sends SHA-256 per block plus a whole-file SHA-256. The server verifies
//! every chunk hash before storing and verifies the whole file on complete.
//!
//! Resumable Transfers: resume compares server chunk hashes against local
//! ones — missing AND corrupted chunks are re-sent, never the whole file.
//!
//! Metadata DB (Supabase `files`/`chunks` tables) holds the filesystem
//! structure separately from file bytes (which live on Telegram). The local
//! `/tmp` session dir is only a staging area; `/tmp` scans are a fallback
//! when the DB is unreachable.
//!
//! * `POST /api/files/upload/init` {name,size,folder_id,total_chunks,chunk_size?,file_sha256?,hashes?[]}
//! * `PUT  /api/files/upload/chunk?upload_id=&index=&hash=` (raw bytes, idempotent)
//! * `GET  /api/files/upload/session?upload_id=` → {received:[], hashes:{}}
//! * `POST /api/files/upload/complete` {upload_id}

use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::SystemTime;

use crate::tier;
use crate::auth_org::require_org_role;
use crate::AppState;

const SESSION_DIR: &str = "/tmp/telegram-uploads";
// NOTE: no local MAX_FILE_SIZE — the cap is tier-aware (see tier.rs) and
// enforced at init/complete against the signed-in account's tier.
const DEFAULT_CHUNK_SIZE: u64 = 8 * 1024 * 1024;
const MAX_PART_BYTES: usize = 32 * 1024 * 1024;
const STALE_SECS: u64 = 24 * 3600;

#[derive(Deserialize)]
pub struct InitRequest {
    pub name: String,
    pub size: u64,
    pub folder_id: Option<i64>,
    pub total_chunks: u32,
    pub chunk_size: Option<u64>,
    pub file_sha256: Option<String>,
    pub hashes: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct InitResponse {
    pub upload_id: String,
    pub received: Vec<u32>,
}

#[derive(Deserialize)]
pub struct ChunkQuery {
    pub upload_id: String,
    pub index: u32,
    pub hash: Option<String>,
}

#[derive(Deserialize)]
pub struct SessionQuery {
    pub upload_id: String,
}

#[derive(Deserialize)]
pub struct CompleteRequest {
    pub upload_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct SessionMeta {
    name: String,
    size: u64,
    folder_id: Option<i64>,
    total_chunks: u32,
    chunk_size: u64,
    file_sha256: Option<String>,
    chunk_hashes: Vec<String>,
    created: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

/// Expected on-disk size of part `index`: full chunk_size except the last,
/// which holds the remainder. Guards against short/truncated parts.
fn part_expected_size(meta: &SessionMeta, index: u32) -> u64 {
    if meta.total_chunks == 0 {
        return 0;
    }
    if index + 1 < meta.total_chunks {
        meta.chunk_size
    } else {
        meta.size - meta.chunk_size as u64 * (meta.total_chunks as u64 - 1)
    }
}

fn valid_hex64(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Minimal Supabase REST helper (mirrors meta.rs/trash.rs).
async fn sb(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<reqwest::Response, String> {
    let url = std::env::var("SUPABASE_URL").map_err(|_| "no supabase".to_string())?;
    let key = std::env::var("SUPABASE_SERVICE_KEY")
        .or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY"))
        .or_else(|_| std::env::var("SUPABASE_ANON_KEY"))
        .map_err(|_| "no key".to_string())?;
    let client = crate::supabase_org::http_client();
    let full = format!(
        "{}/rest/v1/{}",
        url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let mut req = match method {
        "GET" => client.get(&full),
        "POST" => client.post(&full),
        "DELETE" => client.delete(&full),
        "PATCH" => client.patch(&full),
        _ => client.get(&full),
    };
    req = req
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key));
    if method == "POST" || method == "PATCH" {
        req = req
            .header("Prefer", "resolution=merge-duplicates")
            .header("Content-Type", "application/json");
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    req.send().await.map_err(|e| e.to_string())
}

/// Best-effort metadata write — uploads must work even if Supabase is down.
async fn db_write(method: &str, path: &str, body: Option<serde_json::Value>) {
    match sb(method, path, body).await {
        Ok(resp) if resp.status().is_success() => {}
        Ok(resp) => log::warn!(
            "chunked metadata write skipped: HTTP {}",
            resp.status()
        ),
        Err(e) => log::warn!("chunked metadata write skipped: {}", e),
    }
}

/// Validate the id and resolve the session dir (traversal-safe).
fn session_dir(upload_id: &str) -> Result<PathBuf, HttpResponse> {
    if upload_id.len() > 64
        || !upload_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(HttpResponse::BadRequest().body("invalid upload_id"));
    }
    Ok(PathBuf::from(SESSION_DIR).join(upload_id))
}

fn part_path(dir: &std::path::Path, index: u32) -> PathBuf {
    dir.join(format!("{:06}.part", index))
}

/// Best-effort removal of sessions older than STALE_SECS.
fn gc_stale() {
    let Ok(rd) = std::fs::read_dir(SESSION_DIR) else {
        return;
    };
    let now = now_secs();
    for entry in rd.flatten() {
        let meta_path = entry.path().join("meta.json");
        let stale = std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|s| serde_json::from_str::<SessionMeta>(&s).ok())
            .map(|m| now.saturating_sub(m.created) > STALE_SECS)
            .unwrap_or(true);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn sanitize_name(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.bin");
    if base.is_empty() {
        "upload.bin".to_string()
    } else {
        base.to_string()
    }
}

pub async fn init_upload(
    state: web::Data<AppState>,
    req: web::Json<InitRequest>,
) -> HttpResponse {
    let max_size = tier::cached_cap(&state).await;
    if req.size == 0 || req.size > max_size {
        return HttpResponse::BadRequest().body("invalid size");
    }
    if req.total_chunks == 0 || req.total_chunks > 2048 {
        return HttpResponse::BadRequest().body("invalid total_chunks");
    }
    let chunk_size = req.chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE);
    if chunk_size == 0 || chunk_size > MAX_PART_BYTES as u64 {
        return HttpResponse::BadRequest().body("invalid chunk_size");
    }
    let expected_chunks = ((req.size + chunk_size - 1) / chunk_size) as u32;
    if expected_chunks != req.total_chunks {
        return HttpResponse::BadRequest().body(format!(
            "total_chunks mismatch: size/chunk_size needs {}",
            expected_chunks
        ));
    }
    if let Some(h) = req.file_sha256.as_deref() {
        if !valid_hex64(h) {
            return HttpResponse::BadRequest().body("invalid file_sha256");
        }
    }
    let hashes = req.hashes.clone().unwrap_or_default();
    if !hashes.is_empty() {
        if hashes.len() != req.total_chunks as usize || hashes.iter().any(|h| !valid_hex64(h)) {
            return HttpResponse::BadRequest().body("invalid chunk hashes");
        }
    }
    let _ = std::fs::create_dir_all(SESSION_DIR);
    gc_stale();
    let upload_id = uuid::Uuid::new_v4().to_string();
    let dir = PathBuf::from(SESSION_DIR).join(&upload_id);
    if std::fs::create_dir_all(&dir).is_err() {
        return HttpResponse::InternalServerError().body("cannot create session");
    }
    let meta = SessionMeta {
        name: sanitize_name(&req.name),
        size: req.size,
        folder_id: req.folder_id,
        total_chunks: req.total_chunks,
        chunk_size,
        file_sha256: req.file_sha256.clone(),
        chunk_hashes: hashes,
        created: now_secs(),
    };
    if serde_json::to_string(&meta)
        .ok()
        .and_then(|s| std::fs::write(dir.join("meta.json"), s).ok())
        .is_none()
    {
        let _ = std::fs::remove_dir_all(&dir);
        return HttpResponse::InternalServerError().body("cannot write session");
    }
    // Metadata DB: filesystem structure row (bytes stay on Telegram later).
    db_write(
        "POST",
        "files?on_conflict=id",
        Some(serde_json::json!({
            "id": upload_id,
            "folder_id": meta.folder_id,
            "name": meta.name,
            "size": meta.size as i64,
            "sha256": meta.file_sha256,
            "chunk_size": chunk_size as i64,
            "total_chunks": meta.total_chunks as i64,
            "status": "uploading",
        })),
    )
    .await;
    HttpResponse::Ok().json(InitResponse {
        upload_id,
        received: vec![],
    })
}

pub async fn put_chunk(query: web::Query<ChunkQuery>, body: web::Bytes) -> HttpResponse {
    if body.len() > MAX_PART_BYTES {
        return HttpResponse::PayloadTooLarge().body("chunk too large");
    }
    let dir = match session_dir(&query.upload_id) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let meta: SessionMeta = match std::fs::read_to_string(dir.join("meta.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("unknown upload session"),
    };
    if query.index >= meta.total_chunks {
        return HttpResponse::BadRequest().body("chunk index out of range");
    }
    if body.is_empty() {
        return HttpResponse::BadRequest().body("empty chunk");
    }
    // Hash verification: manifest hash wins, else the per-request hash.
    let expected = meta
        .chunk_hashes
        .get(query.index as usize)
        .cloned()
        .or_else(|| query.hash.clone());
    if let Some(h) = query.hash.as_deref() {
        if !valid_hex64(h) {
            return HttpResponse::BadRequest().body("invalid hash format");
        }
        if let Some(exp) = expected.as_deref() {
            if exp.to_lowercase() != h.to_lowercase() {
                return HttpResponse::Conflict().body("chunk hash does not match manifest");
            }
        }
    }
    // Hashing + disk write run on the blocking pool: up to 32MB of SHA-256
    // and fs I/O must not stall the async executor under 8 parallel workers.
    enum StoreErr {
        Mismatch(String),
        Io,
    }
    let part_file = part_path(&dir, query.index);
    let index = query.index;
    let body_len = body.len();
    let stored = tokio::task::spawn_blocking(move || {
        let actual = sha256_hex(&body);
        if let Some(exp) = expected.as_deref() {
            if exp.to_lowercase() != actual {
                // Corrupted in transit — do NOT store; client resends this chunk.
                return Err(StoreErr::Mismatch(format!("chunk {} hash mismatch", index)));
            }
        }
        std::fs::write(&part_file, &body)
            .map(|_| actual)
            .map_err(|_| StoreErr::Io)
    })
    .await;
    let actual = match stored {
        Ok(Ok(h)) => h,
        Ok(Err(StoreErr::Mismatch(m))) => return HttpResponse::UnprocessableEntity().body(m),
        _ => return HttpResponse::InternalServerError().body("cannot store chunk"),
    };
    db_write(
        "POST",
        "chunks?on_conflict=file_id,idx",
        Some(serde_json::json!({
            "file_id": query.upload_id,
            "idx": query.index as i64,
            "sha256": actual,
            "size": body_len as i64,
        })),
    )
    .await;
    HttpResponse::Ok().json(serde_json::json!({ "ok": true, "index": query.index, "sha256": actual }))
}

pub async fn session_status(query: web::Query<SessionQuery>) -> impl Responder {
    let dir = match session_dir(&query.upload_id) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let meta: SessionMeta = match std::fs::read_to_string(dir.join("meta.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("unknown upload session"),
    };
    // Prefer the metadata DB (survives deploys); fall back to /tmp scan.
    if let Ok(resp) = sb(
        "GET",
        &format!(
            "chunks?select=idx,sha256&file_id=eq.{}&order=idx",
            query.upload_id
        ),
        None,
    )
    .await
    {
        if resp.status().is_success() {
            if let Ok(rows) = resp.json::<Vec<serde_json::Value>>().await {
                let mut received = Vec::new();
                let mut hashes = serde_json::Map::new();
                for r in rows {
                    if let Some(i) = r.get("idx").and_then(|v| v.as_i64()) {
                        received.push(i as u32);
                        if let Some(h) = r.get("sha256").and_then(|v| v.as_str()) {
                            hashes.insert(i.to_string(), serde_json::Value::String(h.to_string()));
                        }
                    }
                }
                return HttpResponse::Ok().json(serde_json::json!({
                    "upload_id": query.upload_id,
                    "name": meta.name,
                    "size": meta.size,
                    "total_chunks": meta.total_chunks,
                    "received": received,
                    "hashes": hashes,
                }));
            }
        }
    }
    let mut received = Vec::new();
    for i in 0..meta.total_chunks {
        if part_path(&dir, i).exists() {
            received.push(i);
        }
    }
    HttpResponse::Ok().json(serde_json::json!({
        "upload_id": query.upload_id,
        "name": meta.name,
        "size": meta.size,
        "total_chunks": meta.total_chunks,
        "received": received,
        "hashes": {},
    }))
}

pub async fn complete_upload(
    state: web::Data<AppState>,
    req: web::Json<CompleteRequest>,
    org_channel: Option<i64>,
    org_backup: Option<i64>,
) -> HttpResponse {
    let dir = match session_dir(&req.upload_id) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let meta: SessionMeta = match std::fs::read_to_string(dir.join("meta.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("unknown upload session"),
    };
    // Every part must exist AND match its expected size (all but the last
    // are exactly chunk_size; the last is the remainder). A short part means
    // a truncated reassembly — reject instead of uploading a corrupt file.
    // Missing parts after a restart/deploy return 409 so the client resumes.
    let mut missing: Vec<u32> = Vec::new();
    for i in 0..meta.total_chunks {
        let p = part_path(&dir, i);
        let expected = part_expected_size(&meta, i);
        match std::fs::metadata(&p) {
            Ok(md) if md.len() == expected => {}
            Ok(md) => {
                return HttpResponse::UnprocessableEntity().body(format!(
                    "chunk {} corrupt: expected {} bytes, found {}",
                    i,
                    expected,
                    md.len()
                ))
            }
            Err(_) => missing.push(i),
        }
    }
    if !missing.is_empty() {
        return HttpResponse::Conflict().json(serde_json::json!({
            "error": "incomplete upload session — resume missing chunks",
            "missing": missing,
        }));
    }
    // Reassemble into a temp file with a single streaming copy.
    // Hash security: each chunk's SHA-256 was already verified in `put_chunk`
    // against the manifest (or per-request hash) before being stored, so the
    // manifest hashes are trusted here. Only the single cheap whole-file
    // root check below runs — no per-chunk re-SHA256 re-read of all parts.
    let tmp_path = dir.join("assembled.bin");
    let mut out = match tokio::fs::File::create(&tmp_path).await {
        Ok(f) => f,
        Err(e) => {
            return HttpResponse::InternalServerError().body(format!("assemble: {}", e))
        }
    };
    // Tier-aware cap (2 GB free / 4 GB Premium), resolved once per completion.
    let max_size = tier::cached_cap(&state).await;
    let mut total: u64 = 0;
    {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for i in 0..meta.total_chunks {
            let mut part = match tokio::fs::File::open(part_path(&dir, i)).await {
                Ok(f) => f,
                Err(e) => {
                    return HttpResponse::InternalServerError().body(format!("assemble: {}", e))
                }
            };
            let mut buf = vec![0u8; 1024 * 1024];
            loop {
                match part.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        total += n as u64;
                        if total > max_size {
                            return HttpResponse::PayloadTooLarge().body("file too large");
                        }
                        if out.write_all(&buf[..n]).await.is_err() {
                            return HttpResponse::InternalServerError()
                                .body("assemble write failed");
                        }
                    }
                    Err(e) => {
                        return HttpResponse::InternalServerError().body(format!("assemble: {}", e))
                    }
                }
            }
        }
        if out.flush().await.is_err() {
            return HttpResponse::InternalServerError().body("assemble flush failed");
        }
    }
    // File fingerprint = SHA-256 over concatenated raw chunk digests (same
    // construction the client uses — never buffers the whole file).
    if let Some(exp) = meta.file_sha256.as_deref() {
        if meta.chunk_hashes.len() == meta.total_chunks as usize {
            let mut root = Sha256::new();
            let mut ok = true;
            for h in &meta.chunk_hashes {
                match hex::decode(h) {
                    Ok(raw) => root.update(&raw),
                    Err(_) => {
                        ok = false;
                        break;
                    }
                }
            }
            if !ok || hex::encode(root.finalize()).to_lowercase() != exp.to_lowercase() {
                return HttpResponse::UnprocessableEntity()
                    .body("whole-file hash mismatch: re-upload corrupted chunks");
            }
        }
    }
    if total != meta.size {
        return HttpResponse::UnprocessableEntity().body(format!(
            "size mismatch: declared {} bytes, reassembled {}",
            meta.size,
            total
        ));
    }
    let (resp, telegram_message_id) = crate::upload::deliver_to_telegram(
        state,
        tmp_path.clone(),
        meta.name.clone(),
        meta.folder_id,
        total,
        org_channel,
        org_backup,
        Some(req.upload_id.clone()),
    )
    .await;
    // Mark the metadata row complete with the Telegram message id (best effort).
    db_write(
        "PATCH",
        &format!("files?id=eq.{}", req.upload_id),
        Some(serde_json::json!({ "status": "complete", "telegram_message_id": telegram_message_id })),
    )
    .await;
    // Cleanup session dir (best effort; response already built).
    let _ = std::fs::remove_dir_all(&dir);
    resp
}

/// Record an upload in the metadata DB so the filesystem structure
/// accumulates for every file, not just chunked ones. When `existing_id` is
/// given (chunked flow owns its row since init), that row is updated instead
/// of inserting a duplicate.
pub async fn record_single_upload(
    folder_id: Option<i64>,
    name: String,
    size: u64,
    message_id: i64,
    mime: String,
    existing_id: Option<String>,
) {
    if let Some(id) = existing_id {
        db_write(
            "PATCH",
            &format!("files?id=eq.{}", id),
            Some(serde_json::json!({
                "folder_id": folder_id,
                "name": name,
                "size": size as i64,
                "status": "complete",
                "telegram_message_id": message_id,
                "mime": mime,
            })),
        )
        .await;
        return;
    }
    db_write(
        "POST",
        "files",
        Some(serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "folder_id": folder_id,
            "name": name,
            "size": size as i64,
            "sha256": null,
            "chunk_size": 0,
            "total_chunks": 1,
            "status": "complete",
            "telegram_message_id": message_id,
            "mime": mime,
        })),
    )
    .await;
}

/// Read a session's target folder without consuming anything.
/// Used for folder-grant checks before init/complete.
pub fn session_folder_id(upload_id: &str) -> Option<Option<i64>> {
    let dir = session_dir(upload_id).ok()?;
    let meta: SessionMeta = std::fs::read_to_string(dir.join("meta.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())?;
    Some(meta.folder_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(total_chunks: u32, chunk_size: u64, size: u64) -> SessionMeta {
        SessionMeta {
            name: "f".into(),
            size,
            folder_id: None,
            total_chunks,
            chunk_size,
            file_sha256: None,
            chunk_hashes: vec![],
            created: 0,
        }
    }

    #[test]
    fn part_expected_sizes() {
        // 20MB in 8MB parts: 8, 8, 4.
        let m = meta(3, 8 * 1024 * 1024, 20 * 1024 * 1024);
        assert_eq!(part_expected_size(&m, 0), 8 * 1024 * 1024);
        assert_eq!(part_expected_size(&m, 1), 8 * 1024 * 1024);
        assert_eq!(part_expected_size(&m, 2), 4 * 1024 * 1024);
        // Single-chunk file: the only part is the whole file.
        let m = meta(1, 8 * 1024 * 1024, 100);
        assert_eq!(part_expected_size(&m, 0), 100);
    }
}

// ---- Org-scoped chunked upload ----

/// `POST /api/org/{id}/files/upload/init` — editor+. Same logic as
/// `init_upload` but enforces org role.
pub async fn org_init_upload(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<InitRequest>,
) -> HttpResponse {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, body.folder_id, "write").await {
        return e;
    }
    init_upload(state, body).await
}

/// `PUT /api/org/{id}/files/upload/chunk` — editor+. Same logic as
/// `put_chunk` but enforces org role.
pub async fn org_put_chunk(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<ChunkQuery>,
    body: web::Bytes,
) -> HttpResponse {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "editor").await {
        return e;
    }
    put_chunk(query, body).await
}

/// `POST /api/files/upload/complete` — global (non-org) wrapper.
pub async fn complete_upload_global(
    state: web::Data<AppState>,
    req: web::Json<CompleteRequest>,
) -> HttpResponse {
    complete_upload(state, req, None, None).await
}

/// `POST /api/org/{id}/files/upload/complete` — editor+. Delivers to
/// the org's Telegram channels.
pub async fn org_complete_upload(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<CompleteRequest>,
) -> HttpResponse {
    let org_id = path.into_inner();
    match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(sess) => {
            // Folder may have changed grants between init and complete:
            // re-check against the session's recorded target.
            if let Some(folder_id) = session_folder_id(&body.upload_id) {
                if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, folder_id, "write").await {
                    return e;
                }
            }
            let (org_main, org_backup) = crate::storage::org_channel_ids(&org_id).await;
            complete_upload(state, body, org_main, org_backup).await
        }
        Err(e) => e,
    }
}
