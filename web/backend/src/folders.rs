use actix_web::{web, HttpResponse, Responder};
use grammers_client::peer::Peer;
use grammers_tl_types as tl;
use crate::auth::get_client;
use crate::models::*;
use crate::utils::{map_error, peer_bare_id, resolve_peer, resolve_peer_ref};
use crate::AppState;

pub async fn scan_folders(state: web::Data<AppState>) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // Walk dialogs sequentially (the iterator requires it), collecting cache
    // entries and [TD] candidates — but hold NO lock and fire NO RPCs here.
    // The old code held `peer_cache.write()` across the whole walk plus one
    // sequential GetFullChannel RPC per channel, serializing every page load
    // behind the scan and every channel behind the previous one.
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
        } else if let Peer::User(_u) = &dialog.peer {
            let id = peer_bare_id(&dialog.peer).unwrap_or(0);
            cache_entries.push((id, dialog.peer.clone()));
        }
    }
    // Bulk cache insert under one short write lock — no awaits inside.
    {
        let mut cache = state.peer_cache.write().await;
        for (id, peer) in cache_entries {
            cache.insert(id, peer);
        }
    }
    // Resolve folder parents concurrently (bounded): N channels cost ~1 slow
    // RPC instead of N sequential ones.
    let folders: Vec<FolderMetadata> =
        futures::future::join_all(candidates.into_iter().map(|(id, title, channel_id, access_hash)| {
            let client = client.clone();
            async move {
                let display = title
                    .replace(" [TD]", "")
                    .replace(" [td]", "")
                    .replace("[TD]", "")
                    .replace("[td]", "")
                    .trim()
                    .to_string();
                let mut parent_id = None;
                let input_chan = tl::enums::InputChannel::Channel(tl::types::InputChannel {
                    channel_id,
                    access_hash,
                });
                if let Ok(tl::enums::messages::ChatFull::Full(full)) = client
                    .invoke(&tl::functions::channels::GetFullChannel {
                        channel: input_chan,
                    })
                    .await
                {
                    if let tl::enums::ChatFull::ChannelFull(cf) = full.full_chat {
                        if cf.about.contains("[telegram-drive-folder]") {
                            parent_id = cf
                                .about
                                .lines()
                                .find(|l| l.starts_with("parent_id:"))
                                .and_then(|l| l.split(':').nth(1))
                                .and_then(|s| s.parse::<i64>().ok());
                        }
                    }
                }
                FolderMetadata {
                    id,
                    name: display,
                    parent_id,
                }
            }
        }))
        .await;
    HttpResponse::Ok().json(folders)
}

pub async fn create_folder(
    state: web::Data<AppState>,
    req: web::Json<CreateFolderRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let about = match req.parent_id {
        Some(pid) => format!("parent_id:{}\n[telegram-drive-folder]", pid),
        None => "Cloudsphere Space Storage Folder\n[telegram-drive-folder]".into(),
    };
    let result = client
        .invoke(&tl::functions::channels::CreateChannel {
            broadcast: true,
            megagroup: false,
            title: format!("{} [TD]", req.name),
            about,
            geo_point: None,
            address: None,
            for_import: false,
            forum: false,
            ttl_period: None,
        })
        .await;
    match result {
        Ok(tl::enums::Updates::Updates(u)) => match u.chats.into_iter().next() {
            Some(tl::enums::Chat::Channel(c)) => {
                let id = c.id;
                HttpResponse::Ok().json(FolderMetadata {
                    id,
                    name: req.name.clone(),
                    parent_id: req.parent_id,
                })
            }
            _ => HttpResponse::InternalServerError().body("Not a channel"),
        },
        Ok(_) => HttpResponse::InternalServerError().body("Unexpected response"),
        Err(e) => HttpResponse::InternalServerError().body(map_error(e)),
    }
}

pub async fn rename_folder(
    state: web::Data<AppState>,
    path: web::Path<i64>,
    req: web::Json<RenameFolderRequest>,
) -> impl Responder {
    let fid = path.into_inner();
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer(&client, Some(fid), &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let input_channel = match peer {
        Peer::Channel(c) => {
            let raw = &c.raw;
            tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: raw.id,
                access_hash: raw.access_hash.unwrap_or(0),
            })
        }
        _ => return HttpResponse::BadRequest().body("Only channels"),
    };
    match client
        .invoke(&tl::functions::channels::EditTitle {
            channel: input_channel,
            title: format!("{} [TD]", req.new_name),
        })
        .await
    {
        Ok(_) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::InternalServerError().body(map_error(e)),
    }
}

pub async fn delete_folder(
    state: web::Data<AppState>,
    req: web::Json<DeleteFolderRequest>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer(&client, Some(req.folder_id), &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let input_channel = match peer {
        Peer::Channel(c) => {
            let raw = &c.raw;
            tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: raw.id,
                access_hash: raw.access_hash.unwrap_or(0),
            })
        }
        _ => return HttpResponse::BadRequest().body("Only channels"),
    };
    match client
        .invoke(&tl::functions::channels::DeleteChannel {
            channel: input_channel,
        })
        .await
    {
        Ok(_) => HttpResponse::Ok().json(true),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

pub async fn get_folder_properties(
    state: web::Data<AppState>,
    path: web::Path<i64>,
) -> impl Responder {
    use grammers_client::media::Media;
    let fid = path.into_inner();
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let peer = match resolve_peer_ref(&client, Some(fid), &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let mut count = 0u64;
    let mut total_size: u64 = 0;
    let mut earliest = None;
    let mut msgs = client.iter_messages(peer);
    while let Ok(Some(msg)) = msgs.next().await {
        count += 1;
        if let Some(doc) = msg.media() {
            total_size += match doc {
                Media::Document(d) => d.size().unwrap_or(0) as u64,
                Media::Photo(_) => 1024 * 1024,
                _ => 0,
            };
        }
        let d = msg.date();
        if earliest.is_none() || d < earliest.unwrap() {
            earliest = Some(d);
        }
    }
    HttpResponse::Ok().json(serde_json::json!({
        "file_count": count,
        "total_size": total_size,
        "created_at": earliest.map(|d| d.to_string()).unwrap_or_else(|| "N/A".into())
    }))
}
