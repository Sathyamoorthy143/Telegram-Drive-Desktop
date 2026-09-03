use actix_web::{web, HttpResponse, Responder};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use crate::AppState;
use chrono::{Utc, Duration};

type HmacSha256 = Hmac<Sha256>;

/// Server secret for stateless share tokens. Set SHARE_SECRET in production;
/// falls back to the Telegram API hash (already secret), else an ephemeral key
/// (links break on restart — logged as a warning).
fn share_secret() -> Vec<u8> {
    if let Ok(s) = std::env::var("SHARE_SECRET") {
        if !s.trim().is_empty() {
            return s.into_bytes();
        }
    }
    if let Ok(s) = std::env::var("TG_API_HASH").or_else(|_| std::env::var("TELEGRAM_API_HASH")) {
        if !s.trim().is_empty() {
            return s.into_bytes();
        }
    }
    log::warn!("SHARE_SECRET not set — using ephemeral key, share links break on restart");
    uuid::Uuid::new_v4().as_bytes().to_vec()
}

/// Stateless token: `{mid}.{fid}.{exp}.{sig}` where sig is the first 32 hex
/// chars of HMAC-SHA256(secret, "mid:fid:exp"). Verifiable without any DB,
/// so public previews work even when Supabase tables are missing.
fn mint_token(message_id: i32, folder_id: Option<i64>, exp_unix: i64) -> String {
    let fid = folder_id.unwrap_or(0);
    let msg = format!("{}:{}:{}", message_id, fid, exp_unix);
    let mut mac = HmacSha256::new_from_slice(&share_secret()).expect("hmac key");
    mac.update(msg.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    format!("{}.{}.{}.{}", message_id, fid, exp_unix, &sig[..32])
}

fn verify_token(token: &str) -> Option<(i32, Option<i64>, i64)> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mid: i32 = parts[0].parse().ok()?;
    let fid_raw: i64 = parts[1].parse().ok()?;
    let exp: i64 = parts[2].parse().ok()?;
    let msg = format!("{}:{}:{}", mid, fid_raw, exp);
    let mut mac = HmacSha256::new_from_slice(&share_secret()).expect("hmac key");
    mac.update(msg.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    if sig[..32] != parts[3].to_lowercase() {
        return None;
    }
    let fid = if fid_raw == 0 { None } else { Some(fid_raw) };
    Some((mid, fid, exp))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShareLink {
    pub token: String,
    pub message_id: i32,
    pub folder_id: Option<i64>,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub views: i32,
}

#[derive(Deserialize)]
pub struct CreateShareRequest {
    pub message_id: i32,
    pub folder_id: Option<i64>,
    pub expiry_days: Option<i64>, // default 7
}

async fn supabase_req(method: &str, path: &str, body: Option<serde_json::Value>) -> Result<reqwest::Response, String> {
    let url = std::env::var("SUPABASE_URL").map_err(|_| "no supabase".to_string())?;
    let key = std::env::var("SUPABASE_SERVICE_KEY").or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY")).or_else(|_| std::env::var("SUPABASE_ANON_KEY")).map_err(|_| "no key".to_string())?;
    let client = reqwest::Client::new();
    let full = format!("{}/rest/v1/{}", url.trim_end_matches('/'), path.trim_start_matches('/'));
    let mut req = match method {
        "GET" => client.get(&full),
        "POST" => client.post(&full),
        "DELETE" => client.delete(&full),
        _ => client.get(&full),
    };
    req = req.header("apikey", &key).header("Authorization", format!("Bearer {}", key));
    if method == "POST" { req = req.header("Prefer", "return=representation").header("Content-Type", "application/json"); }
    if let Some(b) = body { req = req.json(&b); }
    req.send().await.map_err(|e| e.to_string())
}

pub async fn create_share(state: web::Data<AppState>, req: web::Json<CreateShareRequest>) -> impl Responder {
    if crate::auth::get_client(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Not authenticated");
    }
    // Stateless signed token — always works, even without Supabase tables.
    let days = req.expiry_days.unwrap_or(7).clamp(1, 365);
    let exp_dt = Utc::now() + Duration::days(days);
    let token = mint_token(req.message_id, req.folder_id, exp_dt.timestamp());
    let expires_at = exp_dt.to_rfc3339();
    // Best-effort Supabase row so links show up in list/revoke/views.
    // Failures (e.g. missing table) are logged, never fatal.
    let row = serde_json::json!({
        "token": token,
        "message_id": req.message_id,
        "folder_id": req.folder_id,
        "expires_at": expires_at,
        "views": 0
    });
    match supabase_req("POST", "shared_links", Some(row)).await {
        Ok(resp) if resp.status().is_success() => {}
        Ok(resp) => {
            let txt = resp.text().await.unwrap_or_default();
            log::warn!("shared_links insert skipped (list/revoke unavailable): {}", txt.chars().take(160).collect::<String>());
        }
        Err(e) => log::warn!("shared_links insert skipped (list/revoke unavailable): {}", e),
    }
    let base = std::env::var("FRONTEND_URL").or_else(|_| std::env::var("DOMAIN")).unwrap_or("https://frestorage.dpdns.org".into());
    let url = format!("{}/s/{}", base.trim_end_matches('/'), token);
    HttpResponse::Ok().json(serde_json::json!({ "token": token, "url": url, "expires_at": expires_at }))
}

pub async fn list_shares(state: web::Data<AppState>) -> impl Responder {
    if crate::auth::get_client(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Not authenticated");
    }
    match supabase_req("GET", "shared_links?select=*&order=created_at.desc", None).await {
        Ok(r) if r.status().is_success() => HttpResponse::Ok().json(r.json::<serde_json::Value>().await.unwrap_or(serde_json::json!([]))),
        _ => HttpResponse::Ok().json(serde_json::json!([]))
    }
}

pub async fn delete_share(state: web::Data<AppState>, path: web::Path<String>) -> impl Responder {
    if crate::auth::get_client(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Not authenticated");
    }
    let token = path.into_inner();
    let _ = supabase_req("DELETE", &format!("shared_links?token=eq.{}", token), None).await;
    HttpResponse::Ok().json(true)
}

pub async fn public_share(
    req: actix_web::HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let token = path.into_inner();
    // Stateless tokens verify locally (no DB needed); legacy 8-char tokens
    // fall back to the Supabase lookup.
    let (mid, fid, name): (i32, Option<i64>, Option<String>) = match verify_token(&token) {
        Some((mid, fid, exp)) => {
            if exp < Utc::now().timestamp() {
                return HttpResponse::Gone().body("Link expired");
            }
            (mid, fid, None)
        }
        None => {
            let resp = match supabase_req("GET", &format!("shared_links?token=eq.{}&select=*", token), None).await {
                Ok(r) => r,
                Err(e) => return HttpResponse::InternalServerError().body(e),
            };
            if !resp.status().is_success() {
                return HttpResponse::NotFound().body("Share not found");
            }
            let rows: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
            let row = match rows.into_iter().next() {
                Some(r) => r,
                None => return HttpResponse::NotFound().body("Invalid token"),
            };
            if let Some(exp) = row.get("expires_at").and_then(|v| v.as_str()) {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(exp) {
                    if dt < Utc::now() {
                        return HttpResponse::Gone().body("Link expired");
                    }
                }
            }
            let mid = row.get("message_id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let fid = row.get("folder_id").and_then(|v| v.as_i64());
            let name = row.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
            // increment views async (best effort)
            let token_clone = token.clone();
            let url_clone = std::env::var("SUPABASE_URL").ok();
            let key_clone = std::env::var("SUPABASE_SERVICE_KEY").ok().or_else(|| std::env::var("SUPABASE_ANON_KEY").ok());
            if let (Some(u), Some(k)) = (url_clone, key_clone) {
                tokio::spawn(async move {
                    let c = reqwest::Client::new();
                    let _ = c.post(format!("{}/rest/v1/rpc/increment_share_views", u))
                        .header("apikey", &k).header("Authorization", format!("Bearer {}", k))
                        .json(&serde_json::json!({"p_token": token_clone})).send().await;
                });
            }
            (mid, fid, name)
        }
    };
    // stream file via Telegram
    let client = match crate::auth::get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match crate::utils::resolve_peer_ref(&client, fid, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let msgs = match client.get_messages_by_id(peer, &[mid]).await {
        Ok(m) => m,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };
    let msg = match msgs.into_iter().flatten().next() {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("File not found"),
    };
    let media = match msg.media() {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("No media"),
    };
    let mime = match &media {
        grammers_client::media::Media::Document(d) => d.mime_type().unwrap_or("application/octet-stream").to_string(),
        _ => "application/octet-stream".to_string(),
    };
    let size = match &media {
        grammers_client::media::Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };
    let disp = format!("inline; filename=\"{}\"", name.as_deref().unwrap_or("file"));
    let etag = format!("\"share-{}-{}\"", token, mid);
    match crate::fast_transfer::range_decision(&req, &etag, size) {
        crate::fast_transfer::RangeDecision::NotModified => HttpResponse::NotModified().finish(),
        crate::fast_transfer::RangeDecision::Unsatisfiable => HttpResponse::build(actix_web::http::StatusCode::RANGE_NOT_SATISFIABLE)
            .insert_header(("Content-Range", format!("bytes */{}", size)))
            .finish(),
        crate::fast_transfer::RangeDecision::Full => {
            let stream = crate::fast_transfer::download_stream(&client, media);
            HttpResponse::Ok().content_type(mime)
                .insert_header(("Content-Disposition", disp))
                .insert_header(("Content-Length", size.to_string()))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
                .streaming(stream)
        }
        crate::fast_transfer::RangeDecision::Partial(s, e) => {
            let stream = crate::fast_transfer::download_range_stream(&client, media, Some((s, e)));
            HttpResponse::PartialContent().content_type(mime)
                .insert_header(("Content-Disposition", disp))
                .insert_header(("Content-Length", (e - s + 1).to_string()))
                .insert_header(("Content-Range", format!("bytes {}-{}/{}", s, e, size)))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
                .streaming(stream)
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stateless_token_roundtrip() {
        std::env::set_var("SHARE_SECRET", "test-secret-123");
        let t = mint_token(42, Some(99), 9999999999);
        assert_eq!(t.split('.').count(), 4);
        let (mid, fid, exp) = verify_token(&t).expect("valid token");
        assert_eq!((mid, fid, exp), (42, Some(99), 9999999999));
        let t2 = mint_token(7, None, 9999999999);
        let (mid2, fid2, _) = verify_token(&t2).expect("valid token");
        assert_eq!((mid2, fid2), (7, None));
    }

    #[test]
    fn stateless_token_tamper_rejected() {
        std::env::set_var("SHARE_SECRET", "test-secret-123");
        let t = mint_token(42, Some(99), 9999999999);
        assert!(verify_token(&(t.clone() + "x")).is_none());
        assert!(verify_token("abc").is_none());
        assert!(verify_token("1.2.3").is_none());
        let mut parts: Vec<&str> = t.split('.').collect();
        parts[0] = "43";
        assert!(verify_token(&parts.join(".")).is_none());
        parts[0] = "42";
        parts[2] = "1111111111";
        assert!(verify_token(&parts.join(".")).is_none());
    }
}