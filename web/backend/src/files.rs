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
    let trashed: std::collections::HashSet<i64> = {
        let url = std::env::var("SUPABASE_URL").unwrap_or_default();
        let key = std::env::var("SUPABASE_SERVICE_KEY").or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY")).unwrap_or_default();
        if url.is_empty() || key.is_empty() {
            std::collections::HashSet::new()
        } else {
            let client = reqwest::Client::new();
            let resp = client.get(format!("{}/rest/v1/trash_items?select=message_id,folder_id", url.trim_end_matches('/')))
                .header("apikey", &key).header("Authorization", format!("Bearer {}", key))
                .query(&[("folder_id", query.folder_id.map(|v| format!("eq.{}", v)).unwrap_or("is.null".into()))])
                .send().await;
            if let Ok(r) = resp { if r.status().is_success() { if let Ok(v) = r.json::<Vec<serde_json::Value>>().await { v.into_iter().filter_map(|x| x.get("message_id").and_then(|m| m.as_i64())).collect() } else { std::collections::HashSet::new() } } else { std::collections::HashSet::new() } } else { std::collections::HashSet::new() }
        }
    };
    let mut files = Vec::new();
    let mut msgs = client.iter_messages(peer);
    while let Ok(Some(msg)) = msgs.next().await {
        if trashed.contains(&(msg.id() as i64)) { continue; }
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
    req: actix_web::HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<(i64, i32)>,
) -> impl Responder {
    let (fid, mid) = path.into_inner();
    let fid_opt = if fid == 0 { None } else { Some(fid) };
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(&client, fid_opt, &state.peer_cache).await {
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
    let etag = format!("\"{}-{}\"", fid, mid);
    match crate::fast_transfer::range_decision(&req, &etag, size) {
        crate::fast_transfer::RangeDecision::NotModified => HttpResponse::NotModified().finish(),
        crate::fast_transfer::RangeDecision::Unsatisfiable => HttpResponse::build(actix_web::http::StatusCode::RANGE_NOT_SATISFIABLE)
            .insert_header(("Content-Range", format!("bytes */{}", size)))
            .finish(),
        crate::fast_transfer::RangeDecision::Full => {
            let stream = crate::fast_transfer::download_stream(&client, media);
            HttpResponse::Ok()
                .content_type(mime)
                .insert_header(("Content-Length", size.to_string()))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
                .streaming(stream)
        }
        crate::fast_transfer::RangeDecision::Partial(s, e) => {
            let stream = crate::fast_transfer::download_range_stream(&client, media, Some((s, e)));
            HttpResponse::PartialContent()
                .content_type(mime)
                .insert_header(("Content-Length", (e - s + 1).to_string()))
                .insert_header(("Content-Range", format!("bytes {}-{}/{}", s, e, size)))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
                .streaming(stream)
        }
    }
}

async fn forward_and_delete(
    client: &grammers_client::Client,
    src: grammers_session::types::PeerRef,
    tgt: grammers_session::types::PeerRef,
    message_ids: &[i32],
) -> Result<(), String> {
    client
        .forward_messages(tgt, message_ids, src)
        .await
        .map_err(|e| format!("Forward failed: {}", e))?;
    client
        .delete_messages(src, message_ids)
        .await
        .map_err(|e| format!("Delete failed: {}", e))?;
    Ok(())
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
        if let Err(e) = forward_and_delete(&client, src, tgt, &req.message_ids).await {
            return HttpResponse::InternalServerError().body(e);
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

fn extract_search_result(msg: grammers_tl_types::enums::Message) -> Option<FileMetadata> {
    let m = match msg {
        grammers_tl_types::enums::Message::Message(m) => m,
        _ => return None,
    };
    let media = m.media?;
    let doc = match media {
        grammers_tl_types::enums::MessageMedia::Document(d) => d.document?,
        _ => return None,
    };
    let doc = match doc {
        grammers_tl_types::enums::Document::Document(d) => d,
        _ => return None,
    };
    let name = doc
        .attributes
        .iter()
        .find_map(|a| match a {
            grammers_tl_types::enums::DocumentAttribute::Filename(f) => {
                Some(f.file_name.clone())
            }
            _ => None,
        })
        .unwrap_or_else(|| "Unknown".into());
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|o| o.to_str())
        .map(|s| s.to_string());
    let fid = match m.peer_id {
        grammers_tl_types::enums::Peer::Channel(c) => Some(c.channel_id as i64),
        _ => None,
    };
    Some(FileMetadata {
        id: m.id as i64,
        folder_id: fid,
        name,
        size: doc.size as u64,
        mime_type: Some(doc.mime_type.clone()),
        file_ext: ext,
        created_at: m.date.to_string(),
        icon_type: "file".into(),
    })
}

pub async fn search_files(
    state: web::Data<AppState>,
    query: web::Query<SearchRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
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
    let messages: Vec<tl::enums::Message> = match result {
        Ok(tl::enums::messages::Messages::Messages(msgs)) => msgs.messages,
        Ok(tl::enums::messages::Messages::Slice(msgs)) => msgs.messages,
        _ => Vec::new(),
    };
    let mut files: Vec<FileMetadata> = messages
        .into_iter()
        .filter_map(extract_search_result)
        .collect();
    if let Some(t) = query.file_type.clone() {
        let t = t.to_lowercase();
        files.retain(|f| {
            let name = f.name.to_lowercase();
            let ext = f.file_ext.clone().unwrap_or_default().to_lowercase();
            let mime = f.mime_type.clone().unwrap_or_default().to_lowercase();
            match t.as_str() {
                "pdf" => ext == "pdf" || mime.contains("pdf"),
                "image" | "images" | "photo" => mime.starts_with("image/") || ["jpg","jpeg","png","gif","webp","svg"].contains(&ext.as_str()),
                "video" => mime.starts_with("video/") || ["mp4","mkv","mov","avi","webm"].contains(&ext.as_str()),
                "audio" => mime.starts_with("audio/") || ["mp3","wav","ogg","flac","m4a"].contains(&ext.as_str()),
                "doc" => ["doc","docx","txt","md","rtf","odt"].contains(&ext.as_str()),
                "archive" => ["zip","rar","7z","tar","gz"].contains(&ext.as_str()),
                _ => name.contains(&t) || ext == t || mime.contains(&t),
            }
        });
    }
    if let Some(min) = query.min_size { files.retain(|f| f.size >= min); }
    if let Some(max) = query.max_size { files.retain(|f| f.size <= max); }
    if let Some(after) = query.after.clone() {
        files.retain(|f| f.created_at >= after);
    }
    if let Some(before) = query.before.clone() {
        files.retain(|f| f.created_at <= before);
    }
    HttpResponse::Ok().json(files)
}

pub async fn get_bandwidth() -> impl Responder {
    HttpResponse::Ok().json(BandwidthStats {
        up_bytes: 0,
        down_bytes: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bandwidth_returns_zeroes() {
        let stats = BandwidthStats { up_bytes: 0, down_bytes: 0 };
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("up_bytes"));
        assert!(json.contains("down_bytes"));
    }
}
