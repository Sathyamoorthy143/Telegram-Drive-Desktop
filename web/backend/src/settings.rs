use actix_web::{web, HttpResponse, Responder};
use crate::models::Settings;
use crate::AppState;

pub fn load_settings() -> Settings {
    // First try file, then env vars
    let path = std::env::var("SETTINGS_PATH").unwrap_or_else(|_| "settings.json".into());
    let mut settings: Settings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();

    // Override with env vars if set
    if let Ok(id) = std::env::var("TELEGRAM_CHANNEL_ID") {
        settings.channel_id = id.parse().ok();
    }
    if let Ok(id) = std::env::var("BACKUP_CHANNEL_ID") {
        settings.backup_channel_id = id.parse().ok();
    }
    if let Ok(url) = std::env::var("AI_PROXY_URL") {
        settings.ai_proxy_url = Some(url);
    }
    if let Ok(id) = std::env::var("TELEGRAM_API_ID") {
        settings.telegram_api_id = id.parse().ok();
    }

    settings
}

fn save_settings(s: &Settings) {
    let path = std::env::var("SETTINGS_PATH").unwrap_or_else(|_| "settings.json".into());
    if let Ok(j) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(path, j);
    }
}

pub async fn get_settings(state: web::Data<AppState>) -> impl Responder {
    let s = state.settings.lock().unwrap().clone();
    HttpResponse::Ok().json(s)
}

pub async fn save_settings_handler(
    state: web::Data<AppState>,
    req: web::Json<Settings>,
) -> impl Responder {
    let mut s = state.settings.lock().unwrap();
    *s = req.into_inner();
    save_settings(&s);
    HttpResponse::Ok().json(true)
}
