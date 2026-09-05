use actix_web::{web, HttpResponse, Responder};
use actix_multipart::Multipart;
use crate::TelegramState;
use crate::models::{FileMetadata, FolderMetadata};
use crate::utils::{resolve_peer, map_error};
use crate::handlers::auth::get_client;
use futures_util::stream::StreamExt;
use grammers_client::types::{Media, Peer};
use grammers_client::InputMessage;
use grammers_tl_types as tl;
use serde::Deserialize;
use std::fs;
use std::io::{Cursor, Write};
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct GetFilesRequest {
    pub folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct DeleteRequest {
    pub id: i64,
    pub folder_id: Option<i64>,
}

pub async fn get_files(
    state: web::Data<TelegramState>,
    query: web::Query<GetFilesRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let peer = match resolve_peer(&client, query.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let mut files: Vec<FileMetadata> = Vec::new();
    let mut msgs = client.iter_messages(&peer);
    
    while let Ok(Some(msg)) = msgs.next().await {
        if let Some(doc) = msg.media() {
            let (name, size, mime, ext) = match doc {
                Media::Document(d) => {
                    let n = d.name().to_string();
                    let s = d.size();
                    let m = d.mime_type().map(|s| s.to_string());
                    let e = std::path::Path::new(&n).extension().map(|os| os.to_str().unwrap_or("").to_string());
                    (n, s, m, e)
                },
                Media::Photo(_) => ("Photo.jpg".to_string(), 0, Some("image/jpeg".into()), Some("jpg".into())),
                _ => ("Unknown".to_string(), 0, None, None),
            };
            files.push(FileMetadata {
                id: msg.id() as i64,
                folder_id: query.folder_id,
                name,
                size: size as u64,
                mime_type: mime,
                file_ext: ext,
                created_at: msg.date().to_string(),
                icon_type: "file".into()
            });
        }
    }

    HttpResponse::Ok().json(files)
}

pub async fn scan_folders(state: web::Data<TelegramState>) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    
    let mut folders = Vec::new();
    let mut dialogs = client.iter_dialogs();
    
    while let Ok(Some(dialog)) = dialogs.next().await {
        match &dialog.peer {
            Peer::Channel(c) => {
                let id = c.raw.id;
                let name = c.raw.title.clone();
                
                if name.to_lowercase().contains("[td]") {
                    let display_name = name.replace(" [TD]", "").replace(" [td]", "").replace("[TD]", "").replace("[td]", "").trim().to_string();
                    folders.push(FolderMetadata { id, name: display_name, parent_id: None });
                }
                // Strategy 2: About (Simplified for now)
            },
            _ => {}
        }
    }

    HttpResponse::Ok().json(folders)
}

pub async fn create_folder(
    state: web::Data<TelegramState>,
    req: web::Json<CreateFolderRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let about = match req.parent_id {
        Some(pid) => format!("parent_id:{}\n[telegram-drive-folder]", pid),
        None => "Telegram Drive Storage Folder\n[telegram-drive-folder]".to_string(),
    };

    let result = client.invoke(&tl::functions::channels::CreateChannel {
        broadcast: true,
        megagroup: false,
        title: format!("{} [TD]", req.name),
        about,
        geo_point: None,
        address: None,
        for_import: false,
        forum: false,
        ttl_period: None,
    }).await;

    match result {
        Ok(_) => HttpResponse::Ok().json("Folder created"),
        Err(e) => HttpResponse::InternalServerError().body(map_error(e)),
    }
}

pub async fn delete_file(
    state: web::Data<TelegramState>,
    req: web::Json<DeleteRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let peer = match resolve_peer(&client, req.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    match client.delete_messages(&peer, &[req.id as i32]).await {
        Ok(_) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[derive(serde::Serialize)]
pub struct BandwidthStats {
    pub up_bytes: u64,
    pub down_bytes: u64,
}

pub async fn get_bandwidth() -> impl Responder {
    // Mock stats for now
    HttpResponse::Ok().json(BandwidthStats {
        up_bytes: 1024 * 1024 * 10,
        down_bytes: 1024 * 1024 * 50,
    })
}

#[derive(Deserialize)]
pub struct UploadInitRequest {
    pub name: String,
    pub size: u64,
    pub folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct UploadCompleteRequest {
    pub upload_id: String,
    pub folder_id: Option<i64>,
    pub name: String,
}

pub async fn upload_file(
    state: web::Data<TelegramState>,
    mut payload: Multipart,
) -> impl Responder {
    let inner = panic::catch_unwind(AssertUnwindSafe(|| async move {
        let mut file_bytes: Option<Vec<u8>> = None;
        let mut file_name = "uploaded_file".to_string();
        let mut folder_id: Option<i64> = None;

        while let Some(Ok(mut field)) = payload.next().await {
            let name = field.name().unwrap_or("");
            if name == "file" {
                if let Some(cd) = field.content_disposition() {
                    if let Some(filename) = cd.get_filename() {
                        file_name = filename.to_string();
                    }
                }
                let mut data = Vec::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => data.extend_from_slice(&bytes),
                        Err(_) => return HttpResponse::BadRequest().body("Failed to read file chunk"),
                    }
                }
                if data.is_empty() {
                    return HttpResponse::BadRequest().body("Empty file");
                }
                file_bytes = Some(data);
            } else if name == "folder_id" {
                let mut text = String::new();
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(bytes) => text.push_str(std::str::from_utf8(&bytes).unwrap_or("")),
                        Err(_) => continue,
                    }
                }
                folder_id = text.parse::<i64>().ok();
            }
        }

        let bytes = match file_bytes {
            Some(b) => b,
            None => return HttpResponse::BadRequest().body("No file provided"),
        };

        let client = match get_client(&state).await {
            Ok(c) => c,
            Err(e) => return HttpResponse::InternalServerError().body(format!("Client init failed: {}", e)),
        };

        let peer = match resolve_peer(&client, folder_id, &state.peer_cache).await {
            Ok(p) => p,
            Err(e) => return HttpResponse::InternalServerError().body(format!("Peer resolve failed: {}", e)),
        };

        let mut cursor = Cursor::new(bytes);
        let size = cursor.get_ref().len();
        log::info!("upload_file: name={} size={} folder_id={:?}", file_name, size, folder_id);
        let uploaded = match client.upload_stream(&mut cursor, size, file_name.clone()).await {
            Ok(u) => u,
            Err(e) => return HttpResponse::InternalServerError().body(format!("Telegram upload failed: {}", e)),
        };

        match client.send_message(&peer, InputMessage::new().document(uploaded)).await {
            Ok(message) => {
                log::info!("upload_file: sent message id={} name={}", message.id(), file_name);
                HttpResponse::Ok().json(serde_json::json!({
                    "id": message.id(),
                    "name": file_name
                }))
            },
            Err(e) => {
                log::error!("upload_file: send_message failed for {}: {}", file_name, e);
                HttpResponse::InternalServerError().body(format!("Send message failed: {}", map_error(e)))
            }
        }
    }));

    let future = match inner {
        Ok(f) => f,
        Err(panicked) => {
            let msg = if let Some(s) = panicked.downcast_ref::<&'static str>() {
                format!("Handler panicked: {}", s)
            } else if let Some(s) = panicked.downcast_ref::<String>() {
                format!("Handler panicked: {}", s)
            } else {
                "Handler panicked with non-string payload".to_string()
            };
            log::error!("{}", msg);
            return HttpResponse::InternalServerError().body(msg);
        }
    };

    future.await
}

pub async fn upload_init(
    _state: web::Data<TelegramState>,
    req: web::Json<UploadInitRequest>,
) -> impl Responder {
    let upload_id = Uuid::new_v4().to_string();
    let upload_dir = std::env::temp_dir().join(format!("telegram_upload_{}", upload_id));
    if let Err(e) = fs::create_dir_all(&upload_dir) {
        return HttpResponse::InternalServerError().body(format!("Failed to create upload dir: {}", e));
    }
    HttpResponse::Ok().json(serde_json::json!({
        "upload_id": upload_id
    }))
}

pub async fn upload_chunk(
    _state: web::Data<TelegramState>,
    upload_id: web::Path<String>,
    chunk: web::Bytes,
) -> impl Responder {
    let upload_dir = std::env::temp_dir().join(format!("telegram_upload_{}", upload_id));
    if !upload_dir.exists() {
        return HttpResponse::BadRequest().body("Invalid upload_id");
    }
    let chunk_files: Vec<_> = match fs::read_dir(&upload_dir) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
        Err(_) => vec![],
    };
    let chunk_index = chunk_files.len();
    let chunk_path = upload_dir.join(format!("chunk_{:05}", chunk_index));
    if let Err(e) = fs::write(&chunk_path, &chunk) {
        return HttpResponse::InternalServerError().body(format!("Failed to write chunk: {}", e));
    }
    HttpResponse::Ok().json(serde_json::json!({
        "status": "chunk_received",
        "chunk_index": chunk_index
    }))
}

pub async fn upload_complete(
    state: web::Data<TelegramState>,
    req: web::Json<UploadCompleteRequest>,
) -> impl Responder {
    let upload_dir = std::env::temp_dir().join(format!("telegram_upload_{}", req.upload_id));
    if !upload_dir.exists() {
        return HttpResponse::BadRequest().body("Invalid upload_id");
    }

    let mut chunk_files: Vec<_> = match fs::read_dir(&upload_dir) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
        Err(_) => vec![],
    };
    chunk_files.sort_by_key(|e| e.path());

    let temp_path = upload_dir.join(&req.name);
    let mut out = match fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => return HttpResponse::InternalServerError().body(format!("Failed to create output file: {}", e)),
    };

    for entry in chunk_files {
        let path = entry.path();
        if path.extension().map(|e| e == "part").unwrap_or(false) || path.file_name().map(|e| e != "complete").unwrap_or(true) {
            let data = match fs::read(&path) {
                Ok(d) => d,
                Err(_) => continue,
            };
            if let Err(e) = out.write_all(&data) {
                return HttpResponse::InternalServerError().body(format!("Failed to write chunk: {}", e));
            }
        }
    }

    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let peer = match resolve_peer(&client, req.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let uploaded = match client.upload_file(&temp_path).await {
        Ok(u) => u,
        Err(e) => {
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_dir(&upload_dir);
            return HttpResponse::InternalServerError().body(format!("Upload failed: {}", e));
        }
    };

    match client.send_message(&peer, InputMessage::new().document(uploaded)).await {
        Ok(message) => {
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_dir(&upload_dir);
            HttpResponse::Ok().json(serde_json::json!({
                "id": message.id(),
                "name": req.name
            }))
        },
        Err(e) => {
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_dir(&upload_dir);
            HttpResponse::InternalServerError().body(map_error(e))
        }
    }
}
