use actix_web::{web, HttpResponse, Responder};
use grammers_client::Client;
use grammers_session::storages::SqliteSession;
use grammers_mtsender::SenderPool;
use std::sync::Arc;
use crate::models::*;
use crate::utils::map_error;
use crate::AppState;

pub async fn get_client(state: &AppState) -> Result<Client, String> {
    let mut g = state.client.lock().await;
    if let Some(c) = g.as_ref() {
        return Ok(c.clone());
    }
    let api_id = state.api_id.lock().await.unwrap_or(0);
    let sp = std::env::var("SESSION_PATH").unwrap_or_else(|_| "telegram.session".to_string());
    let session = match SqliteSession::open(&sp).await {
        Ok(s) => s,
        Err(_) => {
            let _ = std::fs::remove_file(&sp);
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
    if req.api_hash.trim().is_empty() {
        return HttpResponse::BadRequest().body("API Hash cannot be empty");
    }
    *state.api_id.lock().await = Some(req.api_id);
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    for _ in 0..2 {
        match client
            .request_login_code(&req.phone, &req.api_hash)
            .await
        {
            Ok(token) => {
                *state.login_token.lock().await = Some(token);
                return HttpResponse::Ok().json("code_sent");
            }
            Err(e) => {
                let m = e.to_string();
                if m.contains("AUTH_RESTART") || m.contains("500") {
                    continue;
                }
                return HttpResponse::InternalServerError().body(map_error(e));
            }
        }
    }
    HttpResponse::InternalServerError().body("Telegram error after retry")
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
        None => return HttpResponse::BadRequest().body("No login session"),
    };
    match client.sign_in(&token, &req.code).await {
        Ok(_) => HttpResponse::Ok().json(AuthResult {
            success: true,
            next_step: Some("dashboard".into()),
            error: None,
        }),
        Err(grammers_client::SignInError::PasswordRequired(t)) => {
            *state.password_token.lock().await = Some(t);
            HttpResponse::Ok().json(AuthResult {
                success: false,
                next_step: Some("password".into()),
                error: None,
            })
        }
        Err(e) => HttpResponse::InternalServerError().body(format!("Sign in failed: {}", e)),
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
        None => return HttpResponse::BadRequest().body("No password session"),
    };
    match client.check_password(pw, &req.password).await {
        Ok(_) => HttpResponse::Ok().json(AuthResult {
            success: true,
            next_step: Some("dashboard".into()),
            error: None,
        }),
        Err(e) => HttpResponse::InternalServerError().body(format!("2FA Failed: {}", e)),
    }
}

pub async fn get_user_info(state: web::Data<AppState>) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
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
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

pub async fn logout(state: web::Data<AppState>) -> impl Responder {
    if let Some(c) = state.client.lock().await.clone() {
        let _ = c.sign_out().await;
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
