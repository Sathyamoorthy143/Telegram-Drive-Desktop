use actix_web::{web, HttpResponse, Responder};
use grammers_client::Client;
use grammers_session::storages::SqliteSession;
use grammers_mtsender::SenderPool;
use std::panic::{self, AssertUnwindSafe};
use std::sync::Arc;
use crate::models::*;
use crate::utils::map_error;
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
            let settings = state.settings.lock().unwrap_or_else(|e| e.into_inner().clone());
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

pub async fn connect(state: web::Data<AppState>, req: web::Json<ConnectRequest>) -> impl Responder {
    *state.api_id.lock().await = Some(req.api_id);
    match get_client(&state).await {
        Ok(_) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn check_connection(state: web::Data<AppState>) -> impl Responder {
    let c = state.client.lock().await.clone();
    if let Some(client) = c {
        if client.get_me().await.is_ok() {
            return HttpResponse::Ok().json(true);
        }
    }
    HttpResponse::Ok().json(false)
}

pub async fn request_code(
    state: web::Data<AppState>,
    req: web::Json<AuthRequest>,
) -> impl Responder {
    let api_hash = req.api_hash.trim().to_string();
    if api_hash.is_empty() {
        return HttpResponse::BadRequest().body("API Hash cannot be empty");
    }
    if req.api_id < 1000 {
        return HttpResponse::BadRequest().body(format!("API ID {} invalid. Get correct ID from https://my.telegram.org", req.api_id));
    }
    if api_hash.contains(' ') {
        return HttpResponse::BadRequest().body("API Hash cannot contain spaces");
    }
    if req.phone.trim().is_empty() {
        return HttpResponse::BadRequest().body("Phone number is required");
    }
    *state.api_id.lock().await = Some(req.api_id);
    {
        let mut s = state.settings.lock().unwrap_or_else(|e| e.into_inner());
        s.telegram_api_id = Some(req.api_id);
        crate::settings::save_settings(&s);
    }
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    for attempt in 0..2 {
        match client
            .request_login_code(&req.phone, &api_hash)
            .await
        {
            Ok(token) => {
                *state.login_token.lock().await = Some(token);
                return HttpResponse::Ok().json("code_sent");
            }
            Err(e) => {
                let m = e.to_string();
                if m.contains("AUTH_RESTART") || m.to_lowercase().contains("500") || m.contains("FLOOD_WAIT") {
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
            HttpResponse::Ok().json(AuthResult {
                success: false,
                next_step: Some("password".into()),
                error: None,
            })
        }
        Err(e) => {
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
    if let Some(c) = state.client.lock().await.clone() {
        if let Ok(me) = c.get_me().await {
            let uid = me.id().bare_id().unwrap_or(0) as i64;
            let _ = c.sign_out().await;
            if let Some((url, key)) = std::env::var("SUPABASE_URL").ok().zip(std::env::var("SUPABASE_SERVICE_KEY").ok().or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").ok())) {
                let client = reqwest::Client::new();
                let _ = client.delete(format!("{}/rest/v1/telegram_sessions?user_id=eq.{}", url.trim_end_matches('/'), uid))
                    .header("apikey", &key).header("Authorization", format!("Bearer {}", key)).send().await;
            }
        } else {
            let _ = c.sign_out().await;
        }
    }
    *state.client.lock().await = None;
    *state.login_token.lock().await = None;
    *state.password_token.lock().await = None;
    *state.api_id.lock().await = None;
    crate::utils::clear_peer_cache(&state.peer_cache).await;
    let sp = std::env::var("SESSION_PATH").unwrap_or_else(|_| "telegram.session".to_string());
    let _ = std::fs::remove_file(&sp);
    let _ = std::fs::remove_file(format!("{}-wal", sp));
    let _ = std::fs::remove_file(format!("{}-shm", sp));
    HttpResponse::Ok().json(true)
}
