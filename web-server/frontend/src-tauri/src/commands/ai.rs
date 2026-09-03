use tauri::State;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use crate::commands::settings::SettingsState;

#[derive(Serialize, Deserialize)]
struct GeminiRequest {
    contents: Vec<Content>,
}

#[derive(Serialize, Deserialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Serialize, Deserialize)]
struct Part {
    text: String,
}

#[derive(Serialize, Deserialize)]
struct GeminiResponse {
    candidates: Vec<Candidate>,
}

#[derive(Serialize, Deserialize)]
struct Candidate {
    content: Content,
}

#[tauri::command]
pub async fn cmd_gemini_chat(
    prompt: String,
    settings_state: State<'_, SettingsState>,
) -> Result<String, String> {
    let url = {
        let settings = settings_state.0.lock().unwrap();
        settings.ai_proxy_url.clone()
    };

    let client = Client::new();
    let body = serde_json::json!({
        "message": prompt
    });

    let res = client.post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Proxy request failed: {}. Make sure ai_proxy.py is running.", e))?;

    if !res.status().is_success() {
        let err_json: serde_json::Value = res.json().await.unwrap_or_default();
        let err_msg = err_json["error"].as_str().unwrap_or("Unknown proxy error");
        return Err(format!("Proxy error: {}", err_msg));
    }

    let resp_body: serde_json::Value = res.json()
        .await
        .map_err(|e| format!("Failed to parse proxy response: {}", e))?;

    let text = resp_body["reply"].as_str()
        .ok_or("No reply from proxy")?
        .to_string();

    Ok(text)
}
