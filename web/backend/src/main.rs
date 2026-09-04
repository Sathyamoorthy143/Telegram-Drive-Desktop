mod auth;
mod chunked;
mod debug;
mod fast_transfer;
mod files;
mod folders;
mod keep_alive;
mod meta;
mod models;
mod preview;
mod settings;
mod share;
mod streaming;
mod supabase;
mod trash;
mod upload;
mod utils;

use actix_cors::Cors;
use actix_web::{web, App, HttpServer, HttpResponse};
use grammers_client::client::LoginToken;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use crate::models::Settings;

pub struct AppState {
    pub client: Arc<Mutex<Option<grammers_client::Client>>>,
    pub login_token: Arc<Mutex<Option<LoginToken>>>,
    pub password_token: Arc<Mutex<Option<grammers_client::client::PasswordToken>>>,
    pub api_id: Arc<Mutex<Option<i32>>>,
    pub peer_cache: Arc<RwLock<HashMap<i64, grammers_client::peer::Peer>>>,
    pub settings: Arc<std::sync::Mutex<Settings>>,
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    env_logger::init();

    let port_str = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let port: u16 = if port_str.trim().is_empty() {
        8080
    } else {
        port_str.trim().parse().expect("PORT must be a number")
    };

    log::info!("Telegram Drive Web Server starting on 0.0.0.0:{}", port);

    let initial_settings = settings::load_settings();
    let initial_api_id = initial_settings.telegram_api_id
        .or_else(|| std::env::var("TELEGRAM_API_ID").ok().and_then(|s| s.trim().parse().ok()))
        .or_else(|| std::env::var("TG_API_ID").ok().and_then(|s| s.trim().parse().ok()));
    if let Some(id) = initial_api_id {
        log::info!("Loaded API ID from settings/env: {}", id);
    }
    let state = web::Data::new(AppState {
        client: Arc::new(Mutex::new(None)),
        login_token: Arc::new(Mutex::new(None)),
        password_token: Arc::new(Mutex::new(None)),
        api_id: Arc::new(Mutex::new(initial_api_id)),
        peer_cache: Arc::new(RwLock::new(HashMap::new())),
        settings: Arc::new(std::sync::Mutex::new(initial_settings)),
    });

    if let Ok(url) = std::env::var("RENDER_EXTERNAL_URL") {
        log::info!("Render detected, starting keep-alive for: {}", url);
        keep_alive::start_keep_alive(url);
    } else if let Ok(url) = std::env::var("KEEP_ALIVE_URL") {
        log::info!("Starting keep-alive for: {}", url);
        keep_alive::start_keep_alive(url);
    }

    let dist = std::env::var("FRONTEND_DIST")
        .unwrap_or_else(|_| "../frontend/dist".into());

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .app_data(state.clone())
            .app_data(web::PayloadConfig::new(5 * 1024 * 1024 * 1024))
            .wrap(cors)
            .route("/api/health", web::get().to(keep_alive::health_check))
            .route("/health", web::get().to(keep_alive::health_check))
            .route("/api/debug/upload-probe", web::get().to(debug::upload_probe))
            .route("/s/{token}", web::get().to(share::public_share))
            .service(
                web::scope("/api")
                    .route("/connect", web::post().to(auth::connect))
                    .route("/check-connection", web::get().to(auth::check_connection))
                    .route("/auth/request-code", web::post().to(auth::request_code))
                    .route("/auth/sign-in", web::post().to(auth::sign_in))
                    .route("/auth/check-password", web::post().to(auth::check_password))
                    .route("/auth/user-info", web::get().to(auth::get_user_info))
                    .route("/auth/logout", web::post().to(auth::logout))
                    .route("/files", web::get().to(files::get_files))
                    .route("/files/upload", web::post().to(upload::upload_file))
                    .route("/files/upload/status", web::get().to(upload::get_upload_status))
                    .route("/files/upload/init", web::post().to(chunked::init_upload))
                    .route("/files/upload/chunk", web::put().to(chunked::put_chunk))
                    .route("/files/upload/session", web::get().to(chunked::session_status))
                    .route("/files/upload/complete", web::post().to(chunked::complete_upload))
                    .route("/files/{fid}/{mid}/download", web::get().to(files::download_file))
                    .route("/files/delete", web::post().to(trash::soft_delete))
                    .route("/files/delete/hard", web::post().to(files::delete_file))
                    .route("/files/move", web::post().to(files::move_files))
                    .route("/files/copy", web::post().to(files::copy_files))
                    .route("/trash", web::get().to(trash::list_trash))
                    .route("/trash/restore", web::post().to(trash::restore))
                    .route("/trash/purge", web::post().to(trash::purge))
                    .route("/trash/empty", web::post().to(trash::empty_trash))
                    .route("/share", web::post().to(share::create_share))
                    .route("/share", web::get().to(share::list_shares))
                    .route("/share/{token}", web::delete().to(share::delete_share))
                    .route("/files/search", web::get().to(files::search_files))
                    .route("/meta/favorites", web::get().to(meta::list_favorites))
                    .route("/meta/star", web::post().to(meta::star))
                    .route("/meta/recent", web::get().to(meta::list_recent))
                    .route("/meta/touch", web::post().to(meta::touch))
                    .route("/meta/tags", web::get().to(meta::get_tags))
                    .route("/meta/tags", web::put().to(meta::set_tags))
                    .route("/meta/by-tag", web::get().to(meta::list_by_tag))
                    .route("/activity", web::get().to(meta::list_activity))
                    .route("/activity", web::post().to(meta::log_activity))
                    .route("/activity/clear", web::post().to(meta::clear_activity))
                    .route("/versions/record", web::post().to(meta::record_version))
                    .route("/versions", web::get().to(meta::list_versions))
                    .route("/versions/restore", web::post().to(meta::restore_version))
                    .route("/bandwidth", web::get().to(files::get_bandwidth))
                    .route("/folders/scan", web::get().to(folders::scan_folders))
                    .route("/folders/create", web::post().to(folders::create_folder))
                    .route("/folders/{id}/rename", web::put().to(folders::rename_folder))
                    .route("/folders/{id}/delete", web::delete().to(folders::delete_folder))
                    .route("/folders/{id}/properties", web::get().to(folders::get_folder_properties))
                    .route("/stream-info", web::get().to(streaming::get_stream_info))
                    .route("/stream/{fid}/{mid}", web::get().to(streaming::stream_media))
                    .route("/preview/{fid}/{mid}", web::get().to(preview::get_preview))
                    .route("/thumbnail/{fid}/{mid}", web::get().to(preview::get_thumbnail))
                    .route("/settings", web::get().to(settings::get_settings))
                    .route("/settings", web::put().to(settings::save_settings_handler))
                    .route("/settings/lock", web::get().to(settings::get_lock_settings))
                    .route("/settings/lock", web::put().to(settings::save_lock_settings))
            )
            .service(
                actix_files::Files::new("/", &dist).index_file("index.html"),
            )
            .default_service(web::route().to(|| async {
                let f = std::env::var("FRONTEND_DIST")
                    .unwrap_or_else(|_| "../frontend/dist".into());
                match std::fs::read_to_string(format!("{}/index.html", f)) {
                    Ok(h) => HttpResponse::Ok()
                        .content_type("text/html")
                        .body(h),
                    Err(_) => HttpResponse::Ok()
                        .content_type("text/html")
                        .body("<h1>Telegram Drive</h1><p>Frontend not built yet.</p>"),
                }
            }))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
