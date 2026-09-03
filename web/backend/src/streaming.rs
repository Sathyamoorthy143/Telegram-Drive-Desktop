use actix_web::{web, HttpResponse, Responder};
use grammers_client::media::Media;
use crate::auth::get_client;
use crate::models::*;
use crate::utils::resolve_peer_ref;
use crate::AppState;

pub async fn get_stream_info(_state: web::Data<AppState>) -> impl Responder {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let domain = std::env::var("DOMAIN").unwrap_or_else(|_| format!("localhost:{}", port));
    let scheme = if domain.contains("localhost") { "http" } else { "https" };
    HttpResponse::Ok().json(StreamInfo {
        token: "session".into(),
        base_url: format!("{}://{}", scheme, domain),
    })
}

pub async fn stream_media(
    req: actix_web::HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<(String, i32)>,
) -> impl Responder {
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
    let size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };
    let mime = match &media {
        Media::Document(d) => d
            .mime_type()
            .unwrap_or("application/octet-stream")
            .to_string(),
        _ => "application/octet-stream".into(),
    };
    let etag = format!("\"{}-{}\"", fid_str, mid);
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
