use actix_web::{web, HttpResponse, Responder};
use grammers_client::media::Media;
use crate::auth::get_client;
use crate::utils::resolve_peer_ref;
use crate::AppState;

pub async fn get_preview(state: web::Data<AppState>, path: web::Path<(String, i32)>) -> impl Responder {
    let (fid_str, mid) = path.into_inner();
    let fid = if fid_str == "me" || fid_str == "home" || fid_str == "null" || fid_str == "Saved Messages" {
        None
    } else {
        fid_str.parse::<i64>().ok()
    };
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::ServiceUnavailable().body(e),
    };
    let peer = match resolve_peer_ref(&client, fid, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().body(e),
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
    let mime = match &media {
        Media::Document(d) => d
            .mime_type()
            .unwrap_or("application/octet-stream")
            .to_string(),
        _ => "application/octet-stream".into(),
    };
    let size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };
    let stream = async_stream::stream! {
        let mut iter = client.iter_download(&media).chunk_size(512 * 1024);
        while let Some(chunk) = iter.next().await.transpose() {
            match chunk {
                Ok(b) => yield Ok::<_, actix_web::Error>(actix_web::web::Bytes::from(b)),
                Err(_) => break,
            }
        }
    };
    HttpResponse::Ok()
        .content_type(mime)
        .insert_header(("Content-Length", size.to_string()))
        .streaming(stream)
}

pub async fn get_thumbnail(state: web::Data<AppState>, path: web::Path<(String, i32)>) -> impl Responder {
    get_preview(state, path).await
}
