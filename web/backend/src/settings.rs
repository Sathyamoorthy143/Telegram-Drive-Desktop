use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;
use crate::models::Settings;
use crate::AppState;

pub fn load_settings() -> Settings {
    let path = std::env::var("SETTINGS_PATH").unwrap_or_else(|_| "settings.json".into());
    if let Some(p) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let mut settings: Settings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();

    if let Ok(id) = std::env::var("TELEGRAM_CHANNEL_ID") {
        settings.channel_id = id.parse().ok();
    }
    if let Ok(id) = std::env::var("BACKUP_CHANNEL_ID") {
        settings.backup_channel_id = id.parse().ok();
    }
    if let Ok(id) = std::env::var("TELEGRAM_API_ID") {
        settings.telegram_api_id = id.parse().ok();
    }

    if settings.lock_interval_ms.is_none() {
        if let Ok(v) = std::env::var("LOCK_INTERVAL_MS") {
            settings.lock_interval_ms = v.parse().ok();
        }
    }
    if settings.notification_mode.is_none() {
        if let Ok(v) = std::env::var("NOTIFICATION_MODE") {
            settings.notification_mode = Some(v);
        }
    }

    settings
}

pub fn save_settings(s: &Settings) {
    let path = std::env::var("SETTINGS_PATH").unwrap_or_else(|_| "settings.json".into());
    if let Some(p) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if let Ok(j) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(path, j);
    }
}

pub async fn get_settings(state: web::Data<AppState>) -> impl Responder {
    let s = state.settings.lock().unwrap_or_else(|e| e.into_inner()).clone();
    HttpResponse::Ok().json(s)
}

pub async fn save_settings_handler(
    state: web::Data<AppState>,
    req: web::Json<Settings>,
) -> impl Responder {
    let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
    *s = req.into_inner();
    save_settings(&s);
    if s.lock_pin_hash.is_some() || s.lock_interval_ms.is_some() || s.notification_mode.is_some() {
        let pin = s.lock_pin_hash.clone();
        let interval = s.lock_interval_ms;
        let mode = s.notification_mode.clone();
        let client_opt = state.client.lock().await.clone();
        if let Some(c) = client_opt {
            if let Ok(me) = c.get_me().await {
                let uid = me.id().bare_id().unwrap_or(0) as i64;
                tokio::spawn(async move {
                    let _ = crate::supabase::upsert_user_settings(uid, pin, interval, mode).await;
                });
            }
        }
    }
    HttpResponse::Ok().json(true)
}

#[derive(Deserialize, Debug, Clone)]
pub struct LockSettingsRequest {
    pub pin: Option<String>,
    pub lock_interval_ms: Option<i64>,
    pub notification_mode: Option<String>,
}

pub async fn save_lock_settings(
    state: web::Data<AppState>,
    req: web::Json<LockSettingsRequest>,
) -> impl Responder {
    let pin_hash = req.pin.as_ref().map(|p| crate::supabase::hash_pin(p));
    let interval = req.lock_interval_ms;
    let mode = req.notification_mode.clone();

    {
        let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(h) = pin_hash.clone() { s.lock_pin_hash = Some(h); }
        if interval.is_some() { s.lock_interval_ms = interval; }
        if mode.is_some() { s.notification_mode = mode.clone(); }
        save_settings(&s);
    }

    let client_opt = state.client.lock().await.clone();
    if let Some(c) = client_opt {
        if let Ok(me) = c.get_me().await {
            let uid = me.id().bare_id().unwrap_or(0) as i64;
            match crate::supabase::upsert_user_settings(uid, pin_hash, interval, mode).await {
                Ok(_) => return HttpResponse::Ok().json(true),
                Err(e) => return HttpResponse::InternalServerError().body(e),
            }
        }
    }
    HttpResponse::Ok().json(true)
}

pub async fn get_lock_settings(state: web::Data<AppState>) -> impl Responder {
    let s = state.settings.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let client_opt = state.client.lock().await.clone();
    if let Some(c) = client_opt {
        if let Ok(me) = c.get_me().await {
            let uid = me.id().bare_id().unwrap_or(0) as i64;
            if let Some(row) = crate::supabase::get_user_settings(uid).await {
                let mut merged = s;
                if row.lock_pin_hash.is_some() { merged.lock_pin_hash = row.lock_pin_hash; }
                if row.lock_interval_ms.is_some() { merged.lock_interval_ms = row.lock_interval_ms; }
                if row.notification_mode.is_some() { merged.notification_mode = row.notification_mode; }
                return HttpResponse::Ok().json(merged);
            }
        }
    }
    HttpResponse::Ok().json(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_settings_defaults_when_no_file_or_env() {
        std::env::set_var("SETTINGS_PATH", "/tmp/nonexistent_settings_test.json");
        std::env::remove_var("TELEGRAM_CHANNEL_ID");
        std::env::remove_var("BACKUP_CHANNEL_ID");
        std::env::remove_var("TELEGRAM_API_ID");

        let s = load_settings();
        assert_eq!(s.channel_id, None);
        assert_eq!(s.backup_channel_id, None);
    }

    #[test]
    fn settings_file_and_env_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let file_settings = Settings {
            channel_id: Some(42),
            backup_channel_id: Some(99),
            telegram_api_id: Some(12345),
            theme: Some("dark".into()),
            lock_pin_hash: None,
            lock_interval_ms: None,
            notification_mode: None,
            encryption_enabled: None,
        };
        std::fs::write(&path, serde_json::to_string(&file_settings).unwrap()).unwrap();
        std::env::set_var("SETTINGS_PATH", path.to_str().unwrap());
        std::env::remove_var("TELEGRAM_CHANNEL_ID");
        std::env::remove_var("BACKUP_CHANNEL_ID");

        let s = load_settings();
        assert_eq!(s.channel_id, Some(42));
        assert_eq!(s.backup_channel_id, Some(99));
        assert_eq!(s.theme.as_deref(), Some("dark"));

        std::env::set_var("TELEGRAM_CHANNEL_ID", "999");
        std::env::set_var("BACKUP_CHANNEL_ID", "888");

        let s = load_settings();
        assert_eq!(s.channel_id, Some(999));
        assert_eq!(s.backup_channel_id, Some(888));

        std::env::remove_var("TELEGRAM_CHANNEL_ID");
        std::env::remove_var("BACKUP_CHANNEL_ID");

        let roundtrip = Settings {
            channel_id: Some(100),
            backup_channel_id: Some(200),
            telegram_api_id: None,
            theme: None,
            lock_pin_hash: None,
            lock_interval_ms: None,
            notification_mode: None,
            encryption_enabled: None,
        };
        save_settings(&roundtrip);
        let reloaded = load_settings();
        assert_eq!(reloaded.channel_id, Some(100));
        assert_eq!(reloaded.backup_channel_id, Some(200));
    }
}
