use actix_web::{web, HttpResponse, Responder};
use crate::models::*;
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
    let fid = match crate::serve_media::parse_channel_fid(&fid_str) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let workers = crate::fast_transfer::worker_count_for(crate::tier::premium_cached(&state).await);
    crate::serve_media::serve_media(
        &state,
        &req,
        fid,
        crate::storage::main_id(&state),
        mid,
        workers,
        None,
        "public, max-age=31536000, immutable",
    )
    .await
}
