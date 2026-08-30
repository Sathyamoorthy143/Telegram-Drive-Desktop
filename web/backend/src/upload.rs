use actix_multipart::Multipart;
use actix_web::{web, HttpResponse};
use futures::StreamExt;
use grammers_client::message::InputMessage;
use grammers_client::media::Media;
use grammers_client::peer::Peer;
use std::io::SeekFrom;
use tokio::fs;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

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
    let mut folder_id: Option<i64> = None;
    let mut file_name: Option<String> = None;
    let mut file_field: Option<actix_multipart::Field> = None;

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
                file_name = field
                    .content_disposition()
                    .and_then(|cd| cd.get_filename().map(|s| s.to_string()));
                file_field = Some(field);
            }
            _ => {}
        }
    }

    let mut field = match file_field {
        Some(f) => f,
        None => return HttpResponse::BadRequest().body("No file field in upload"),
    };

    let fname = file_name.unwrap_or_else(|| "upload.bin".to_string());
    log::info!("Upload started: {} for folder {:?}", fname, folder_id);

    // Create temp file and stream upload data to it
    let tmp_dir = tempfile::tempdir().unwrap();
    let tmp_path = tmp_dir.path().join(&fname);
    let mut tmp_file = match fs::File::create(&tmp_path).await {
        Ok(f) => f,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Failed to create temp file: {}", e))
        }
    };

    let mut total_size: u64 = 0;
    while let Some(chunk) = field.next().await {
        match chunk {
            Ok(data) => {
                total_size += data.len() as u64;
                if total_size > MAX_FILE_SIZE {
                    return HttpResponse::PayloadTooLarge()
                        .body(format!("File too large. Max: {} bytes", MAX_FILE_SIZE));
                }
                if let Err(e) = tmp_file.write_all(&data).await {
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

    log::info!(
        "Upload received {} bytes for '{}', uploading to Telegram...",
        total_size,
        fname
    );

    // Get the Telegram client
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    // Resolve the target peer (folder channel or Saved Messages)
    let peer = match resolve_peer_ref(&client, folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    // Upload to Telegram using grammers' streaming upload (handles chunking internally)
    let mut file = match fs::File::open(&tmp_path).await {
        Ok(f) => f,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Failed to open temp file: {}", e))
        }
    };
    let size = match file.seek(SeekFrom::End(0)).await {
        Ok(s) => s as usize,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Seek error: {}", e))
        }
    };
    let _ = file.seek(SeekFrom::Start(0)).await;

    let uploaded = match client
        .upload_stream(&mut file, size, fname.clone())
        .await
    {
        Ok(u) => u,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Telegram upload failed: {}", e))
        }
    };

    // Send the uploaded file as a document message to the channel.
    // Use .text() for the caption (there's no .caption() in grammers 0.10)
    let message = match client
        .send_message(
            peer,
            InputMessage::new().text(&fname).document(uploaded),
        )
        .await
    {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Send message failed: {}", e))
        }
    };

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
        .unwrap()
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

    // Cleanup temp file
    drop(tmp_file);
    let _ = fs::remove_file(&tmp_path).await;
    let _ = tmp_dir.close();

    HttpResponse::Ok().json(UploadResponse {
        success: true,
        message_id: msg_id as i64,
        name: fname,
        size: file_size,
        mime_type,
        folder_id,
    })
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
