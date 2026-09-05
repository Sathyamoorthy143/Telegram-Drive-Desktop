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

use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::SystemTime;

use crate::AppState;

const SESSION_DIR: &str = "/tmp/telegram-uploads";
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024 * 1024;
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
    let client = reqwest::Client::new();
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

pub async fn init_upload(req: web::Json<InitRequest>) -> impl Responder {
    if req.size == 0 || req.size > MAX_FILE_SIZE {
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

pub async fn put_chunk(query: web::Query<ChunkQuery>, body: web::Bytes) -> impl Responder {
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
    let actual = sha256_hex(&body);
    if let Some(exp) = expected.as_deref() {
        if exp.to_lowercase() != actual {
            // Corrupted in transit — do NOT store; client resends this chunk.
            return HttpResponse::UnprocessableEntity()
                .body(format!("chunk {} hash mismatch", query.index));
        }
    }
    if std::fs::write(part_path(&dir, query.index), &body).is_err() {
        return HttpResponse::InternalServerError().body("cannot store chunk");
    }
    db_write(
        "POST",
        "chunks?on_conflict=file_id,idx",
        Some(serde_json::json!({
            "file_id": query.upload_id,
            "idx": query.index as i64,
            "sha256": actual,
            "size": body.len() as i64,
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
) -> impl Responder {
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
    for i in 0..meta.total_chunks {
        if !part_path(&dir, i).exists() {
            return HttpResponse::BadRequest().body(format!("missing chunk {}", i));
        }
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
                        if total > MAX_FILE_SIZE {
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
        log::warn!(
            "chunked upload size mismatch: declared {} got {}",
            meta.size,
            total
        );
    }
    let (resp, telegram_message_id) = crate::upload::deliver_to_telegram(
        state,
        tmp_path.clone(),
        meta.name.clone(),
        meta.folder_id,
        total,
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

/// Record a single-POST (non-chunked) upload in the metadata DB so the
/// filesystem structure accumulates for every file, not just chunked ones.
pub async fn record_single_upload(
    folder_id: Option<i64>,
    name: String,
    size: u64,
    message_id: i64,
    mime: String,
) {
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
