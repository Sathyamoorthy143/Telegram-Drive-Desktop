use actix_web::{web, HttpResponse, Responder};
use std::time::{Duration, Instant};
use crate::AppState;

/// Probe each Telegram stage with short timeouts and return a JSON breakdown.
/// Uploads 18 bytes via upload_stream ONLY (no message is sent, no spam).
pub async fn upload_probe(state: web::Data<AppState>) -> impl Responder {
    let mut out = serde_json::Map::new();
    let t = Instant::now();
    let client = match tokio::time::timeout(Duration::from_secs(10), crate::auth::get_client(&state)).await {
        Ok(Ok(c)) => { out.insert("get_client_ms".into(), serde_json::json!(t.elapsed().as_millis() as u64)); c }
        Ok(Err(e)) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "get_client", "error": e })),
        Err(_) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "get_client", "error": "timeout 10s" })),
    };
    let t = Instant::now();
    match tokio::time::timeout(Duration::from_secs(10), client.get_me()).await {
        Ok(Ok(_)) => { out.insert("get_me_ms".into(), serde_json::json!(t.elapsed().as_millis() as u64)); }
        Ok(Err(e)) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "get_me", "error": e.to_string() })),
        Err(_) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "get_me", "error": "timeout 10s" })),
    }
    let t = Instant::now();
    let peer = match tokio::time::timeout(
        Duration::from_secs(10),
        crate::utils::resolve_peer_ref(&client, None, &state.peer_cache),
    )
    .await
    {
        Ok(Ok(p)) => { out.insert("resolve_peer_ms".into(), serde_json::json!(t.elapsed().as_millis() as u64)); p }
        Ok(Err(e)) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "resolve_peer", "error": e })),
        Err(_) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "resolve_peer", "error": "timeout 10s" })),
    };
    let _ = peer;
    let t = Instant::now();
    // Use a temp file like the real upload path does.
    let tmp = match tempfile::NamedTempFile::new() {
        Ok(f) => f,
        Err(e) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "tempfile", "error": e.to_string() })),
    };
    if let Err(e) = std::fs::write(tmp.path(), b"probe-18-bytes....") {
        return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "tempfile_write", "error": e.to_string() }));
    }
    let mut f = match tokio::fs::File::open(tmp.path()).await {
        Ok(f) => f,
        Err(e) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "tempfile_open", "error": e.to_string() })),
    };
    match tokio::time::timeout(
        Duration::from_secs(25),
        client.upload_stream(&mut f, 18, "probe.txt".to_string()),
    )
    .await
    {
        Ok(Ok(_)) => { out.insert("upload_stream_ms".into(), serde_json::json!(t.elapsed().as_millis() as u64)); }
        Ok(Err(e)) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "upload_stream", "error": e.to_string(), "elapsed_ms": t.elapsed().as_millis() as u64 })),
        Err(_) => return HttpResponse::Ok().json(serde_json::json!({ "error_stage": "upload_stream", "error": "timeout 25s", "elapsed_ms": t.elapsed().as_millis() as u64 })),
    }
    out.insert("ok".into(), serde_json::Value::Bool(true));
    HttpResponse::Ok().json(out)
}
