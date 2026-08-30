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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_settings_defaults_when_no_file_or_env() {
        std::env::set_var("SETTINGS_PATH", "/tmp/nonexistent_settings_test.json");
        std::env::remove_var("TELEGRAM_CHANNEL_ID");
        std::env::remove_var("BACKUP_CHANNEL_ID");
        std::env::remove_var("AI_PROXY_URL");
        std::env::remove_var("TELEGRAM_API_ID");

        let s = load_settings();
        assert_eq!(s.channel_id, None);
        assert_eq!(s.backup_channel_id, None);
        assert_eq!(s.ai_proxy_url, None);
    }

    /// Single consolidated test for file loading, env var overrides, and roundtrip.
    /// Combined to avoid env var pollution from parallel test execution.
    #[test]
    fn settings_file_and_env_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        // 1. File loading: write settings, load them back
        let file_settings = Settings {
            channel_id: Some(42),
            backup_channel_id: Some(99),
            telegram_api_id: Some(12345),
            theme: Some("dark".into()),
            ai_proxy_url: None,
        };
        std::fs::write(&path, serde_json::to_string(&file_settings).unwrap()).unwrap();
        std::env::set_var("SETTINGS_PATH", path.to_str().unwrap());
        std::env::remove_var("TELEGRAM_CHANNEL_ID");
        std::env::remove_var("BACKUP_CHANNEL_ID");
        std::env::remove_var("AI_PROXY_URL");

        let s = load_settings();
        assert_eq!(s.channel_id, Some(42));
        assert_eq!(s.backup_channel_id, Some(99));
        assert_eq!(s.theme.as_deref(), Some("dark"));

        // 2. Env vars override file settings
        std::env::set_var("TELEGRAM_CHANNEL_ID", "999");
        std::env::set_var("BACKUP_CHANNEL_ID", "888");
        std::env::set_var("AI_PROXY_URL", "https://proxy.test");

        let s = load_settings();
        assert_eq!(s.channel_id, Some(999));
        assert_eq!(s.backup_channel_id, Some(888));
        assert_eq!(s.ai_proxy_url.as_deref(), Some("https://proxy.test"));

        // 3. Roundtrip: save then reload
        std::env::remove_var("TELEGRAM_CHANNEL_ID");
        std::env::remove_var("BACKUP_CHANNEL_ID");
        std::env::remove_var("AI_PROXY_URL");

        let roundtrip = Settings {
            channel_id: Some(100),
            backup_channel_id: Some(200),
            telegram_api_id: None,
            theme: None,
            ai_proxy_url: Some("https://roundtrip.test".into()),
        };
        save_settings(&roundtrip);
        let reloaded = load_settings();
        assert_eq!(reloaded.channel_id, Some(100));
        assert_eq!(reloaded.backup_channel_id, Some(200));
        assert_eq!(reloaded.ai_proxy_url.as_deref(), Some("https://roundtrip.test"));
    }
}
