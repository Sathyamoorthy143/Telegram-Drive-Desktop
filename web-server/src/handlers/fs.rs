use actix_web::{web, HttpResponse, Responder};
use crate::TelegramState;
use crate::models::{FileMetadata, FolderMetadata};
use crate::utils::{resolve_peer, map_error};
use crate::handlers::auth::get_client;
use grammers_client::types::{Media, Peer};
use grammers_tl_types as tl;
use serde::Deserialize;

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
