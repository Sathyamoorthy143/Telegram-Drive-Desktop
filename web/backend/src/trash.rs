use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrashItem {
    pub id: i64, // message_id
    pub folder_id: Option<i64>,
    pub name: String,
    pub size: u64,
    pub deleted_at: String,
    pub icon_type: String,
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
        "PATCH" => client.patch(&full),
        _ => client.get(&full),
    };
    req = req.header("apikey", &key).header("Authorization", format!("Bearer {}", key));
    if method == "POST" {
        req = req.header("Prefer", "return=representation").header("Content-Type", "application/json");
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    req.send().await.map_err(|e| e.to_string())
}

pub async fn soft_delete(state: web::Data<AppState>, req: web::Json<crate::models::DeleteFileRequest>) -> impl Responder {
    // fetch file metadata before trash
    let client = match crate::auth::get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    let peer = match crate::utils::resolve_peer_ref(&client, req.folder_id, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // get file name via get_messages_by_id
    let mut name = format!("file-{}", req.message_id);
    let mut size = 0u64;
    if let Ok(msgs) = client.get_messages_by_id(peer, &[req.message_id]).await {
        if let Some(Some(msg)) = msgs.into_iter().next() {
            if let Some(media) = msg.media() {
                if let grammers_client::media::Media::Document(d) = media {
                    name = d.name().unwrap_or(&name).to_string();
                    size = d.size().unwrap_or(0) as u64;
                }
            }
        }
    }
    let item = serde_json::json!({
        "message_id": req.message_id,
        "folder_id": req.folder_id,
        "name": name,
        "size": size as i64,
        "deleted_at": chrono::Utc::now().to_rfc3339(),
    });
    // insert into trash_items for soft delete (restorable)
    let trashed = match supabase_req("POST", "trash_items", Some(item)).await {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            let txt = resp.text().await.unwrap_or_default();
            log::warn!("trash insert failed (falling back to hard delete): {}", txt.chars().take(160).collect::<String>());
            false
        }
        Err(e) => {
            log::warn!("trash insert failed (falling back to hard delete): {}", e);
            false
        }
    };
    if !trashed {
        // Supabase unavailable (e.g. missing trash_items table): honor the
        // delete intent with a hard delete instead of silently keeping the file.
        match client.delete_messages(peer, &[req.message_id]).await {
            Ok(_) => HttpResponse::Ok().json(true),
            Err(e) => HttpResponse::InternalServerError().body(format!("Delete failed: {}", e)),
        }
    } else {
        // do NOT delete from Telegram yet - soft delete
        HttpResponse::Ok().json(true)
    }
}

pub async fn list_trash(state: web::Data<AppState>) -> impl Responder {
    // verify auth
    if crate::auth::get_client(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Not authenticated");
    }
    match supabase_req("GET", "trash_items?select=*&order=deleted_at.desc", None).await {
        Ok(resp) => {
            if resp.status().is_success() {
                let v: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!([]));
                HttpResponse::Ok().json(v)
            } else {
                HttpResponse::Ok().json(serde_json::json!([]))
            }
        },
        Err(_) => HttpResponse::Ok().json(serde_json::json!([]))
    }
}

#[derive(Deserialize)]
pub struct RestoreRequest { pub message_id: i32, pub folder_id: Option<i64> }

pub async fn restore(state: web::Data<AppState>, req: web::Json<RestoreRequest>) -> impl Responder {
    if crate::auth::get_client(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Not authenticated");
    }
    let _ = supabase_req("DELETE", &format!("trash_items?message_id=eq.{}&folder_id={}", req.message_id, req.folder_id.map(|v| format!("eq.{}", v)).unwrap_or("is.null".into())), None).await;
    HttpResponse::Ok().json(true)
}

/// Permanently delete one trashed item: remove the Telegram message (if it
/// still exists) and drop its trash row.
pub async fn purge(state: web::Data<AppState>, req: web::Json<RestoreRequest>) -> impl Responder {
    let client = match crate::auth::get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    if let Ok(peer) = crate::utils::resolve_peer_ref(&client, req.folder_id, &state.peer_cache).await {
        let _ = client.delete_messages(peer, &[req.message_id]).await;
    }
    let _ = supabase_req("DELETE", &format!("trash_items?message_id=eq.{}&folder_id={}", req.message_id, req.folder_id.map(|v| format!("eq.{}", v)).unwrap_or("is.null".into())), None).await;
    HttpResponse::Ok().json(true)
}

pub async fn empty_trash(state: web::Data<AppState>) -> impl Responder {
    let client = match crate::auth::get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    // list trash
    let resp = match supabase_req("GET", "trash_items?select=*", None).await {
        Ok(r) => r,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let items: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
    for it in &items {
        if let (Some(mid), Some(fid)) = (it.get("message_id").and_then(|v| v.as_i64()), it.get("folder_id")) {
            let folder_id = fid.as_i64();
            if let Ok(peer) = crate::utils::resolve_peer_ref(&client, folder_id, &state.peer_cache).await {
                let _ = client.delete_messages(peer, &[mid as i32]).await;
            }
        }
    }
    let _ = supabase_req("DELETE", "trash_items?message_id=gt.0", None).await;
    HttpResponse::Ok().json(true)
}
