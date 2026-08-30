use actix_web::{HttpResponse, Responder};
use tokio::time::{interval, Duration};

/// Simple health check endpoint for Render keep-alive
pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "telegram-drive-web",
        "version": "1.0.0"
    }))
}

/// Start a background task that self-pings every 4 minutes
/// to prevent Render free tier from sleeping (sleeps after 50s idle)
pub fn start_keep_alive(server_url: String) {
    let url = format!("{}/api/health", server_url);
    log::info!("Starting keep-alive ping every 4 minutes to: {}", url);

    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(240)); // 4 minutes
        loop {
            ticker.tick().await;
            match reqwest::get(&url).await {
                Ok(resp) => {
                    log::debug!(
                        "Keep-alive ping: {} (status: {})",
                        url,
                        resp.status()
                    );
                }
                Err(e) => {
                    log::warn!("Keep-alive ping failed: {}", e);
                }
            }
        }
    });
}

