use actix_web::{web, HttpResponse, Responder};
use grammers_client::media::Media;
use crate::auth::get_client;
use crate::models::*;
use crate::utils::resolve_peer_ref;
use crate::AppState;

pub async fn get_files(
    state: web::Data<AppState>,
    query: web::Query<GetFilesRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(&client, query.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let mut files = Vec::new();
    let mut msgs = client.iter_messages(peer);
    while let Ok(Some(msg)) = msgs.next().await {
        if let Some(doc) = msg.media() {
            let (name, size, mime, ext) = match doc {
                Media::Document(d) => {
                    let n = d.name().unwrap_or("Unknown").to_string();
                    let s = d.size().unwrap_or(0);
                    let m = d.mime_type().map(|s| s.to_string());
                    let e = std::path::Path::new(&n)
                        .extension()
                        .and_then(|o| o.to_str())
                        .map(|s| s.to_string());
                    (n, s, m, e)
                }
                Media::Photo(_) => (
                    "Photo.jpg".into(),
                    0,
                    Some("image/jpeg".into()),
                    Some("jpg".into()),
                ),
                _ => ("Unknown".into(), 0, None, None),
            };
            files.push(FileMetadata {
                id: msg.id() as i64,
                folder_id: query.folder_id,
                name,
                size: size as u64,
                mime_type: mime,
                file_ext: ext,
                created_at: msg.date().to_string(),
                icon_type: "file".into(),
            });
        }
    }
    HttpResponse::Ok().json(files)
}

pub async fn delete_file(
    state: web::Data<AppState>,
    req: web::Json<DeleteFileRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(&client, req.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    match client.delete_messages(peer, &[req.message_id]).await {
        Ok(_) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

pub async fn download_file(
    state: web::Data<AppState>,
    path: web::Path<(i64, i32)>,
) -> impl Responder {
    let (fid, mid) = path.into_inner();
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(&client, Some(fid), &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let msgs = match client.get_messages_by_id(peer, &[mid]).await {
        Ok(m) => m,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };
    let msg = match msgs.into_iter().flatten().next() {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("Not found"),
    };
    let media = match msg.media() {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("No media"),
    };
    let size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };
    let mime = match &media {
        Media::Document(d) => d
            .mime_type()
            .unwrap_or("application/octet-stream")
            .to_string(),
        _ => "application/octet-stream".to_string(),
    };
    let stream = async_stream::stream! {
        let mut iter = client.iter_download(&media).chunk_size(512 * 1024);
        while let Some(chunk) = iter.next().await.transpose() {
            match chunk {
                Ok(b) => yield Ok::<_, actix_web::Error>(actix_web::web::Bytes::from(b)),
                Err(e) => { log::error!("Download error: {}", e); break; }
            }
        }
    };
    HttpResponse::Ok()
        .content_type(mime)
        .insert_header(("Content-Length", size.to_string()))
        .streaming(stream)
}

pub async fn move_files(
    state: web::Data<AppState>,
    req: web::Json<MoveFilesRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    if !req.message_ids.is_empty() && req.source_folder_id != req.target_folder_id {
        let src = match resolve_peer_ref(&client, req.source_folder_id, &state.peer_cache).await {
            Ok(p) => p,
            Err(e) => return HttpResponse::InternalServerError().body(e),
        };
        let tgt = match resolve_peer_ref(&client, req.target_folder_id, &state.peer_cache).await {
            Ok(p) => p,
            Err(e) => return HttpResponse::InternalServerError().body(e),
        };
        if let Err(e) = client
            .forward_messages(tgt.clone(), &req.message_ids, src.clone())
            .await
        {
            return HttpResponse::InternalServerError().body(format!("Forward failed: {}", e));
        }
        if let Err(e) = client.delete_messages(src, &req.message_ids).await {
            return HttpResponse::InternalServerError().body(format!("Delete failed: {}", e));
        }
    }
    HttpResponse::Ok().json(true)
}

pub async fn copy_files(
    state: web::Data<AppState>,
    req: web::Json<CopyFilesRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    if !req.message_ids.is_empty() && req.source_folder_id != req.target_folder_id {
        let src = match resolve_peer_ref(&client, req.source_folder_id, &state.peer_cache).await {
            Ok(p) => p,
            Err(e) => return HttpResponse::InternalServerError().body(e),
        };
        let tgt = match resolve_peer_ref(&client, req.target_folder_id, &state.peer_cache).await {
            Ok(p) => p,
            Err(e) => return HttpResponse::InternalServerError().body(e),
        };
        if let Err(e) = client
            .forward_messages(tgt, &req.message_ids, src)
            .await
        {
            return HttpResponse::InternalServerError().body(format!("Copy failed: {}", e));
        }
    }
    HttpResponse::Ok().json(true)
}

pub async fn search_files(
    state: web::Data<AppState>,
    query: web::Query<SearchRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let mut files = Vec::new();
    use grammers_tl_types as tl;
    let result = client
        .invoke(&tl::functions::messages::SearchGlobal {
            q: query.query.clone(),
            filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
            min_date: 0,
            max_date: 0,
            offset_rate: 0,
            offset_peer: tl::enums::InputPeer::Empty,
            offset_id: 0,
            limit: 50,
            folder_id: None,
            broadcasts_only: false,
            groups_only: false,
            users_only: false,
        })
        .await;
    match result {
        Ok(tl::enums::messages::Messages::Messages(msgs)) => {
            let messages = msgs.messages;
            for msg in messages {
                if let tl::enums::Message::Message(m) = msg {
                    if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                        if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                            let name = doc
                                .attributes
                                .iter()
                                .find_map(|a| match a {
                                    tl::enums::DocumentAttribute::Filename(f) => {
                                        Some(f.file_name.clone())
                                    }
                                    _ => None,
                                })
                                .unwrap_or("Unknown".into());
                            let ext = std::path::Path::new(&name)
                                .extension()
                                .and_then(|o| o.to_str())
                                .map(|s| s.to_string());
                            let fid = match m.peer_id {
                                tl::enums::Peer::Channel(c) => Some(c.channel_id as i64),
                                _ => None,
                            };
                            files.push(FileMetadata {
                                id: m.id as i64,
                                folder_id: fid,
                                name,
                                size: doc.size as u64,
                                mime_type: Some(doc.mime_type.clone()),
                                file_ext: ext,
                                created_at: m.date.to_string(),
                                icon_type: "file".into(),
                            });
                        }
                    }
                }
            }
        }
        Ok(tl::enums::messages::Messages::Slice(msgs)) => {
            let messages = msgs.messages;
            for msg in messages {
                if let tl::enums::Message::Message(m) = msg {
                    if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                        if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                            let name = doc
                                .attributes
                                .iter()
                                .find_map(|a| match a {
                                    tl::enums::DocumentAttribute::Filename(f) => {
                                        Some(f.file_name.clone())
                                    }
                                    _ => None,
                                })
                                .unwrap_or("Unknown".into());
                            let ext = std::path::Path::new(&name)
                                .extension()
                                .and_then(|o| o.to_str())
                                .map(|s| s.to_string());
                            let fid = match m.peer_id {
                                tl::enums::Peer::Channel(c) => Some(c.channel_id as i64),
                                _ => None,
                            };
                            files.push(FileMetadata {
                                id: m.id as i64,
                                folder_id: fid,
                                name,
                                size: doc.size as u64,
                                mime_type: Some(doc.mime_type.clone()),
                                file_ext: ext,
                                created_at: m.date.to_string(),
                                icon_type: "file".into(),
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }
    HttpResponse::Ok().json(files)
}

pub async fn get_bandwidth() -> impl Responder {
    HttpResponse::Ok().json(BandwidthStats {
        up_bytes: 0,
        down_bytes: 0,
    })
}
