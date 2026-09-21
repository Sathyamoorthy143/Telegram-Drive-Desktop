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
use grammers_client::media::Media;
use grammers_client::peer::Peer;
use tokio::fs;

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
    match supabase_org::list_org_trash(org_id, None).await {
        Ok(rows) => rows
            .into_iter()
            .filter(|r| r.get("folder_id").and_then(|v| v.as_i64()).unwrap_or(0) == fid)
            .filter_map(|r| r.get("message_id").and_then(|v| v.as_i64()))
            .collect(),
        Err(_) => std::collections::HashSet::new(),
    }
}

/// `GET /api/org/{id}/files?folder_id=` — viewer+ (+ folder grant `view`).
pub async fn org_get_files(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<crate::models::GetFilesRequest>,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "viewer").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, query.folder_id, "view").await {
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
    // Bounded channel walk, same semantics as global get_files.
    let page_limit = crate::models::files_page_limit(query.limit);
    let page_offset = crate::models::files_page_offset(query.offset);
    let mut walked: usize = 0;
    let mut msgs = client.iter_messages(peer);
    while let Ok(Some(msg)) = msgs.next().await {
        if walked < page_offset {
            walked += 1;
            continue;
        }
        if let Some(n) = page_limit {
            if walked >= page_offset + n {
                break;
            }
        }
        walked += 1;
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
    if let Err(e) = crate::auth_org::check_folder_access(
        &state,
        &org_id,
        &sess,
        if fid == 0 { None } else { Some(fid) },
        "read",
    )
    .await
    {
        return e;
    }
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
    // Previews/thumbnails don't need bulk throughput: a small fixed worker
    // count plus the global download semaphore keeps a page of thumbnails
    // from stampeding the shared connection (flood → `dropped (cancelled)`).
    crate::serve_media::serve_media(
        &state,
        &req,
        fid_opt,
        Some(org_main),
        mid,
        4usize,
        None,
        "public, max-age=31536000, immutable",
    )
    .await
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
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, body.folder_id, "write").await {
        return e;
    }
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
    // Same split as global scan_folders: sequential dialog walk with no lock
    // held and no RPCs, one bulk cache insert, then concurrent GetFullChannel
    // (join_all preserves order). The old code held `peer_cache.write()` for
    // the whole scan and resolved channels one-by-one.
    let mut cache_entries: Vec<(i64, Peer)> = Vec::new();
    // (peer id, title, channel_id, access_hash) for [TD] channels only.
    let mut candidates: Vec<(i64, String, i64, i64)> = Vec::new();
    let mut dialogs = client.iter_dialogs();
    while let Ok(Some(dialog)) = dialogs.next().await {
        if let Peer::Channel(c) = &dialog.peer {
            let id = peer_bare_id(&dialog.peer).unwrap_or(0);
            cache_entries.push((id, dialog.peer.clone()));
            let title = c.title();
            if title.to_lowercase().contains("[td]") {
                candidates.push((id, title.to_string(), c.raw.id, c.raw.access_hash.unwrap_or(0)));
            }
        }
    }
    {
        let mut cache = state.peer_cache.write().await;
        for (id, peer) in cache_entries {
            cache.insert(id, peer);
        }
    }
    let want = want_line.clone();
    let folders: Vec<crate::models::FolderMetadata> =
        futures::future::join_all(candidates.into_iter().map(|(id, title, channel_id, access_hash)| {
            let client = client.clone();
            let want_line = want.clone();
            async move {
                let input_chan = grammers_tl_types::enums::InputChannel::Channel(
                    grammers_tl_types::types::InputChannel {
                        channel_id,
                        access_hash,
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
                belongs.then(|| {
                    let display = title
                        .replace(" [TD]", "")
                        .replace(" [td]", "")
                        .replace("[TD]", "")
                        .replace("[td]", "")
                        .trim()
                        .to_string();
                    // Strip "{org} — " prefix added at creation for display.
                    let display = display.split(" — ").last().unwrap_or(&display).to_string();
                    crate::models::FolderMetadata { id, name: display, parent_id }
                })
            }
        }))
        .await
        .into_iter()
        .flatten()
        .collect();
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
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, body.parent_id, "write").await {
        return e;
    }
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
    payload: Multipart,
) -> impl Responder {
    let org_id = path.into_inner();
    let sess = match require_org_role(&state, &req, &org_id, "editor").await {
        Ok(s) => s,
        Err(e) => return e,
    };
    let (org_main, org_backup) = storage::org_channel_ids(&org_id).await;
    let main_id = match org_main {
        Some(id) => id,
        None => {
            return HttpResponse::BadRequest()
                .body("Organization not provisioned. Create org and Telegram channels first.")
        }
    };

    let max_size = crate::tier::cached_cap(&state).await;
    let up = match crate::upload::read_single_upload(payload, max_size).await {
        Ok(u) => u,
        Err(e) => return e,
    };
    if let Err(e) = crate::auth_org::check_folder_access(&state, &org_id, &sess, up.folder_id, "write").await {
        return e;
    }
    log::info!(
        "Org upload received {} bytes for '{}', uploading to Telegram...",
        up.total_size,
        up.file_name
    );

    let (resp, _msg_id) = deliver_to_telegram(
        state,
        up.tmp_path.clone(),
        up.file_name.clone(),
        up.folder_id,
        up.total_size,
        Some(main_id),
        org_backup,
        None,
    )
    .await;

    let _ = fs::remove_file(&up.tmp_path).await;
    resp
}
