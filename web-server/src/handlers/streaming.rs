use actix_web::{web, HttpResponse, Responder};

#[derive(serde::Serialize)]
pub struct StreamInfo {
    pub token: String,
    pub base_url: String,
}

pub async fn get_stream_info() -> impl Responder {
    // In production, base_url would be the deployed domain
    let domain = std::env::var("VERCEL_URL").unwrap_or_else(|_| "localhost:8080".to_string());
    let scheme = if domain.contains("localhost") { "http" } else { "https" };
    
    HttpResponse::Ok().json(StreamInfo {
        token: "session-token".to_string(),
        base_url: format!("{}://{}", scheme, domain),
    })
}
