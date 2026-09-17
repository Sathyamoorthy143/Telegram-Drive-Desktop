use actix_multipart::Multipart;
use actix_web::{web, HttpResponse};
use futures::StreamExt;
use grammers_client::message::InputMessage;
use grammers_client::media::Media;
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::auth::get_client;
use crate::models::*;
use crate::tier;
use crate::utils::resolve_peer_ref;
use crate::AppState;

/// Parsed single-file multipart upload. `_tmp_dir` must stay alive until the
/// file has been delivered — dropping it deletes the staged bytes.
pub struct SingleUpload {
    pub file_name: String,
    pub tmp_path: std::path::PathBuf,
    pub total_size: u64,
    pub folder_id: Option<i64>,
    pub _tmp_dir: tempfile::TempDir,
}

/// Shared single-file multipart parser (global + org uploads).
/// Field order is irrelevant: everything is collected first, consumed after
/// the loop — a `folder_id` arriving after `file` is still honored.
pub async fn read_single_upload(
    mut payload: Multipart,
    max_size: u64,
) -> Result<SingleUpload, HttpResponse> {
    // NOTE: each field's body MUST be consumed inline. Storing a Field and
    // polling the parent Multipart for the next part deadlocks (bounded
    // internal channel fills, parser stalls) and the request hangs forever.
    let mut folder_id: Option<i64> = None;
    let mut file_name: Option<String> = None;
    let mut total_size: u64 = 0;
    let tmp_dir = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => {
            return Err(HttpResponse::InternalServerError()
                .body(format!("Failed to create temp dir: {}", e)))
        }
    };
    let mut tmp_file: Option<fs::File> = None;
    let mut tmp_path: Option<std::path::PathBuf> = None;
    let mut got_file = false;

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => return Err(HttpResponse::BadRequest().body(format!("Multipart error: {}", e))),
        };

        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "folder_id" => {
                let mut val = Vec::new();
                while let Some(chunk) = field.next().await {
                    if let Ok(b) = chunk {
                        val.extend_from_slice(&b);
                    }
                }
                folder_id = String::from_utf8(val)
                    .ok()
                    .and_then(|s| s.parse::<i64>().ok());
            }
            "file" => {
                got_file = true;
                let raw_name = field
                    .content_disposition()
                    .and_then(|cd| cd.get_filename().map(|s| s.to_string()))
                    .unwrap_or_else(|| "upload.bin".to_string());
                // Strip any directory components the browser may include.
                let safe_name = Path::new(&raw_name)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .filter(|s| !s.is_empty() && s != ".")
                    .unwrap_or_else(|| "upload.bin".to_string());
                file_name = Some(safe_name.clone());
                log::info!("Upload started: {} for folder {:?}", safe_name, folder_id);
                let path = tmp_dir.path().join(&safe_name);
                let f = match fs::File::create(&path).await {
                    Ok(f) => f,
                    Err(e) => {
                        return Err(HttpResponse::InternalServerError()
                            .body(format!("Failed to create temp file: {}", e)))
                    }
                };
                tmp_path = Some(path);
                let mut tf = f;
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(data) => {
                            total_size += data.len() as u64;
                            if total_size > max_size {
                                return Err(HttpResponse::PayloadTooLarge()
                                    .body(format!("File too large. Max: {} bytes", max_size)));
                            }
                            if let Err(e) = tf.write_all(&data).await {
                                return Err(HttpResponse::InternalServerError()
                                    .body(format!("Write error: {}", e)));
                            }
                        }
                        Err(e) => {
                            return Err(HttpResponse::InternalServerError()
                                .body(format!("Upload read error: {}", e)));
                        }
                    }
                }
                tmp_file = Some(tf);
            }
            _ => {
                // Drain unknown fields so the stream keeps moving.
                while let Some(chunk) = field.next().await {
                    if chunk.is_err() {
                        break;
                    }
                }
            }
        }
    }

    if !got_file {
        return Err(HttpResponse::BadRequest().body("No file field in upload"));
    }

    let fname = file_name.unwrap_or_else(|| "upload.bin".to_string());
    let tmp_path = match tmp_path {
        Some(p) => p,
        None => return Err(HttpResponse::InternalServerError().body("Temp file missing")),
    };
    let mut tmp_file = match tmp_file {
        Some(f) => f,
        None => return Err(HttpResponse::InternalServerError().body("Temp file missing")),
    };
    // Ensure all bytes are flushed to disk before re-opening for Telegram upload.
    if let Err(e) = tmp_file.flush().await {
        return Err(HttpResponse::InternalServerError().body(format!("Flush error: {}", e)));
    }
    drop(tmp_file);

    log::info!(
        "Upload received {} bytes for '{}', uploading to Telegram...",
        total_size,
        fname
    );

    Ok(SingleUpload {
        file_name: fname,
        tmp_path,
        total_size,
        folder_id,
        _tmp_dir: tmp_dir,
    })
}

/// Multipart upload endpoint — receives file chunks and uploads to Telegram.
/// Streams to a temp file, then uploads. The size cap is tier-aware
/// (2 GB free / 4 GB Premium, enforced server-side by Telegram).
pub async fn upload_file(
    state: web::Data<AppState>,
    payload: Multipart,
) -> impl actix_web::Responder {
    // Tier-aware cap (2 GB free / 4 GB Premium), resolved once per upload.
    let max_size = tier::current_cap(&state).await;
    let up = match read_single_upload(payload, max_size).await {
        Ok(u) => u,
        Err(e) => return e,
    };
    let (resp, _msg_id) = deliver_to_telegram(
        state,
        up.tmp_path.clone(),
        up.file_name.clone(),
        up.folder_id,
        up.total_size,
        None,
        None,
        None,
    )
    .await;

    // Cleanup temp file (staged bytes vanish with `_tmp_dir` on return).
    let _ = fs::remove_file(&up.tmp_path).await;
    resp
}

/// Shared Telegram pipeline: auth check → resolve peer → parallel upload →
/// send message → backup → metadata response. Used by both the single-POST
/// upload and the chunked-upload `complete` path.
/// Returns the HTTP response plus the Telegram message id (for metadata rows).
pub async fn deliver_to_telegram(
    state: web::Data<AppState>,
    tmp_path: std::path::PathBuf,
    fname: String,
    folder_id: Option<i64>,
    total_size: u64,
    org_channel: Option<i64>,
    org_backup: Option<i64>,
    existing_id: Option<String>,
) -> (HttpResponse, Option<i64>) {
    // Get the Telegram client - quick auth check, don't hang on invalid session
    let client = match tokio::time::timeout(std::time::Duration::from_secs(5), get_client(&state)).await {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => return (HttpResponse::Unauthorized().body(format!("Not authenticated: {}", e)), None),
        Err(_) => return (HttpResponse::RequestTimeout().body("Telegram client timeout - check API ID/Hash and login"), None),
    };
    // Verify client is actually logged in (quick check, 5s timeout)
    match tokio::time::timeout(std::time::Duration::from_secs(5), client.get_me()).await {
        Ok(Ok(_)) => {},
        Ok(Err(e)) => return (HttpResponse::Unauthorized().body(format!("Telegram not logged in: {}. Please re-login.", e)), None),
        Err(_) => return (HttpResponse::RequestTimeout().body("Telegram auth check timeout"), None),
    }

    // Resolve the target peer: org channel (when provided), folder channel,
    // MAIN storage channel for unfiled uploads (once provisioned), else
    // Saved Messages (legacy).
    let target = org_channel.or(folder_id).or(crate::storage::main_id(&state));
    log::info!("Upload stage: resolve_peer folder_id={:?} target={:?}", folder_id, target);
    let peer = match tokio::time::timeout(
        std::time::Duration::from_secs(20),
        resolve_peer_ref(&client, target, &state.peer_cache),
    )
    .await
    {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return (HttpResponse::InternalServerError().body(format!("stage=resolve_peer: {}", e)), None),
        Err(_) => return (HttpResponse::RequestTimeout().body("stage=resolve_peer timeout (20s)"), None),
    };
    log::info!("Upload stage: resolve_peer done");

    // Tier-aware parallelism (cached verdict, ~1 RPC per 10 min max).
    let workers = crate::fast_transfer::worker_count_for(crate::tier::premium_cached(&state).await);
    // Upload to Telegram with parallel parts (sliding window over N workers).
    // total_size was counted while streaming the request body to disk.
    log::info!(
        "Upload stage: telegram-upload size={} name={} workers={}",
        total_size, fname, workers
    );
    let uploaded = match tokio::time::timeout(
        std::time::Duration::from_secs(1800),
        crate::fast_transfer::upload_file_parallel(&client, &tmp_path, total_size, fname.clone(), workers),
    )
    .await
    {
        Ok(Ok(u)) => u,
        Ok(Err(e)) => {
            return (HttpResponse::InternalServerError()
                .body(format!("stage=telegram-upload: {}", e)), None)
        }
        Err(_) => return (HttpResponse::RequestTimeout().body("stage=telegram-upload timeout (1800s)"), None),
    };
    log::info!("Upload stage: telegram-upload done");

    // Send the uploaded file as a document message to the channel.
    // Use .text() for the caption (there's no .caption() in grammers 0.10)
    log::info!("Upload stage: send_message");
    let message = match tokio::time::timeout(
        std::time::Duration::from_secs(60),
        client.send_message(
            peer,
            InputMessage::new().text(&fname).document(uploaded),
        ),
    )
    .await
    {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => {
            return (HttpResponse::InternalServerError()
                .body(format!("stage=send_message: {}", e)), None)
        }
        Err(_) => return (HttpResponse::RequestTimeout().body("stage=send_message timeout (60s)"), None),
    };
    log::info!("Upload stage: send_message done");

    let msg_id = message.id();
    log::info!(
        "Upload complete: '{}' sent as message {} to Telegram",
        fname,
        msg_id
    );

    // Backup-everything: enqueue a MAIN→BACKUP copy for every upload that
    // landed in a channel (MAIN or folder), whenever backup is provisioned.
    // The worker forwards server-side in the background; the ledger + watcher
    // make this idempotent.
    if let (Some(src_id), Some(_)) = (target, org_backup.or_else(|| crate::storage::backup_id(&state))) {
        crate::replicate::enqueue(
            &state,
            crate::replicate::ReplicateJob::new(src_id, msg_id),
        );
    }

    // Extract file metadata from the sent message
    let (file_size, mime_type) = match message.media() {
        Some(Media::Document(d)) => (
            d.size().unwrap_or(total_size as usize) as u64,
            d.mime_type()
                .unwrap_or("application/octet-stream")
                .to_string(),
        ),
        _ => (total_size, "application/octet-stream".to_string()),
    };

    // Metadata DB row so the filesystem structure accumulates for every file.
    // Chunked flows already own a row (created at init): update it instead of
    // inserting a duplicate.
    crate::chunked::record_single_upload(
        folder_id,
        fname.clone(),
        file_size,
        msg_id as i64,
        mime_type.clone(),
        existing_id,
    )
    .await;

    (HttpResponse::Ok().json(UploadResponse {
        success: true,
        message_id: msg_id as i64,
        name: fname,
        size: file_size,
        mime_type,
        folder_id,
    }), Some(msg_id as i64))
}

/// Get upload status / config info (live tier-aware cap)
pub async fn get_upload_status(state: web::Data<AppState>) -> impl actix_web::Responder {
    let cap = tier::current_cap(&state).await;
    let human = if cap >= tier::PREMIUM_MAX_UPLOAD_BYTES { "4 GB (Premium)" } else { "2 GB" };
    HttpResponse::Ok().json(serde_json::json!({
        "max_file_size": cap,
        "max_file_size_human": human,
        "chunk_size": "adaptive (128KB-512KB, handled by grammers internally)",
        "note": "Files are streamed to temp storage then uploaded to Telegram. Backup copy is forwarded automatically."
    }))
}
