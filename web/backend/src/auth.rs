use actix_web::{web, HttpResponse, Responder};
use grammers_client::Client;
use grammers_session::storages::SqliteSession;
use grammers_mtsender::SenderPool;
use std::sync::Arc;
use crate::models::*;
use crate::AppState;

pub async fn get_client(state: &AppState) -> Result<Client, String> {
    let mut g = state.client.lock().await;
    if let Some(c) = g.as_ref() {
        return Ok(c.clone());
    }
    let mut api_id = state.api_id.lock().await.unwrap_or(0);
    if api_id == 0 {
        if let Ok(s) = std::env::var("TELEGRAM_API_ID").map(|s| s.trim().parse::<i32>()) { if let Ok(id) = s { api_id = id; } }
        if api_id == 0 { if let Ok(s) = std::env::var("TG_API_ID").map(|s| s.trim().parse::<i32>()) { if let Ok(id) = s { api_id = id; } } }
        if api_id == 0 {
            let settings = state.settings.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some(id) = settings.telegram_api_id { api_id = id; }
        }
        if api_id != 0 {
            *state.api_id.lock().await = Some(api_id);
        }
    }
    if api_id == 0 {
        return Err("CONNECTION_API_ID_INVALID: API ID not set. Enter API ID in setup or set TELEGRAM_API_ID env.".into());
    }
    if api_id < 1000 {
        return Err(format!("CONNECTION_API_ID_INVALID: API ID {} too small, check my.telegram.org", api_id));
    }
    let sp = std::env::var("SESSION_PATH").unwrap_or_else(|_| "telegram.session".to_string());
    if let Some(p) = std::path::Path::new(&sp).parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if tokio::fs::metadata(&sp).await.is_err() {
        let _ = crate::supabase::restore_session_if_needed(None).await;
    }
    let session = match SqliteSession::open(&sp).await {
        Ok(s) => s,
        Err(_) => {
            let _ = crate::supabase::restore_session_if_needed(None).await;
            if tokio::fs::metadata(&sp).await.is_err() {
                let _ = std::fs::remove_file(&sp);
            } else {
                if let Ok(s) = SqliteSession::open(&sp).await {
                    let session = std::sync::Arc::new(s);
                    let pool = SenderPool::new(session, api_id);
                    let client = Client::new(pool.handle.clone());
                    let runner = pool.runner;
                    tokio::spawn(async move { let _ = runner.run().await; });
                    *g = Some(client.clone());
                    return Ok(client);
                }
                let _ = std::fs::remove_file(&sp);
            }
            SqliteSession::open(&sp)
                .await
                .map_err(|e| e.to_string())?
        }
    };
    let session = Arc::new(session);
    let pool = SenderPool::new(session, api_id);
    let client = Client::new(pool.handle.clone());
    let runner = pool.runner;
    tokio::spawn(async move {
        let _ = runner.run().await;
    });
    *g = Some(client.clone());
    Ok(client)
}

/// Drop the cached client so the next `get_client` rebuilds the sender pool
/// from the persisted session. Call when requests fail with transport-level
/// errors (`dropped (cancelled)`, disconnects) — the runner behind the cached
/// client is dead and every further call would fail the same way until reset.
pub async fn reset_client(state: &web::Data<AppState>) {
    *state.client.lock().await = None;
    crate::utils::clear_peer_cache(&state.peer_cache).await;
}

/// Delete the persisted Telegram session files (main + sqlite journals).
/// Use when auth state is unrecoverable so the next connect starts clean.
/// Safe to call only once we know the session is NOT authorized (checked via
/// `get_me`), otherwise it would sign out a live session.
fn clear_saved_session_files() {
    let sp = std::env::var("SESSION_PATH").unwrap_or_else(|_| "telegram.session".to_string());
    let _ = std::fs::remove_file(&sp);
    let _ = std::fs::remove_file(format!("{}-wal", sp));
    let _ = std::fs::remove_file(format!("{}-shm", sp));
}

/// True for transport-level failures (dead connection), as opposed to
/// Telegram API rejections like PHONE_NUMBER_INVALID.
pub fn is_transport_failure(m: &str) -> bool {
    let l = m.to_lowercase();
    l.contains("dropped") || l.contains("disconnected") || l.contains("connection reset")
}

pub async fn connect(state: web::Data<AppState>, req: web::Json<ConnectRequest>) -> impl Responder {
    *state.api_id.lock().await = Some(req.api_id);
    match get_client(&state).await {
        Ok(_) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn check_connection(state: web::Data<AppState>) -> impl Responder {
    // Reason-aware shape; the frontend boolean wrapper maps `.connected`.
    // `transport` (retry shortly) vs `unauthorized` (re-login) vs `no_client`.
    match state.client.lock().await.clone() {
        // get_me must never hang the status probe: a wedged Telegram runner
        // would otherwise trap boot/health checks behind it forever.
        Some(client) => match tokio::time::timeout(std::time::Duration::from_secs(20), client.get_me()).await {
            Ok(Ok(_)) => {
                HttpResponse::Ok().json(serde_json::json!({ "connected": true, "reason": "ok" }))
            }
            Ok(Err(e)) => {
                let m = e.to_string();
                if is_transport_failure(&m) {
                    HttpResponse::Ok().json(serde_json::json!({ "connected": false, "reason": "transport" }))
                } else {
                    HttpResponse::Ok().json(serde_json::json!({ "connected": false, "reason": "unauthorized" }))
                }
            }
            Err(_) => {
                HttpResponse::Ok().json(serde_json::json!({ "connected": false, "reason": "transport" }))
            }
        },
        None => HttpResponse::Ok().json(serde_json::json!({ "connected": false, "reason": "no_client" })),
    }
}

pub async fn request_code(
    state: web::Data<AppState>,
    req: web::Json<AuthRequest>,
) -> impl Responder {
    let api_hash = if req.api_hash.trim().is_empty() {
        crate::settings::env_telegram_api_hash().unwrap_or_default()
    } else {
        req.api_hash.trim().to_string()
    };
    if api_hash.is_empty() {
        return HttpResponse::BadRequest().body("API Hash cannot be empty");
    }
    let api_id = if req.api_id >= 1000 {
        req.api_id
    } else {
        let mut id = 0i32;
        if let Ok(s) = std::env::var("TELEGRAM_API_ID").map(|s| s.trim().parse::<i32>()) { if let Ok(v) = s { id = v; } }
        if id == 0 { if let Ok(s) = std::env::var("TG_API_ID").map(|s| s.trim().parse::<i32>()) { if let Ok(v) = s { id = v; } } }
        id
    };
    if api_id < 1000 {
        return HttpResponse::BadRequest().body(format!("API ID {} invalid. Get correct ID from https://my.telegram.org", req.api_id));
    }
    if api_hash.contains(' ') {
        return HttpResponse::BadRequest().body("API Hash cannot contain spaces");
    }
    let phone = if req.phone.trim().is_empty() {
        crate::settings::env_telegram_phone().unwrap_or_default()
    } else {
        crate::settings::normalize_phone(req.phone.trim())
    };
    if phone.trim().is_empty() {
        return HttpResponse::BadRequest().body("Phone number is required");
    }
    *state.api_id.lock().await = Some(api_id);
    {
        let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
        s.telegram_api_id = Some(api_id);
        crate::settings::save_settings(&s);
    }
    let mut client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // The persisted session may already be authorized (previous sign-in,
    // backend restart, Supabase restore). sendCode on an authorized session
    // fails with AUTH_RESTART — skip it and report signed-in directly.
    if client.get_me().await.is_ok() {
        return HttpResponse::Ok().json("already_authorized");
    }
    for attempt in 0..3 {
        // Bound each attempt: a wedged Telegram runner must never trap the
        // wizard on "Connecting..." forever. Timeouts reuse the transport-
        // failure path (rebuild pool + retry), then fail loud.
        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            client.request_login_code(&phone, &api_hash),
        )
        .await;
        let result = match outcome {
            Ok(r) => r,
            Err(_) => {
                if attempt < 2 {
                    reset_client(&state).await;
                    tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1))).await;
                    match get_client(&state).await {
                        Ok(c) => { client = c; continue; }
                        Err(e2) => return HttpResponse::BadGateway().body(format!("Telegram timed out and reconnect failed: {}", e2)),
                    }
                }
                return HttpResponse::GatewayTimeout().body(
                    "Telegram did not answer the login-code request within 60s. Wait a minute, then retry once — do not spam retries."
                );
            }
        };
        match result
        {
            Ok(token) => {
                *state.login_token.lock().await = Some(token);
                return HttpResponse::Ok().json("code_sent");
            }
            Err(e) => {
                let m = e.to_string();
                if is_transport_failure(&m) {
                    // Dead connection behind the cached client: rebuild the
                    // pool from the persisted session and retry.
                    if attempt < 2 {
                        reset_client(&state).await;
                        tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1))).await;
                        match get_client(&state).await {
                            Ok(c) => { client = c; continue; }
                            Err(e2) => return HttpResponse::BadGateway().body(format!("Telegram connection dropped and reconnect failed: {}", e2)),
                        }
                    }
                    return HttpResponse::BadGateway().body(format!("Telegram connection dropped after retry: {}", m));
                }
                if m.contains("AUTH_RESTART") {
                    // The saved auth state is stale (we already know the
                    // session is NOT authorized — get_me failed above), so
                    // retrying on it can never work. Wipe it, rebuild a
                    // clean pool, and restart the auth flow from scratch.
                    if attempt < 2 {
                        clear_saved_session_files();
                        reset_client(&state).await;
                        tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1))).await;
                        match get_client(&state).await {
                            Ok(c) => { client = c; continue; }
                            Err(e2) => return HttpResponse::BadGateway().body(format!("Auth state reset but reconnect failed: {}", e2)),
                        }
                    }
                    return HttpResponse::BadGateway().body(
                        "Telegram rejected the login-code request (AUTH_RESTART) even with a fresh session. \
                        Verify the API ID/Hash at https://my.telegram.org — they may belong to a different app or have been revoked."
                    );
                }
                if m.to_lowercase().contains("500") || m.contains("FLOOD_WAIT") {
                    if attempt < 1 {
                        continue;
                    }
                    let friendly = if m.contains("FLOOD_WAIT") {
                        format!("Telegram flood wait: {}", m)
                    } else {
                        format!("Telegram temporary error after retry: {}", m)
                    };
                    return HttpResponse::BadGateway().body(friendly);
                }
                let friendly = if m.contains("PHONE_NUMBER_INVALID") || m.contains("PhoneNumberInvalid") {
                    "Phone number appears invalid. Use international format, e.g. +1234567890".into()
                } else if m.contains("API_ID_INVALID") || m.contains("ApiIdInvalid") {
                    "Telegram rejected the API ID/Hash pair. Verify them at https://my.telegram.org".into()
                } else if m.contains("PASSWORD_HASH_INVALID") || m.contains("PasswordHashInvalid") {
                    "API ID/Hash are invalid for this account. Regenerate them at https://my.telegram.org".into()
                } else {
                    format!("request_login_code failed: {}", m)
                };
                return HttpResponse::BadRequest().body(friendly);
            }
        }
    }
    HttpResponse::BadGateway().body("Telegram error after retry")
}

pub async fn sign_in(
    state: web::Data<AppState>,
    req: web::Json<SignInRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // Take-and-restore (tokens are not Clone): a wrong/expired code must not
    // burn the token — the user retries with the same login session.
    // Cleared only on success.
    let token = { state.login_token.lock().await.take() };
    let token = match token {
        Some(t) => t,
        None => return HttpResponse::BadRequest().body("No login session: request a new code first"),
    };
    if req.code.trim().is_empty() {
        return HttpResponse::BadRequest().body("Code is required");
    }
    match client.sign_in(&token, &req.code).await {
        Ok(_) => {
            *state.login_token.lock().await = None;
            crate::auth_org::clear_master_cache(&state);
            if let Ok(me) = client.get_me().await {
                let uid = me.id().bare_id().unwrap_or(0) as i64;
                let aid = *state.api_id.lock().await;
                tokio::spawn(async move { let _ = crate::supabase::upsert_session(uid, aid).await; });
            }
            HttpResponse::Ok().json(AuthResult {
                success: true,
                next_step: Some("dashboard".into()),
                error: None,
            })
        }
        Err(grammers_client::SignInError::PasswordRequired(t)) => {
            *state.password_token.lock().await = Some(t);
            // Keep the login token too: a later wrong 2FA password must still
            // allow recovery via re-entering the SMS code.
            *state.login_token.lock().await = Some(token);
            HttpResponse::Ok().json(AuthResult {
                success: false,
                next_step: Some("password".into()),
                error: None,
            })
        }
        Err(e) => {
            // Restore the token: only a successful sign-in consumes it.
            // (PasswordToken below can't be restored — grammers consumes it —
            // but the retained login token makes recovery a re-code, not a restart.)
            *state.login_token.lock().await = Some(token);
            let m = e.to_string();
            let friendly = if m.contains("SESSION_PASSWORD_NEEDED") || m.contains("PasswordRequired") {
                "Two-factor authentication is enabled for this account.".into()
            } else if m.contains("CODE_INVALID") || m.contains("PhoneCodeInvalid") {
                "Invalid code. Request a new code and try again.".into()
            } else if m.contains("CODE_EXPIRED") || m.contains("PhoneCodeExpired") {
                "Code expired. Request a new code.".into()
            } else if m.contains("FLOOD_WAIT") {
                format!("Too many attempts: {}", m)
            } else {
                format!("sign_in failed: {}", m)
            };
            HttpResponse::BadRequest().body(friendly)
        }
    }
}

pub async fn check_password(
    state: web::Data<AppState>,
    req: web::Json<CheckPasswordRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // NOTE: grammers consumes PasswordToken on check, so a wrong password
    // still burns it — but the retained login token (above) reduces recovery
    // to re-entering the SMS code instead of restarting from the phone number.
    let pw = { state.password_token.lock().await.take() };
    let pw = match pw {
        Some(t) => t,
        None => return HttpResponse::BadRequest().body("No password session: sign in again first"),
    };
    if req.password.trim().is_empty() {
        return HttpResponse::BadRequest().body("Password is required");
    }
    match client.check_password(pw, &req.password).await {
        Ok(_) => {
            *state.password_token.lock().await = None;
            crate::auth_org::clear_master_cache(&state);
            if let Ok(me) = client.get_me().await {
                let uid = me.id().bare_id().unwrap_or(0) as i64;
                let aid = *state.api_id.lock().await;
                tokio::spawn(async move { let _ = crate::supabase::upsert_session(uid, aid).await; });
            }
            HttpResponse::Ok().json(AuthResult {
                success: true,
                next_step: Some("dashboard".into()),
                error: None,
            })
        }
        Err(e) => {
            let m = e.to_string();
            let friendly = if m.contains("PASSWORD_HASH_INVALID") || m.to_lowercase().contains("invalid") {
                "Invalid password. Please try again.".into()
            } else {
                format!("2FA failed: {}", m)
            };
            HttpResponse::BadRequest().body(friendly)
        }
    }
}

pub async fn get_user_info(state: web::Data<AppState>) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => {
            if e.contains("CONNECTION_API_ID_INVALID") || e.contains("API ID not set") {
                return HttpResponse::Unauthorized().body(e);
            }
            return HttpResponse::InternalServerError().body(e);
        }
    };
    match client.get_me().await {
        Ok(u) => {
            let id = u.id().bare_id().unwrap_or(0) as i32;
            let first_name = u.first_name().unwrap_or("").to_string();
            let last_name = u.last_name().map(|s| s.to_string());
            let username = u.username().map(|s| s.to_string());
            let phone = u.phone().map(|s| s.to_string());
            HttpResponse::Ok().json(UserInfo {
                id,
                first_name,
                last_name,
                username,
                phone,
            })
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("Unauthorized") || msg.contains("AuthKey") || msg.contains("not logged") {
                return HttpResponse::Unauthorized().body(msg);
            }
            HttpResponse::InternalServerError().body(msg)
        }
    }
}

pub async fn logout(state: web::Data<AppState>) -> impl Responder {
    // Cleanup must not depend on a live pool: previously a dead client
    // skipped the Supabase row delete (session resurrected on restart) and
    // the persisted api_id re-seeded setup. Best-effort uid, then wipe all.
    let mut uid: Option<i64> = None;
    if let Some(c) = state.client.lock().await.clone() {
        if let Ok(me) = c.get_me().await {
            uid = Some(me.id().bare_id().unwrap_or(0) as i64);
        }
        let _ = c.sign_out().await;
    }
    if let (Some(uid), Some((url, key))) = (uid, std::env::var("SUPABASE_URL").ok().zip(std::env::var("SUPABASE_SERVICE_KEY").ok().or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").ok()))) {
        let client = crate::supabase_org::http_client();
        let _ = client.delete(format!("{}/rest/v1/telegram_sessions?user_id=eq.{}", url.trim_end_matches('/'), uid))
            .header("apikey", &key).header("Authorization", format!("Bearer {}", key)).send().await;
    }
    *state.client.lock().await = None;
    *state.login_token.lock().await = None;
    *state.password_token.lock().await = None;
    *state.api_id.lock().await = None;
    crate::utils::clear_peer_cache(&state.peer_cache).await;
    clear_saved_session_files();
    crate::auth_org::clear_master_cache(&state);
    // Persisted api_id would resurrect setup on the next get_client.
    {
        let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
        s.telegram_api_id = None;
        crate::settings::save_settings(&s);
    }
    HttpResponse::Ok().json(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_failure_classifier() {
        assert!(is_transport_failure("request error: dropped (cancelled)"));
        assert!(is_transport_failure("Disconnected"));
        assert!(is_transport_failure("connection reset by peer"));
        assert!(!is_transport_failure("PHONE_NUMBER_INVALID"));
        assert!(!is_transport_failure("FLOOD_WAIT_30"));
        assert!(!is_transport_failure("API_ID_INVALID"));
    }
}
