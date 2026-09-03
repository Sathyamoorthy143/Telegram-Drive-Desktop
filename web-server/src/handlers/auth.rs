use actix_web::{web, HttpResponse, Responder};
use crate::TelegramState;
use crate::models::{AuthResult, UserInfo};
use crate::utils::map_error;
use grammers_client::{Client};
use grammers_mtsender::SenderPool;
use grammers_session::storages::SqliteSession;
use std::sync::Arc;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SendOtpRequest {
    pub phone: String,
}

pub async fn auth_send_otp(state: web::Data<TelegramState>, req: web::Json<SendOtpRequest>) -> impl Responder {
    // Ensure a client exists
    match get_client(&state).await {
        Ok(client) => {
            // Use api_id and api_hash from state if needed
            let api_id = state.api_id.unwrap_or(0);
            let api_hash = &state.api_hash;
            // grammers_client's request_login_code expects phone and api_hash, using api_id indirectly
            match client.request_login_code(&req.phone, api_hash).await {
                Ok(token) => {
                    *state.login_token.lock().await = Some(token);
                    HttpResponse::Ok().json("code_sent")
                }
                Err(e) => HttpResponse::InternalServerError().body(map_error(e)),
            }
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}


#[derive(Deserialize)]
pub struct AuthRequest {
    pub phone: String,
    pub api_id: i32,
    pub api_hash: String,
}

#[derive(Deserialize)]
pub struct SignInRequest {
    pub code: String,
}

pub async fn get_client(state: &TelegramState) -> Result<Client, String> {
    let mut client_guard = state.client.lock().await;
    if let Some(client) = client_guard.as_ref() {
        return Ok(client.clone());
    }

    // Initialization logic
    let session = SqliteSession::open("telegram.session").map_err(|e| e.to_string())?;
    let pool = SenderPool::new(Arc::new(session), state.api_id.unwrap_or(0));
    let client = Client::new(&pool);
    
    let SenderPool { runner, .. } = pool;
    tokio::spawn(async move {
        let _ = runner.run().await;
    });

    *client_guard = Some(client.clone());
    Ok(client)
}

pub async fn auth_request_code(
    state: web::Data<TelegramState>,
    req: web::Json<AuthRequest>,
) -> impl Responder {
    match get_client(&state).await {
        Ok(client) => {
            match client.request_login_code(&req.phone, &req.api_hash).await {
                Ok(token) => {
                    *state.login_token.lock().await = Some(token);
                    HttpResponse::Ok().json("code_sent")
                }
                Err(e) => HttpResponse::InternalServerError().body(map_error(e)),
            }
        }
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn auth_sign_in(
    state: web::Data<TelegramState>,
    req: web::Json<SignInRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    let mut token_guard = state.login_token.lock().await;
    let token = match token_guard.take() {
        Some(t) => t,
        None => return HttpResponse::BadRequest().body("No login token found"),
    };

    match client.sign_in(&token, &req.code).await {
        Ok(_) => HttpResponse::Ok().json(AuthResult {
            success: true,
            next_step: Some("dashboard".to_string()),
            error: None,
        }),
        Err(e) => HttpResponse::InternalServerError().json(AuthResult {
            success: false,
            next_step: None,
            error: Some(e.to_string()),
        }),
    }
}

pub async fn get_user_info(state: web::Data<TelegramState>) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    match client.get_me().await {
        Ok(user) => HttpResponse::Ok().json(UserInfo {
            id: user.raw.id(),
            first_name: user.first_name().unwrap_or("").to_string(),
            last_name: user.last_name().map(|s| s.to_string()),
            username: user.username().map(|s| s.to_string()),
            phone: user.phone().map(|s| s.to_string()),
            profile_photo_id: None,
        }),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}
