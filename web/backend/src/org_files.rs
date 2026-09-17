//! Org-scoped file + folder operations.
//!
//! Same Telegram mechanics as [`crate::files`] / [`crate::folders`], but:
//! - the channel id comes from `org_settings` (per-org MAIN channel), never
//!   the global settings file;
//! - soft deletes land in `org_trash` (per-org, separate from global trash);
//! - every mutating op enforces viewer/editor roles and writes an
//!   `org_audit_logs` row (best-effort).

use actix_multipart::Multipart;
use actix_web::{web, HttpRequest, HttpResponse, Responder};
use futures::StreamExt;
use grammers_client::media::Media;
use grammers_client::peer::Peer;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::auth::get_client;
use crate::auth_org::require_org_role;
use crate::models::FileMetadata;
use crate::storage;
use crate::supabase_org;
use crate::upload::deliver_to_telegram;
use crate::utils::{map_error, peer_bare_id, resolve_peer_ref};
use crate::AppState;

async fn org_main_or_400(
    _state: &web::Data<AppState>,
    org_id: &str,
) -> Result<i64, HttpResponse> {
    let (main, _) = storage::org_channel_ids(org_id).await;
    match main {
        Some(id) => Ok(id),
        None => Err(HttpResponse::BadRequest()
            .body("Organization not provisioned. Create org and Telegram channels first.")),
    }
}

async fn org_trashed_set(org_id: &str, folder_id: Option<i64>) -> std::collections::HashSet<i64> {
    let fid = folder_id.unwrap_or(0);
    match supabase_org::list_org_trash(org_id).await {
        Ok(rows) => rows
            .into_iter()
            .filter(|r| r.get("folder_id").and_then(|v| v.as_i64()).unwrap_or(0) == fid)
            .filter_map(|r| r.get("message_id").and_then(|v| v.as_i64()))
            .collect(),
        Err(_) => std::collections::HashSet::new(),
    }
}

/// `GET /api/org/{id}/files?folder_id=` — viewer+.
pub async fn org_get_files(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::models::GetFilesRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    let org_main = match org_main_or_400(&state, &org_id).await {
        Ok(id) => id,
        Err(e) => return e,
    };
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(
        &client,
        Some(query.folder_id.unwrap_or(org_main)),
        &state.peer_cache,
    )
    .await
    {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let trashed = org_trashed_set(&org_id, query.folder_id).await;
    let mut files = Vec::new();
    let mut msgs = client.iter_messages(peer);
    while let Ok(Some(msg)) = msgs.next().await {
        if trashed.contains(&(msg.id() as i64)) {
            continue;
        }
        if let Some(doc) = msg.media() {
            let (name, size, mime, ext) = match doc {
                Media::Document(d) => {
                    let n = d.name().unwrap_or("Unknown").to_string();
                    let s = d.size().unwrap_or(0);
                    let m = d.mime_type().map(|s| s.to_string());
                    let e = std::path::Path::new(&n)
                        .extension()
                        .and_then(|o| o.to_str())
                        .map(|s| s.to_string());
                    (n, s, m, e)
                }
                Media::Photo(_) => (
                    "Photo.jpg".into(),
                    0,
                    Some("image/jpeg".into()),
                    Some("jpg".into()),
                ),
                _ => ("Unknown".into(), 0, None, None),
            };
            files.push(FileMetadata {
                id: msg.id() as i64,
                folder_id: query.folder_id,
                name,
                size: size as u64,
                mime_type: mime,
                file_ext: ext,
                created_at: msg.date().to_string(),
                icon_type: "file".into(),
            });
        }
    }
    HttpResponse::Ok().json(files)
}

/// `GET /api/org/{id}/files/{fid}/{mid}/download` — viewer+. Same streaming
/// mechanics as the global download, but the channel defaults to the org MAIN
/// channel (subfolder channels via `fid`) instead of global settings.
pub async fn org_download_file(
    req: HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<(String, i64, i32)>,
) -> impl Responder {
    let (org_id, fid, mid) = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "viewer").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let uid = crate::auth_org::db_user_id(&sess);
    let ip = req.peer_addr().map(|a| a.ip().to_string());
    let ua = req
        .headers()
        .get(actix_web::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    supabase_org::audit_best_effort(
        &org_id, uid, "file.download", "file", &mid.to_string(),
        serde_json::json!({ "folder_id": fid }),
        ip, ua,
    )
    .await;
    let org_main = match org_main_or_400(&state, &org_id).await {
        Ok(id) => id,
        Err(e) => return e,
    };
    let fid_opt = if fid == 0 { None } else { Some(fid) };
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(&client, fid_opt.or(Some(org_main)), &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let msgs = match client.get_messages_by_id(peer, &[mid]).await {
        Ok(m) => m,
        Err(e) => return HttpResponse::InternalServerError().body(e.to_string()),
    };
    let msg = match msgs.into_iter().flatten().next() {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("Not found"),
    };
    let media = match msg.media() {
        Some(m) => m,
        None => return HttpResponse::NotFound().body("No media"),
    };
    let size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };
    let mime = match &media {
        Media::Document(d) => d
            .mime_type()
            .unwrap_or("application/octet-stream")
            .to_string(),
        _ => "application/octet-stream".to_string(),
    };
    let etag = format!("\"{}-{}-{}\"", org_id, fid, mid);
    let workers = crate::fast_transfer::worker_count_for(crate::tier::premium_cached(&state).await);
    match crate::fast_transfer::range_decision(&req, &etag, size) {
        crate::fast_transfer::RangeDecision::NotModified => HttpResponse::NotModified().finish(),
        crate::fast_transfer::RangeDecision::Unsatisfiable => HttpResponse::build(actix_web::http::StatusCode::RANGE_NOT_SATISFIABLE)
            .insert_header(("Content-Range", format!("bytes */{}", size)))
            .finish(),
        crate::fast_transfer::RangeDecision::Full => {
            let stream = crate::fast_transfer::download_stream(&client, media, workers);
            HttpResponse::Ok()
                .content_type(mime)
                .insert_header(("Content-Length", size.to_string()))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("ETag", etag))
                .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
                .streaming(stream)
        }
        crate::fast_transfer::RangeDecision::Partial(s, e) => {
            let stream = crate::fast_transfer::download_range_stream(&client, media, Some((s, e)), workers);
            HttpResponse::PartialContent()
                .content_type(mime)
                .insert_header(("Content-Length", (e - s + 1).to_string()))
                .insert_header(("Content-Range", format!("bytes {}-{}/{}", s, e, size)))
                .insert_header(("Accept-Ranges", "bytes"))
                .insert_header(("Cache-Control", "public, max-age=31536000, immutable"))
                .streaming(stream)
        }
    }
}

#[derive(serde::Deserialize)]
pub struct OrgDeleteRequest {
    pub message_id: i32,
    pub folder_id: Option<i64>,
}

/// `POST /api/org/{id}/files/delete` — editor+. Soft delete into org_trash.
pub async fn org_soft_delete(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgDeleteRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let org_main = match org_main_or_400(&state, &org_id).await {
        Ok(id) => id,
        Err(e) => return e,
    };
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    let peer = match resolve_peer_ref(
        &client,
        Some(body.folder_id.unwrap_or(org_main)),
        &state.peer_cache,
    )
    .await
    {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let mut name = format!("file-{}", body.message_id);
    let mut size = 0u64;
    if let Ok(msgs) = client.get_messages_by_id(peer, &[body.message_id]).await {
        if let Some(Some(msg)) = msgs.into_iter().next() {
            if let Some(media) = msg.media() {
                if let Media::Document(d) = media {
                    name = d.name().unwrap_or(&name).to_string();
                    size = d.size().unwrap_or(0) as u64;
                }
            }
        }
    }
    let row = serde_json::json!({
        "org_id": org_id,
        "message_id": body.message_id,
        "folder_id": body.folder_id.unwrap_or(0),
        "name": name,
        "size": size as i64,
        "deleted_at": chrono::Utc::now().to_rfc3339(),
    });
    if supabase_org::is_configured() {
        if let Err(e) = supabase_org::insert_org_trash(row).await {
            log::warn!("org trash insert failed: {}", e.chars().take(160).collect::<String>());
            // Fall back to hard delete so the delete intent is honored.
            match client.delete_messages(peer, &[body.message_id]).await {
                Ok(_) => {}
                Err(e) => return HttpResponse::InternalServerError().body(format!("Delete failed: {}", e)),
            }
        }
    } else {
        match client.delete_messages(peer, &[body.message_id]).await {
            Ok(_) => {}
            Err(e) => return HttpResponse::InternalServerError().body(format!("Delete failed: {}", e)),
        }
    }
    let uid = crate::auth_org::db_user_id(&sess);
    supabase_org::audit_best_effort(
        &org_id, uid, "file.delete", "file", &body.message_id.to_string(),
        serde_json::json!({ "name": name, "folder_id": body.folder_id }),
        None, None,
    )
    .await;
    HttpResponse::Ok().json(true)
}

/// `GET /api/org/{id}/folders/scan` — viewer+. Only folders tagged with this
/// org's `org_id:` line (isolation: no cross-org leakage).
pub async fn org_scan_folders(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let want_line = storage::org_folder_line(&org_id);
    let mut folders = Vec::new();
    let mut dialogs = client.iter_dialogs();
    let mut cache = state.peer_cache.write().await;
    while let Ok(Some(dialog)) = dialogs.next().await {
        if let Peer::Channel(c) = &dialog.peer {
            let id = peer_bare_id(&dialog.peer).unwrap_or(0);
            cache.insert(id, dialog.peer.clone());
            let title = c.title();
            if !title.to_lowercase().contains("[td]") {
                continue;
            }
            let raw = &c.raw;
            let input_chan = grammers_tl_types::enums::InputChannel::Channel(
                grammers_tl_types::types::InputChannel {
                    channel_id: raw.id,
                    access_hash: raw.access_hash.unwrap_or(0),
                },
            );
            let mut belongs = false;
            let mut parent_id = None;
            if let Ok(grammers_tl_types::enums::messages::ChatFull::Full(full)) = client
                .invoke(&grammers_tl_types::functions::channels::GetFullChannel {
                    channel: input_chan,
                })
                .await
            {
                if let grammers_tl_types::enums::ChatFull::ChannelFull(cf) = full.full_chat {
                    if cf.about.contains("[telegram-drive-folder]")
                        && cf.about.lines().any(|l| l.trim() == want_line)
                    {
                        belongs = true;
                        parent_id = cf
                            .about
                            .lines()
                            .find(|l| l.starts_with("parent_id:"))
                            .and_then(|l| l.split(':').nth(1))
                            .and_then(|s| s.parse::<i64>().ok());
                    }
                }
            }
            if !belongs {
                continue;
            }
            let display = title
                .replace(" [TD]", "")
                .replace(" [td]", "")
                .replace("[TD]", "")
                .replace("[td]", "")
                .trim()
                .to_string();
            // Strip "{org} — " prefix added at creation for display.
            let display = display.split(" — ").last().unwrap_or(&display).to_string();
            folders.push(crate::models::FolderMetadata { id, name: display, parent_id });
        }
    }
    HttpResponse::Ok().json(folders)
}

#[derive(serde::Deserialize)]
pub struct OrgCreateFolderRequest {
    pub name: String,
    pub parent_id: Option<i64>,
}

/// `POST /api/org/{id}/folders/create` — editor+. Titles are prefixed
/// `{org_name} — {name} [TD]` and the about text carries the org line.
pub async fn org_create_folder(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<OrgCreateFolderRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let clean = body.name.trim();
    if clean.is_empty() {
        return HttpResponse::BadRequest().body("Folder name cannot be empty");
    }
    let org_name = supabase_org::get_org_by_id(&org_id)
        .await
        .ok()
        .flatten()
        .map(|o| o.name)
        .unwrap_or_else(|| "Org".into());
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let about = match body.parent_id {
        Some(pid) => format!(
            "parent_id:{}\n[telegram-drive-folder]\n{}",
            pid,
            storage::org_folder_line(&org_id)
        ),
        None => format!(
            "Cloudsphere Space Storage Folder\n[telegram-drive-folder]\n{}",
            storage::org_folder_line(&org_id)
        ),
    };
    let result = client
        .invoke(&grammers_tl_types::functions::channels::CreateChannel {
            broadcast: true,
            megagroup: false,
            title: format!("{} — {} [TD]", org_name, clean),
            about,
            geo_point: None,
            address: None,
            for_import: false,
            forum: false,
            ttl_period: None,
        })
        .await;
    match result {
        Ok(grammers_tl_types::enums::Updates::Updates(u)) => match u.chats.into_iter().next() {
            Some(grammers_tl_types::enums::Chat::Channel(c)) => {
                let uid = crate::auth_org::db_user_id(&sess);
                supabase_org::audit_best_effort(
                    &org_id, uid, "folder.create", "folder", &c.id.to_string(),
                    serde_json::json!({ "name": clean }), None, None,
                )
                .await;
                HttpResponse::Ok().json(crate::models::FolderMetadata {
                    id: c.id,
                    name: clean.to_string(),
                    parent_id: body.parent_id,
                })
            }
            _ => HttpResponse::InternalServerError().body("Not a channel"),
        },
        Ok(_) => HttpResponse::InternalServerError().body("Unexpected response"),
        Err(e) => HttpResponse::InternalServerError().body(map_error(e)),
    }
}

/// `GET /api/org/{id}/storage/status` — viewer+.
pub async fn org_storage_status(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "viewer").await {
        return e;
    }
    let (main, backup) = storage::org_channel_ids(&org_id).await;
    HttpResponse::Ok().json(serde_json::json!({
        "provisioned": main.is_some() && backup.is_some(),
        "main_channel_id": main,
        "backup_channel_id": backup,
    }))
}

/// `POST /api/org/{id}/files/upload` — editor+. Multipart upload that
/// resolves the org's MAIN channel from Supabase and delivers there.
pub async fn org_upload_file(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    mut payload: Multipart,
) -> impl Responder {
    let org_id = path.into_inner();
    if let Err(e) = require_org_role(&state, &req, &org_id, "editor").await {
        return e;
    }
    let (org_main, org_backup) = storage::org_channel_ids(&org_id).await;
    let main_id = match org_main {
        Some(id) => id,
        None => {
            return HttpResponse::BadRequest()
                .body("Organization not provisioned. Create org and Telegram channels first.")
        }
    };

    let mut folder_id: Option<i64> = None;
    let mut file_name: Option<String> = None;
    let mut total_size: u64 = 0;
    let tmp_dir = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .body(format!("Failed to create temp dir: {}", e))
        }
    };
    let mut tmp_file: Option<fs::File> = None;
    let mut tmp_path: Option<std::path::PathBuf> = None;
    let mut got_file = false;
    let max_size = crate::tier::current_cap(&state).await;

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => return HttpResponse::BadRequest().body(format!("Multipart error: {}", e)),
        };
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "folder_id" => {
                let mut val = Vec::new();
                while let Some(chunk) = field.next().await {
                    if let Ok(b) = chunk {
                        val.extend_from_slice(&b);
                    }
                }
                folder_id = String::from_utf8(val)
                    .ok()
                    .and_then(|s| s.parse::<i64>().ok());
            }
            "file" => {
                got_file = true;
                let raw_name = field
                    .content_disposition()
                    .and_then(|cd| cd.get_filename().map(|s| s.to_string()))
                    .unwrap_or_else(|| "upload.bin".to_string());
                let safe_name = std::path::Path::new(&raw_name)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .filter(|s| !s.is_empty() && s != ".")
                    .unwrap_or_else(|| "upload.bin".to_string());
                file_name = Some(safe_name.clone());
                log::info!("Org upload started: {} for folder {:?}", safe_name, folder_id);
                let path = tmp_dir.path().join(&safe_name);
                let f = match fs::File::create(&path).await {
                    Ok(f) => f,
                    Err(e) => {
                        return HttpResponse::InternalServerError()
                            .body(format!("Failed to create temp file: {}", e))
                    }
                };
                tmp_path = Some(path);
                let mut tf = f;
                while let Some(chunk) = field.next().await {
                    match chunk {
                        Ok(data) => {
                            total_size += data.len() as u64;
                            if total_size > max_size {
                                return HttpResponse::PayloadTooLarge()
                                    .body(format!("File too large. Max: {} bytes", max_size));
                            }
                            if let Err(e) = tf.write_all(&data).await {
                                return HttpResponse::InternalServerError()
                                    .body(format!("Write error: {}", e));
                            }
                        }
                        Err(e) => {
                            return HttpResponse::InternalServerError()
                                .body(format!("Upload read error: {}", e));
                        }
                    }
                }
                tmp_file = Some(tf);
            }
            _ => {
                while let Some(chunk) = field.next().await {
                    if chunk.is_err() {
                        break;
                    }
                }
            }
        }
    }

    if !got_file {
        return HttpResponse::BadRequest().body("No file field in upload");
    }

    let fname = file_name.unwrap_or_else(|| "upload.bin".to_string());
    let tmp_path = match tmp_path {
        Some(p) => p,
        None => return HttpResponse::InternalServerError().body("Temp file missing"),
    };
    let mut tmp_file = match tmp_file {
        Some(f) => f,
        None => return HttpResponse::InternalServerError().body("Temp file missing"),
    };
    if let Err(e) = tmp_file.flush().await {
        return HttpResponse::InternalServerError().body(format!("Flush error: {}", e));
    }
    drop(tmp_file);

    log::info!(
        "Org upload received {} bytes for '{}', uploading to Telegram...",
        total_size,
        fname
    );

    let (resp, _msg_id) = deliver_to_telegram(
        state,
        tmp_path.clone(),
        fname.clone(),
        folder_id,
        total_size,
        Some(main_id),
        org_backup,
    )
    .await;

    let _ = fs::remove_file(&tmp_path).await;
    let _ = tmp_dir.close();
    resp
}
