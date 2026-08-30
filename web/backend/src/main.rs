mod ai;
mod auth;
mod files;
mod folders;
mod keep_alive;
mod models;
mod preview;
mod settings;
mod streaming;
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

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a number");

    log::info!("Telegram Drive Web Server starting on 0.0.0.0:{}", port);

    let state = web::Data::new(AppState {
        client: Arc::new(Mutex::new(None)),
        login_token: Arc::new(Mutex::new(None)),
        password_token: Arc::new(Mutex::new(None)),
        api_id: Arc::new(Mutex::new(None)),
        peer_cache: Arc::new(RwLock::new(HashMap::new())),
        settings: Arc::new(std::sync::Mutex::new(settings::load_settings())),
    });

    // Start keep-alive self-ping if RENDER_EXTERNAL_URL is set
    if let Ok(url) = std::env::var("RENDER_EXTERNAL_URL") {
        log::info!("Render detected, starting keep-alive for: {}", url);
        keep_alive::start_keep_alive(url);
    } else if let Ok(url) = std::env::var("KEEP_ALIVE_URL") {
        // Manual override for non-Render deployments
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
            .wrap(cors)
            // Health check (keep-alive endpoint)
            .route("/api/health", web::get().to(keep_alive::health_check))
            .route("/health", web::get().to(keep_alive::health_check))
            .service(
                web::scope("/api")
                    // Auth routes
                    .route("/connect", web::post().to(auth::connect))
                    .route("/check-connection", web::get().to(auth::check_connection))
                    .route("/auth/request-code", web::post().to(auth::request_code))
                    .route("/auth/sign-in", web::post().to(auth::sign_in))
                    .route(
                        "/auth/check-password",
                        web::post().to(auth::check_password),
                    )
                    .route("/auth/user-info", web::get().to(auth::get_user_info))
                    .route("/auth/logout", web::post().to(auth::logout))
                    // File routes
                    .route("/files", web::get().to(files::get_files))
                    .route(
                        "/files/upload",
                        web::post().to(upload::upload_file),
                    )
                    .route(
                        "/files/upload/status",
                        web::get().to(upload::get_upload_status),
                    )
                    .route(
                        "/files/{fid}/{mid}/download",
                        web::get().to(files::download_file),
                    )
                    .route("/files/delete", web::post().to(files::delete_file))
                    .route("/files/move", web::post().to(files::move_files))
                    .route("/files/copy", web::post().to(files::copy_files))
                    .route("/files/search", web::get().to(files::search_files))
                    .route("/bandwidth", web::get().to(files::get_bandwidth))
                    // Folder routes
                    .route("/folders/scan", web::get().to(folders::scan_folders))
                    .route("/folders/create", web::post().to(folders::create_folder))
                    .route(
                        "/folders/{id}/rename",
                        web::put().to(folders::rename_folder),
                    )
                    .route(
                        "/folders/{id}/delete",
                        web::delete().to(folders::delete_folder),
                    )
                    .route(
                        "/folders/{id}/properties",
                        web::get().to(folders::get_folder_properties),
                    )
                    // Streaming routes
                    .route("/stream-info", web::get().to(streaming::get_stream_info))
                    .route(
                        "/stream/{fid}/{mid}",
                        web::get().to(streaming::stream_media),
                    )
                    // Preview routes
                    .route(
                        "/preview/{fid}/{mid}",
                        web::get().to(preview::get_preview),
                    )
                    .route(
                        "/thumbnail/{fid}/{mid}",
                        web::get().to(preview::get_thumbnail),
                    )
                    // AI routes
                    .route("/ai/chat", web::post().to(ai::gemini_chat))
                    // Settings routes
                    .route("/settings", web::get().to(settings::get_settings))
                    .route("/settings", web::put().to(settings::save_settings_handler)),
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
