use actix_web::{web, App, HttpServer, Responder, HttpResponse};
use actix_files::Files;
use actix_cors::Cors;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use std::collections::HashMap;
use dotenvy::dotenv;
use std::env;

mod models;
mod security;
mod handlers;
mod utils;

pub struct TelegramState {
    pub client: Arc<Mutex<Option<grammers_client::Client>>>,
    pub login_token: Arc<Mutex<Option<grammers_client::types::LoginToken>>>,
    pub peer_cache: Arc<RwLock<HashMap<i64, grammers_client::types::Peer>>>,
    pub api_id: Option<i32>,
    pub api_hash: String,
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("--- Telegram Drive Server Starting ---");
    dotenv().ok();
    env_logger::init();

    let port_str = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let port: u16 = port_str.parse().expect("PORT must be a number");
    let api_id = env::var("TG_API_ID").ok().and_then(|s| s.parse().ok());
    let api_hash = env::var("TG_API_HASH").unwrap_or_default();

    println!("Listening on 0.0.0.0:{}", port);

    let state = web::Data::new(TelegramState {
        client: Arc::new(Mutex::new(None)),
        login_token: Arc::new(Mutex::new(None)),
        peer_cache: Arc::new(RwLock::new(HashMap::new())),
        api_id,
        api_hash,
    });

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .wrap(Cors::permissive())
            .service(
                web::scope("/api")
                    // Auth
                    .route("/auth/request-code", web::post().to(handlers::auth_request_code))
                    .route("/auth/sign-in", web::post().to(handlers::auth_sign_in))
                    .route("/auth/user-info", web::get().to(handlers::get_user_info))
                    
                    // Files & Folders
                    .route("/files", web::get().to(handlers::get_files))
                    .route("/folders/scan", web::get().to(handlers::scan_folders))
                    .route("/folders/create", web::post().to(handlers::create_folder))
                    .route("/files/delete", web::post().to(handlers::delete_file))
                    .route("/get-bandwidth", web::get().to(handlers::get_bandwidth))
                    
                    // AI
                    .route("/gemini-chat", web::post().to(handlers::gemini_chat))
                    
                    // Streaming & Previews
                    .route("/get-stream-info", web::get().to(handlers::get_stream_info))
                    .route("/get-preview", web::get().to(handlers::get_preview))
                    .route("/get-thumbnail", web::get().to(handlers::get_thumbnail))
            )
            .service(Files::new("/", "./dist").index_file("index.html"))
            // SPA catch-all
            .default_service(web::route().to(|| async {
                HttpResponse::Ok()
                    .content_type("text/html")
                    .body(include_str!("../dist/index.html"))
            }))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
