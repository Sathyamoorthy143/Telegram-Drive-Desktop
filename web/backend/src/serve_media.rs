//! Single serving path for Telegram media over HTTP.
//!
//! `files::download_file`, `org_files::org_download_file`, `streaming`,
//! `preview`, and `share::public_share` all funnel through [`serve_media`]:
//! resolve peer → fetch message → range-aware streaming under the global
//! download semaphore. One place for etag shape, cache headers, and flood
//! protection instead of five divergent copies.

use actix_web::{HttpRequest, HttpResponse};
use grammers_client::media::Media;

use crate::AppState;

/// Well-known folder aliases accepted wherever a channel id is expected.
pub fn parse_channel_fid(s: &str) -> Result<Option<i64>, HttpResponse> {
    match s {
        "me" | "home" | "null" | "Saved Messages" => Ok(None),
        _ => match s.parse::<i64>() {
            Ok(id) => Ok(Some(id)),
            Err(_) => Err(HttpResponse::BadRequest().body(format!("invalid folder id: {}", s))),
        },
    }
}

/// Canonical etag for Telegram bytes: channel + message id. Stable across
/// routes/URLs so revalidation works no matter which endpoint served first.
fn canonical_etag(channel_id: i64, mid: i32) -> String {
    format!("\"tg-{}-{}\"", channel_id, mid)
}

/// Fetch `mid` from `peer_fid.unwrap_or(fallback_main)` and stream it with
/// HTTP range support. Holds a download-semaphore permit for the whole body.
pub async fn serve_media(
    state: &actix_web::web::Data<AppState>,
    req: &HttpRequest,
    peer_fid: Option<i64>,
    fallback_main: Option<i64>,
    mid: i32,
    workers: usize,
    content_disposition: Option<String>,
    cache_control: &'static str,
) -> HttpResponse {
    let client = match crate::auth::get_client(state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::ServiceUnavailable().body(e),
    };
    let peer = match crate::utils::resolve_peer_ref(
        &client,
        peer_fid.or(fallback_main),
        &state.peer_cache,
    )
    .await
    {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadGateway().body(e),
    };
    let channel_id = peer_fid.or(fallback_main).unwrap_or(0);
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
    let permit = match state.download_slots.clone().acquire_owned().await {
        Ok(s) => s,
        Err(_) => return HttpResponse::InternalServerError().body("download limiter shut down"),
    };
    let etag = canonical_etag(channel_id, mid);
    match crate::fast_transfer::range_decision(req, &etag, size) {
        crate::fast_transfer::RangeDecision::NotModified => HttpResponse::NotModified().finish(),
        crate::fast_transfer::RangeDecision::Unsatisfiable => {
            HttpResponse::build(actix_web::http::StatusCode::RANGE_NOT_SATISFIABLE)
                .insert_header(("Content-Range", format!("bytes */{}", size)))
                .finish()
        }
        crate::fast_transfer::RangeDecision::Full => {
            let stream = crate::fast_transfer::download_stream(&client, media, workers);
            let stream = crate::fast_transfer::hold_permit(stream, permit);
            let mut resp = HttpResponse::Ok();
            resp.content_type(mime);
            if let Some(d) = content_disposition {
                resp.insert_header(("Content-Disposition", d));
            }
            resp.insert_header(("Content-Length", size.to_string()))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", cache_control))
                .streaming(stream)
        }
        crate::fast_transfer::RangeDecision::Partial(s, e) => {
            let stream =
                crate::fast_transfer::download_range_stream(&client, media, Some((s, e)), workers);
            let stream = crate::fast_transfer::hold_permit(stream, permit);
            let mut resp = HttpResponse::PartialContent();
            resp.content_type(mime);
            if let Some(d) = content_disposition {
                resp.insert_header(("Content-Disposition", d));
            }
            resp.insert_header(("Content-Length", (e - s + 1).to_string()))
                .insert_header(("Content-Range", format!("bytes {}-{}/{}", s, e, size)))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", cache_control))
                .streaming(stream)
        }
    }
}
