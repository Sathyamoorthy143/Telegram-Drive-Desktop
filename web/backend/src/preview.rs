use actix_web::{web, Responder};
use crate::AppState;

pub async fn get_preview(
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

pub async fn get_thumbnail(
    req: actix_web::HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<(String, i32)>,
) -> impl Responder {
    get_preview(req, state, path).await
}
