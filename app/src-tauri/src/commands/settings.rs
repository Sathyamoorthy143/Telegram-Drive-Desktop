use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub gemini_api_key: Option<String>,
    pub telegram_api_id: Option<i32>,
    pub theme: String,
    pub auto_login: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gemini_api_key: None,
            telegram_api_id: None,
            theme: "dark".to_string(),
            auto_login: true,
        }
    }
}

pub struct SettingsState(pub Mutex<AppSettings>);

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, SettingsState>) -> Result<AppSettings, String> {
    let settings = state.0.lock().unwrap();
    Ok(settings.clone())
}

#[tauri::command]
pub async fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, SettingsState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Update memory state
    {
        let mut state_lock = state.0.lock().unwrap();
        *state_lock = settings.clone();
    }

    // Save to disk
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_data_dir.exists() {
        let _ = fs::create_dir_all(&app_data_dir);
    }
    let file_path = app_data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(file_path, json).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn init_settings(app_handle: &tauri::AppHandle) -> AppSettings {
    let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("data"));
    let file_path = app_data_dir.join("settings.json");

    if file_path.exists() {
        let content = fs::read_to_string(file_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}
