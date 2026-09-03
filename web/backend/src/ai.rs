use actix_web::{web, HttpResponse, Responder};
use reqwest::Client;

use crate::models::*;

pub async fn gemini_chat(req: web::Json<ChatRequest>) -> impl Responder {
    let proxy_url = std::env::var("AI_PROXY_URL")
        .unwrap_or_else(|_| "https://telegram-drive-desktop.onrender.com/chat".to_string());

    let client = Client::new();
    let body = serde_json::json!({ "message": req.message });

    let res = match client.post(&proxy_url).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Proxy request failed: {}", e))
        }
    };

    if !res.status().is_success() {
        return HttpResponse::InternalServerError().body("AI Proxy error");
    }

    let resp_body: serde_json::Value = res.json().await.unwrap_or_default();
    let reply = resp_body["reply"]
        .as_str()
        .unwrap_or("No reply")
        .to_string();

    HttpResponse::Ok().json(ChatResponse { reply })
}
