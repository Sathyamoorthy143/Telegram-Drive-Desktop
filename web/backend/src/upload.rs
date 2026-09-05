use actix_multipart::Multipart;
use actix_web::{web, HttpResponse};
use futures::StreamExt;
use grammers_client::message::InputMessage;
use grammers_client::media::Media;
use grammers_client::peer::Peer;
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::auth::get_client;
use crate::models::*;
use crate::utils::resolve_peer_ref;
use crate::AppState;

/// Telegram upload limits
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024 * 1024; // 5 GB

/// Multipart upload endpoint — receives file chunks and uploads to Telegram.
/// Handles files up to 5GB by streaming to a temp file, then uploading to Telegram.
pub async fn upload_file(
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> impl actix_web::Responder {
    // NOTE: each field's body MUST be consumed inline. Storing a Field and
    // polling the parent Multipart for the next part deadlocks (bounded
    // internal channel fills, parser stalls) and the request hangs forever.
    let mut folder_id: Option<i64> = None;
    let mut file_name: Option<String> = None;
    let mut total_size: u64 = 0;
    let tmp_dir = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Failed to create temp dir: {}", e))
        }
    };
    let mut tmp_file: Option<fs::File> = None;
    let mut tmp_path: Option<std::path::PathBuf> = None;
    let mut got_file = false;

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => return HttpResponse::BadRequest().body(format!("Multipart error: {}", e)),
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
                let fname = field
                    .content_disposition()
                    .and_then(|cd| cd.get_filename().map(|s| s.to_string()))
                    .unwrap_or_else(|| "upload.bin".to_string());
                file_name = Some(fname.clone());
                log::info!("Upload started: {} for folder {:?}", fname, folder_id);
                // Use only the basename for the temp file to avoid ENOENT
                // when the browser sends a relative path like "folder/sub/file.txt".
                let safe_name = Path::new(&fname)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| fname.clone());
                let path = tmp_dir.path().join(&safe_name);
                let f = match fs::File::create(&path).await {
                    Ok(f) => f,
                    Err(e) => {
                        return HttpResponse::InternalServerError()
                            .body(format!("Failed to create temp file: {}", e))
                    }
                };
                tmp_path = Some(path);
                let mut tf = f;
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(data) => {
                            total_size += data.len() as u64;
                            if total_size > MAX_FILE_SIZE {
                                return HttpResponse::PayloadTooLarge()
                                    .body(format!("File too large. Max: {} bytes", MAX_FILE_SIZE));
                            }
                            if let Err(e) = tf.write_all(&data).await {
                                return HttpResponse::InternalServerError()
                                    .body(format!("Write error: {}", e));
                            }
                        }
                        Err(e) => {
                            return HttpResponse::InternalServerError()
                                .body(format!("Upload read error: {}", e));
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
        return HttpResponse::BadRequest().body("No file field in upload");
    }

    let fname = file_name.unwrap_or_else(|| "upload.bin".to_string());
    let tmp_path = match tmp_path {
        Some(p) => p,
        None => return HttpResponse::InternalServerError().body("Temp file missing"),
    };
    let mut tmp_file = match tmp_file {
        Some(f) => f,
        None => return HttpResponse::InternalServerError().body("Temp file missing"),
    };
    // Ensure all bytes are flushed to disk before re-opening for Telegram upload.
    if let Err(e) = tmp_file.flush().await {
        return HttpResponse::InternalServerError().body(format!("Flush error: {}", e));
    }
    drop(tmp_file);

    log::info!(
        "Upload received {} bytes for '{}', uploading to Telegram...",
        total_size,
        fname
    );

    let (resp, _msg_id) = deliver_to_telegram(state, tmp_path.clone(), fname.clone(), folder_id, total_size).await;

    // Cleanup temp file (tmp_file was already flushed + dropped after writing)
    let _ = fs::remove_file(&tmp_path).await;
    let _ = tmp_dir.close();
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

    // Resolve the target peer (folder channel or Saved Messages)
    log::info!("Upload stage: resolve_peer folder_id={:?}", folder_id);
    let peer = match tokio::time::timeout(
        std::time::Duration::from_secs(20),
        resolve_peer_ref(&client, folder_id, &state.peer_cache),
    )
    .await
    {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return (HttpResponse::InternalServerError().body(format!("stage=resolve_peer: {}", e)), None),
        Err(_) => return (HttpResponse::RequestTimeout().body("stage=resolve_peer timeout (20s)"), None),
    };
    log::info!("Upload stage: resolve_peer done");

    // Upload to Telegram with parallel parts (sliding window over N workers).
    // total_size was counted while streaming the request body to disk.
    log::info!(
        "Upload stage: telegram-upload size={} name={} workers={}",
        total_size, fname, crate::fast_transfer::worker_count()
    );
    let uploaded = match tokio::time::timeout(
        std::time::Duration::from_secs(600),
        crate::fast_transfer::upload_file_parallel(&client, &tmp_path, total_size, fname.clone()),
    )
    .await
    {
        Ok(Ok(u)) => u,
        Ok(Err(e)) => {
            return (HttpResponse::InternalServerError()
                .body(format!("stage=telegram-upload: {}", e)), None)
        }
        Err(_) => return (HttpResponse::RequestTimeout().body("stage=telegram-upload timeout (600s)"), None),
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

    // Trigger background backup copy to backup channel
    let backup_channel_id = state
        .settings
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .backup_channel_id
        .filter(|id| *id != 0);

    if let Some(backup_id) = backup_channel_id {
        let client_clone = client.clone();
        let peer_cache = state.peer_cache.clone();
        let msg_id_clone = msg_id;

        if let Some(main_channel_id) = folder_id {
            tokio::spawn(async move {
                match forward_to_backup(
                    &client_clone,
                    backup_id,
                    main_channel_id,
                    msg_id_clone,
                    &peer_cache,
                )
                .await
                {
                    Ok(_) => log::info!("Backup copy completed for message {}", msg_id_clone),
                    Err(e) => log::error!("Backup copy failed for message {}: {}", msg_id_clone, e),
                }
            });
        }
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
    crate::chunked::record_single_upload(
        folder_id,
        fname.clone(),
        file_size,
        msg_id as i64,
        mime_type.clone(),
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

/// Forward a message from main channel to backup channel
async fn forward_to_backup(
    client: &grammers_client::Client,
    backup_channel_id: i64,
    main_channel_id: i64,
    msg_id: i32,
    peer_cache: &std::sync::Arc<tokio::sync::RwLock<std::collections::HashMap<i64, Peer>>>,
) -> Result<(), String> {
    let src_peer = resolve_peer_ref(client, Some(main_channel_id), peer_cache).await?;
    let dst_peer = resolve_peer_ref(client, Some(backup_channel_id), peer_cache).await?;

    client
        .forward_messages(dst_peer, &[msg_id], src_peer)
        .await
        .map_err(|e| format!("Forward to backup failed: {}", e))?;

    Ok(())
}

/// Get upload status / config info
pub async fn get_upload_status() -> impl actix_web::Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "max_file_size": MAX_FILE_SIZE,
        "max_file_size_human": "5 GB",
        "chunk_size": "adaptive (128KB-512KB, handled by grammers internally)",
        "note": "Files are streamed to temp storage then uploaded to Telegram. Backup copy is forwarded automatically."
    }))
}
