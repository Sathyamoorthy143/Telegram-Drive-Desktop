mod auth;
mod auth_org;
mod admin;
mod chunked;
mod debug;
mod fast_transfer;
mod files;
mod folders;
mod keep_alive;
mod meta;
mod metrics;
mod schema_check;



mod models;
mod org_files;
mod orgs;
mod preview;
mod serve_media;
mod settings;
mod share;
mod streaming;
mod supabase;
mod supabase_org;
mod tier;
mod storage;
mod replicate;
mod transcribe;
mod trash;
mod upload;
mod utils;
mod entry_unlock;
mod unlock_throttle;

use actix_cors::Cors;
use actix_web::middleware::Compress;
use actix_web::{web, App, HttpServer, HttpResponse};
use grammers_client::client::LoginToken;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, Semaphore};

use crate::models::Settings;
use crate::unlock_throttle::AttemptTracker;

pub struct AppState {
    pub client: Arc<Mutex<Option<grammers_client::Client>>>,
    pub login_token: Arc<Mutex<Option<LoginToken>>>,
    pub password_token: Arc<Mutex<Option<grammers_client::client::PasswordToken>>>,
    pub api_id: Arc<Mutex<Option<i32>>>,
    pub peer_cache: Arc<RwLock<HashMap<i64, grammers_client::peer::Peer>>>,
    pub settings: Arc<std::sync::Mutex<Settings>>,
    pub replicate_tx: replicate::ReplicateSender,
    /// Cached (premium, at) verdict, refreshed at most every TIER_CACHE_TTL.
    pub premium_cache: Arc<Mutex<(Option<bool>, Option<std::time::Instant>)>>,
    /// In-memory org member sessions (token â†’ session).
    pub org_sessions: auth_org::OrgTokenStore,
    /// Cached master-admin verdict: (is_authorized, at). A live Telegram
    /// probe on every privileged request is wasteful and flaps the pool.
    pub master_cache: Arc<Mutex<(Option<bool>, Option<std::time::Instant>)>>,
    /// Caps concurrent Telegram media downloads. Each download already fans out
    /// to 24+ RPC workers; without this, a page of thumbnails stampedes the
    /// single shared connection into flood/disconnect (`dropped (cancelled)`).
    pub download_slots: Arc<Semaphore>,
    /// Failed entry-unlock attempts per "ip:account" key (see unlock_throttle).
    pub unlock_attempts: Arc<Mutex<AttemptTracker>>,
}

/// Max simultaneous Telegram media downloads per backend instance.
pub const MAX_CONCURRENT_DOWNLOADS: usize = 3;

/// `GET /api/version` â€” lets frontends detect backend capabilities.
/// `org_platform: true` means all `/api/admin/*` + `/api/org/*` routes exist.
async fn version() -> HttpResponse {
    let api_id_present = std::env::var("TELEGRAM_API_ID")
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
        .or_else(|| {
            std::env::var("TG_API_ID")
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
        })
        .is_some();
    HttpResponse::Ok().json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "commit": std::env::var("BUILD_COMMIT")
            .or_else(|_| std::env::var("RENDER_GIT_COMMIT"))
            .unwrap_or_else(|_| "dev".into()),
        "org_platform": true,
        "tg_env": {
            "api_id": api_id_present,
            "api_hash": crate::settings::env_telegram_api_hash().is_some(),
            "phone": crate::settings::env_telegram_phone().is_some(),
        },
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    metrics::init_logging();

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
    let (replicate_tx, replicate_rx) = replicate::channel();
    let state = web::Data::new(AppState {
        client: Arc::new(Mutex::new(None)),
        login_token: Arc::new(Mutex::new(None)),
        password_token: Arc::new(Mutex::new(None)),
        api_id: Arc::new(Mutex::new(initial_api_id)),
        peer_cache: Arc::new(RwLock::new(HashMap::new())),
        settings: Arc::new(std::sync::Mutex::new(initial_settings)),
        replicate_tx: replicate_tx.clone(),
        premium_cache: Arc::new(Mutex::new((None, None))),
        org_sessions: auth_org::new_token_store(),
        master_cache: Arc::new(Mutex::new((None, None))),
        download_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS)),
        unlock_attempts: Arc::new(Mutex::new(AttemptTracker::default())),
    });

    // Background MAIN â†’ BACKUP replication worker + MAIN channel watcher.
    // Both are self-healing loops; they idle until storage is provisioned.
    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            replicate::replication_worker(worker_state, replicate_rx).await;
        });
        let watch_state = state.clone();
        tokio::spawn(async move {
            replicate::watch_main_channel(watch_state).await;
        });
        let org_watch_state = state.clone();
        tokio::spawn(async move {
            replicate::watch_org_channels(org_watch_state).await;
        });
    }

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
            // Brotli/gzip JSON responses (~60-80% smaller file lists and
            // activity feeds). Compress skips already-compressed
            // media (image/video/audio) and 206 partial content, so streaming
            // and range requests are unaffected.
            .wrap(Compress::default())
            .route("/api/health", web::get().to(keep_alive::health_check))
            .route("/health", web::get().to(keep_alive::health_check))
            .route("/api/debug/upload-probe", web::get().to(debug::upload_probe))
            .route("/s/{token}", web::get().to(share::public_share))
            .route("/api/schema/check", web::get().to(schema_check::check_schema))
            .route("/api/metrics", web::get().to(metrics::metrics_handler))
            .service(
                web::scope("/api")
                    .route("/health", web::get().to(keep_alive::health_check))
                    .route("/version", web::get().to(version))
                    .route("/connect", web::post().to(auth::connect))
                    .route("/check-connection", web::get().to(auth::check_connection))
                    .route("/auth/request-code", web::post().to(auth::request_code))
                    .route("/auth/sign-in", web::post().to(auth::sign_in))
                    .route("/auth/check-password", web::post().to(auth::check_password))
                    .route("/auth/user-info", web::get().to(auth::get_user_info))
                    .route("/auth/logout", web::post().to(auth::logout))
                    .route("/account/tier", web::get().to(tier::account_tier))
                    .route("/storage/provision", web::post().to(storage::provision_storage))
                    .route("/storage/status", web::get().to(storage::storage_status))
                    .route("/storage/backfill", web::post().to(storage::backfill_saved))
                    .route("/files", web::get().to(files::get_files))
                    .route("/files/upload", web::post().to(upload::upload_file))
                    .route("/files/upload/status", web::get().to(upload::get_upload_status))
                    .route("/files/upload/init", web::post().to(chunked::init_upload))
                    .route("/files/upload/chunk", web::put().to(chunked::put_chunk))
                    .route("/files/upload/session", web::get().to(chunked::session_status))
                    .route("/files/upload/complete", web::post().to(chunked::complete_upload_global))
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
                    .route("/preview/transcribe", web::post().to(transcribe::transcribe))
                    .route("/settings", web::get().to(settings::get_settings))
                    .route("/settings", web::put().to(settings::save_settings_handler))
                    .route("/settings/lock", web::get().to(settings::get_lock_settings))
                    .route("/settings/lock", web::put().to(settings::save_lock_settings))
                    // ---- Multi-org platform ----
                    .route("/current-org", web::get().to(orgs::current_org))
                    .route("/orgs/resolve", web::get().to(orgs::resolve_org))
                    .route("/admin/overview", web::get().to(admin::overview))
                    .route("/admin/master-unlock-status", web::get().to(admin::master_unlock_status))
                    .route("/admin/master-password", web::post().to(admin::set_master_password))
                    .route("/admin/master-unlock", web::post().to(admin::master_unlock))
                    .route("/admin/my-orgs", web::get().to(orgs::list_my_organizations))
                    .route("/admin/organizations", web::get().to(orgs::list_organizations))
                    .route("/admin/organizations", web::post().to(orgs::create_organization))
                    .route("/admin/organizations/{id}/unlock", web::post().to(orgs::unlock_organization))
                    .route("/admin/organizations/{id}/reset-entry-password", web::post().to(orgs::reset_entry_password))
                    .route("/admin/organizations/{id}", web::get().to(orgs::get_organization))
                    .route("/admin/organizations/{id}", web::put().to(orgs::update_organization))
                    .route("/admin/organizations/{id}", web::delete().to(orgs::delete_organization))
                    .route("/admin/organizations/{id}/settings", web::get().to(orgs::get_org_settings_hdl))
                    .route("/admin/organizations/{id}/settings", web::put().to(orgs::put_org_settings_hdl))
                    .route("/admin/organizations/{id}/members", web::get().to(orgs::list_members_hdl))
                    .route("/admin/organizations/{id}/members", web::post().to(orgs::create_member_hdl))
                    .route("/admin/organizations/{id}/members/{member_id}", web::delete().to(orgs::delete_member_hdl))
                    .route("/admin/organizations/{id}/activity", web::get().to(orgs::list_activity_hdl))
                    .route("/admin/organizations/{id}/activity", web::post().to(orgs::post_activity_hdl))
                    .route("/admin/organizations/{id}/provision", web::post().to(orgs::provision_org_storage))
                    .route("/org/{id}/login", web::post().to(auth_org::org_login))
                    .route("/org/{id}/logout", web::post().to(auth_org::org_logout))
                    .route("/org/{id}/me", web::get().to(auth_org::org_me))
                    .route("/org/{id}/settings", web::get().to(orgs::get_org_settings_hdl))
                    .route("/org/{id}/settings", web::put().to(orgs::put_org_settings_hdl))
                    .route("/org/{id}/members", web::get().to(orgs::list_members_hdl))
                    .route("/org/{id}/members", web::post().to(orgs::create_member_hdl))
                    .route("/org/{id}/members/{member_id}", web::delete().to(orgs::delete_member_hdl))
                    .route("/org/{id}/activity", web::get().to(orgs::list_activity_hdl))
                    .route("/org/{id}/activity", web::post().to(orgs::post_activity_hdl))
                    .route("/org/{id}/trash", web::get().to(orgs::list_trash_hdl))
                    .route("/org/{id}/trash/restore", web::post().to(orgs::restore_trash_hdl))
                    .route("/org/{id}/trash/purge", web::post().to(orgs::purge_trash_hdl))
                    .route("/org/{id}/grants", web::get().to(orgs::list_grants_hdl))
                    .route("/org/{id}/grants", web::post().to(orgs::upsert_grant_hdl))
                    .route("/org/{id}/grants/delete", web::post().to(orgs::delete_grant_hdl))
                    .route("/org/{id}/files", web::get().to(org_files::org_get_files))
                    .route("/org/{id}/files/{fid}/{mid}/download", web::get().to(org_files::org_download_file))
                    .route("/org/{id}/files/{fid}/{mid}/thumbnail", web::get().to(org_files::org_thumbnail))
                    .route("/org/{id}/files/upload", web::post().to(org_files::org_upload_file))
                    .route("/org/{id}/files/upload/init", web::post().to(chunked::org_init_upload))
                    .route("/org/{id}/files/upload/chunk", web::put().to(chunked::org_put_chunk))
                    .route("/org/{id}/files/upload/session", web::get().to(chunked::session_status))
                    .route("/org/{id}/files/upload/complete", web::post().to(chunked::org_complete_upload))
                    .route("/org/{id}/files/delete", web::post().to(org_files::org_soft_delete))
                    .route("/org/{id}/folders/scan", web::get().to(org_files::org_scan_folders))
                    .route("/org/{id}/folders/create", web::post().to(org_files::org_create_folder))
                    .route("/org/{id}/storage/status", web::get().to(org_files::org_storage_status))
                    .route("/org/{id}/alerts", web::get().to(orgs::list_alerts))
                    .route("/admin/organizations/{id}/alerts", web::get().to(orgs::list_alerts_admin_hdl))
                    // Unknown /api/* paths return JSON 404 (never index.html) so
                    // outdated-backend skew surfaces as a readable error.
                    .default_service(web::route().to(|| async {
                        HttpResponse::NotFound().json(serde_json::json!({
                            "error": "unknown api endpoint (backend may be outdated)",
                        }))
                    }))
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
                        .body("<h1>Cloudsphere Space</h1><p>Frontend not built yet.</p>"),
                }
            }))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
