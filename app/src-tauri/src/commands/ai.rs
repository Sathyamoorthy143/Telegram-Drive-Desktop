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
    settings: State<'_, SettingsState>,
) -> Result<String, String> {
    let (api_key, theme) = {
        let guard = settings.0.lock().unwrap();
        (guard.gemini_api_key.clone(), guard.theme.clone())
    };

    let key = api_key.ok_or("Gemini API key not configured. Please go to Settings.")?;
    
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key={}",
        key
    );

    let body = GeminiRequest {
        contents: vec![Content {
            parts: vec![Part { text: prompt }],
        }],
    };

    let res = client.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Gemini API error: {}", err_text));
    }

    let resp_body: GeminiResponse = res.json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    let text = resp_body.candidates.get(0)
        .ok_or("No response candidates from Gemini")?
        .content.parts.get(0)
        .ok_or("No text part in Gemini response")?
        .text.clone();

    Ok(text)
}
