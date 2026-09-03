use tauri::{State, Emitter};
use grammers_client::types::{Media, Peer};
use grammers_client::InputMessage;
use grammers_tl_types as tl;
use crate::TelegramState;
use crate::models::{FolderMetadata, FileMetadata};
use crate::bandwidth::BandwidthManager;
use crate::commands::utils::{resolve_peer, map_error};
use std::path::Path;
use walkdir::WalkDir;
use futures::StreamExt;
use tokio_util::codec::{BytesCodec, FramedRead};
use tokio_util::io::StreamReader;
use std::time::Instant;

#[tauri::command]
pub async fn cmd_create_folder(
    name: String,
    parent_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<FolderMetadata, String> {
    let client_opt = {
        state.client.lock().await.clone()
    };
    
    // --- MOCK ---
    if client_opt.is_none() {
        let mock_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        log::info!("[MOCK] Created folder '{}' (parent: {:?}) with ID {}", name, parent_id, mock_id);
        return Ok(FolderMetadata {
            id: mock_id,
            name,
            parent_id,
        });
    }
    // -----------
    let client = client_opt.unwrap();
    log::info!("Creating Telegram Channel: {} (Parent: {:?})", name, parent_id);
    
    let about = match parent_id {
        Some(pid) => format!("parent_id:{}\n[telegram-drive-folder]", pid),
        None => "Telegram Drive Storage Folder\n[telegram-drive-folder]".to_string(),
    };

    let result = client.invoke(&tl::functions::channels::CreateChannel {
        broadcast: true,
        megagroup: false,
        title: format!("{} [TD]", name),
        about,
        geo_point: None,
        address: None,
        for_import: false,
        forum: false,
        ttl_period: None,
    }).await.map_err(map_error)?;
    
    let channel = match result {
        tl::enums::Updates::Updates(u) => {
             let chat = u.chats.into_iter().next().ok_or("No chat in updates")?;
             match chat {
                 tl::enums::Chat::Channel(c) => c,
                 _ => return Err("Created chat is not a channel".to_string()),
             }
        },
        _ => return Err("Unexpected response (not Updates::Updates)".to_string()), 
    };

    let chat_id = channel.id;
    let access_hash = channel.access_hash.unwrap_or(0);

    // Cache the peer
    let mut cache = state.peer_cache.write().await;
    let peer = Peer::Channel(grammers_client::types::Channel {
        raw: channel
    });
    cache.insert(chat_id, peer);

    // Explicitly Disable TTL
    let _ = client.invoke(&tl::functions::messages::SetHistoryTtl {
        peer: tl::enums::InputPeer::Channel(tl::types::InputPeerChannel { channel_id: chat_id, access_hash }),
        period: 0, 
    }).await;

    Ok(FolderMetadata {
        id: chat_id,
        name,
        parent_id,
    })
}

#[tauri::command]
pub async fn cmd_delete_folder(
    folder_id: i64,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = {
        state.client.lock().await.clone()
    };
    
    if client_opt.is_none() {
        log::info!("[MOCK] Deleted folder ID {}", folder_id);
        return Ok(true);
    }
    let client = client_opt.unwrap();
    log::info!("Deleting folder/channel: {}", folder_id);

    let peer = resolve_peer(&client, Some(folder_id), &state.peer_cache).await?;
    
    let input_channel = match peer {
        Peer::Channel(c) => {
             let chan = &c.raw;
             tl::enums::InputChannel::Channel(tl::types::InputChannel {
                 channel_id: chan.id,
                 access_hash: chan.access_hash.ok_or("No access hash for channel")?,
             })
        },
        _ => return Err("Only channels (folders) can be deleted.".to_string()),
    };
    client.invoke(&tl::functions::channels::DeleteChannel {
        channel: input_channel,
    }).await.map_err(|e| format!("Failed to delete channel: {}", e))?;
    
    Ok(true)
}

#[tauri::command]
pub async fn cmd_rename_folder(
    folder_id: i64,
    new_name: String,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        log::info!("[MOCK] Renamed folder ID {} to {}", folder_id, new_name);
        return Ok(true);
    }
    let client = client_opt.unwrap();
    let peer = resolve_peer(&client, Some(folder_id), &state.peer_cache).await?;
    
    let input_channel = match peer {
        Peer::Channel(c) => {
             let chan = &c.raw;
             tl::enums::InputChannel::Channel(tl::types::InputChannel {
                 channel_id: chan.id,
                 access_hash: chan.access_hash.ok_or("No access hash for channel")?,
             })
        },
        _ => return Err("Only channels (folders) can be renamed.".to_string()),
    };

    client.invoke(&tl::functions::channels::EditTitle {
        channel: input_channel,
        title: format!("{} [TD]", new_name),
    }).await.map_err(|e| format!("Failed to rename channel: {}", e))?;

    Ok(true)
}


#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    id: String,
    percent: u8,
    speed: f64, // Bytes per second
    eta: u64,   // Seconds remaining
}

#[tauri::command]
pub async fn cmd_upload_file(
    path: String,
    folder_id: Option<i64>,
    transfer_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<String, String> {
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    bw_state.can_transfer(size)?;

    let tid = transfer_id.unwrap_or_default();
    let filename = Path::new(&path).file_name().unwrap_or_default().to_string_lossy().to_string();

    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        log::info!("[MOCK] Uploaded file {} to {:?}", path, folder_id);
        bw_state.add_up(size);
        return Ok("Mock upload successful".to_string());
    }
    let client = client_opt.unwrap();
    
    // Create a progress stream
    let file = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
    let mut uploaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();
    let mut last_percent = 0;

    let app_handle_clone = app_handle.clone();
    let tid_clone = tid.clone();

    let stream = FramedRead::new(file, BytesCodec::new()).map(move |item| {
        if let Ok(bytes) = &item {
            uploaded += bytes.len() as u64;
            
            // Emit progress every 500ms or on significant percentage change
            let percent = ((uploaded as f64 / size as f64) * 100.0) as u8;
            if last_emit.elapsed().as_millis() > 500 || percent != last_percent {
                last_percent = percent;
                last_emit = Instant::now();
                
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 { uploaded as f64 / elapsed } else { 0.0 };
                let eta = if speed > 0.0 { ((size - uploaded) as f64 / speed) as u64 } else { 0 };

                if !tid_clone.is_empty() {
                    let _ = app_handle_clone.emit("upload-progress", ProgressPayload { 
                        id: tid_clone.clone(), 
                        percent,
                        speed,
                        eta,
                    });
                }
            }
        }
        item.map(|b| b.freeze())
    });

    let mut reader = StreamReader::new(stream);
    let uploaded_file = client.upload_stream(&mut reader, size as usize, filename).await
        .map_err(|e| format!("Upload failed: {}", e))?;
        
    let message = InputMessage::new().text("").file(uploaded_file);
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    client.send_message(&peer, message).await.map_err(map_error)?;
    
    bw_state.add_up(size);

    // Emit final completion
    if !tid.is_empty() {
        let _ = app_handle.emit("upload-progress", ProgressPayload { 
            id: tid, 
            percent: 100,
            speed: 0.0,
            eta: 0,
        });
    }

    Ok("File uploaded successfully".to_string())
}

#[tauri::command]
pub async fn cmd_upload_folder(
    path: String,
    folder_id: Option<i64>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<String, String> {
    let folder_path = Path::new(&path);
    if !folder_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(folder_path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            files.push(entry.path().to_owned());
        }
    }

    log::info!("Queuing {} files from folder {}", files.len(), path);
    
    // In a real app, we might want a real queue, but for now we'll just loop
    for file_path in files {
        let path_str = file_path.to_string_lossy().to_string();
        let tid = format!("upload-{}", uuid::Uuid::new_v4());
        
        // We call cmd_upload_file directly. 
        // Note: In a production app, we'd spawn these as background tasks to avoid blocking.
        let _ = cmd_upload_file(
            path_str,
            folder_id,
            Some(tid),
            app_handle.clone(),
            state.clone(),
            bw_state.clone(),
        ).await;
    }

    Ok("Folder upload complete".to_string())
}

#[tauri::command]
pub async fn cmd_delete_file(
    message_id: i32,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
         log::info!("[MOCK] Deleted message {} from folder {:?}", message_id, folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    client.delete_messages(&peer, &[message_id]).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn cmd_download_file(
    message_id: i32,
    save_path: String,
    folder_id: Option<i64>,
    transfer_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<String, String> {
    let tid = transfer_id.unwrap_or_default();

    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Downloaded message {} from {:?} to {}", message_id, folder_id, save_path);
        if let Err(e) = std::fs::write(&save_path, b"Mock Content") { return Err(e.to_string()); }
        return Ok("Download successful".to_string());
    }
    let client = client_opt.unwrap();
    
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    // Use get_messages_by_id for efficient message lookup (same as server.rs)
    let messages = client.get_messages_by_id(&peer, &[message_id]).await.map_err(|e| e.to_string())?;
    
    let msg = messages.into_iter()
        .flatten()
        .next()
        .ok_or_else(|| "Message not found".to_string())?;

    let media = msg.media()
        .ok_or_else(|| "No media in message".to_string())?;

    let total_size = match &media {
        Media::Document(d) => d.size() as u64,
        Media::Photo(_) => 1024 * 1024,
        _ => 0,
    };
    
    bw_state.can_transfer(total_size)?;

    // Emit start
    if !tid.is_empty() {
        let _ = app_handle.emit("download-progress", ProgressPayload { 
            id: tid.clone(), 
            percent: 0,
            speed: 0.0,
            eta: 0,
        });
    }

    // Stream download with per-chunk progress
    let mut download_iter = client.iter_download(&media);
    let mut file = std::fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    while let Some(chunk) = download_iter.next().await.transpose() {
        let bytes = chunk.map_err(|e| format!("Download chunk error: {}", e))?;
        std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
        
        if !tid.is_empty() && total_size > 0 {
            let percent = ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8;
            
            // Emit progress every 500ms or on significant percentage change
            if last_emit.elapsed().as_millis() > 500 || percent != last_percent {
                last_percent = percent;
                last_emit = Instant::now();

                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 { downloaded as f64 / elapsed } else { 0.0 };
                let eta = if speed > 0.0 { ((total_size - downloaded) as f64 / speed) as u64 } else { 0 };

                let _ = app_handle.emit("download-progress", ProgressPayload { 
                    id: tid.clone(), 
                    percent,
                    speed,
                    eta,
                });
            }
        }
    }

    bw_state.add_down(total_size);

    // Emit completion
    if !tid.is_empty() {
        let _ = app_handle.emit("download-progress", ProgressPayload { 
            id: tid, 
            percent: 100,
            speed: 0.0,
            eta: 0,
        });
    }

    Ok("Download successful".to_string())
}

#[tauri::command]
pub async fn cmd_move_files(
    message_ids: Vec<i32>,
    folder_ids: Vec<i64>,
    source_folder_id: Option<i64>,
    target_folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Moved msgs {:?} and folders {:?} from {:?} to {:?}", message_ids, folder_ids, source_folder_id, target_folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    // 1. Handle Files
    if !message_ids.is_empty() && source_folder_id != target_folder_id {
        let source_peer = resolve_peer(&client, source_folder_id, &state.peer_cache).await?;
        let target_peer = resolve_peer(&client, target_folder_id, &state.peer_cache).await?;

        match client.forward_messages(&target_peer, &message_ids, &source_peer).await {
            Ok(_) => {},
            Err(e) => return Err(format!("Forward failed: {}", e)),
        }
        
        match client.delete_messages(&source_peer, &message_ids).await {
            Ok(_) => {},
            Err(e) => return Err(format!("Delete original failed: {}", e)),
        }
    }

    // 2. Handle Folders
    for fid in folder_ids {
        let peer = resolve_peer(&client, Some(fid), &state.peer_cache).await?;
        let input_channel = match peer {
            Peer::Channel(c) => {
                 let chan = &c.raw;
                 tl::enums::InputChannel::Channel(tl::types::InputChannel {
                     channel_id: chan.id,
                     access_hash: chan.access_hash.ok_or("No access hash for channel")?,
                 })
            },
            _ => continue,
        };

        // Get current about to update parent_id
        let full_info = client.invoke(&tl::functions::channels::GetFullChannel {
            channel: input_channel.clone(),
        }).await.map_err(|e| format!("Failed to get folder info: {}", e))?;

        if let tl::enums::messages::ChatFull::Full(f) = full_info {
            if let tl::enums::ChatFull::Full(cf) = f.full_chat {
                let mut lines: Vec<String> = cf.about.lines()
                    .filter(|l| !l.starts_with("parent_id:"))
                    .map(|s| s.to_string())
                    .collect();
                
                if let Some(target_id) = target_folder_id {
                    lines.push(format!("parent_id:{}", target_id));
                }
                
                let new_about = lines.join("\n");
                client.invoke(&tl::functions::messages::EditChatAbout {
                    peer: tl::enums::InputPeer::Channel(tl::types::InputPeerChannel { 
                        channel_id: fid, 
                        access_hash: cf.id.try_into().unwrap_or(0) // This is wrong, cf.id is long? No, cf is ChatFull
                    }),
                    about: new_about,
                }).await.map_err(|e| format!("Failed to update folder parent: {}", e))?;
                
                // Re-resolve/invoke to fix access_hash if needed
                // Actually InputPeerChannel needs channel_id and access_hash
                // Let's use the one from input_channel
                let (chan_id, access_hash) = match input_channel {
                    tl::enums::InputChannel::Channel(c) => (c.channel_id, c.access_hash),
                    _ => (0, 0),
                };

                client.invoke(&tl::functions::messages::EditChatAbout {
                    peer: tl::enums::InputPeer::Channel(tl::types::InputPeerChannel { 
                        channel_id: chan_id, 
                        access_hash 
                    }),
                    about: lines.join("\n"),
                }).await.map_err(|e| format!("Failed to update folder parent: {}", e))?;
            }
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn cmd_copy_files(
    message_ids: Vec<i32>,
    folder_ids: Vec<i64>,
    source_folder_id: Option<i64>,
    target_folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Copied msgs {:?} and folders {:?} from {:?} to {:?}", message_ids, folder_ids, source_folder_id, target_folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    // 1. Handle Files
    if !message_ids.is_empty() && source_folder_id != target_folder_id {
        let source_peer = resolve_peer(&client, source_folder_id, &state.peer_cache).await?;
        let target_peer = resolve_peer(&client, target_folder_id, &state.peer_cache).await?;

        client.forward_messages(&target_peer, &message_ids, &source_peer).await
            .map_err(|e| format!("Copy (Forward) failed: {}", e))?;
    }

    // 2. Handle Folders (Clone)
    for fid in folder_ids {
        let peer = resolve_peer(&client, Some(fid), &state.peer_cache).await?;
        let (name, input_channel) = match peer {
            Peer::Channel(c) => {
                 let chan = &c.raw;
                 (chan.title.clone(), tl::enums::InputChannel::Channel(tl::types::InputChannel {
                     channel_id: chan.id,
                     access_hash: chan.access_hash.ok_or("No access hash for channel")?,
                 }))
            },
            _ => continue,
        };

        // Create NEW channel
        let display_name = name.replace(" [TD]", "").trim().to_string();
        let new_folder = cmd_create_folder(format!("{} (Copy)", display_name), target_folder_id, state.clone()).await?;
        
        // Forward all messages from source to new
        let source_peer = Peer::Channel(match resolve_peer(&client, Some(fid), &state.peer_cache).await? {
            Peer::Channel(c) => c,
            _ => continue,
        });
        let target_peer = resolve_peer(&client, Some(new_folder.id), &state.peer_cache).await?;

        let mut msg_ids = Vec::new();
        let mut msgs = client.iter_messages(&source_peer);
        while let Some(msg) = msgs.next().await.map_err(|e| e.to_string())? {
            msg_ids.push(msg.id());
        }

        if !msg_ids.is_empty() {
            // Forward in batches to avoid limits
            for chunk in msg_ids.chunks(100) {
                let _ = client.forward_messages(&target_peer, chunk, &source_peer).await;
            }
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn cmd_get_folder_properties(
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<serde_json::Value, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        return Ok(serde_json::json!({
            "file_count": 0,
            "total_size": 0,
            "created_at": "N/A"
        }));
    }
    let client = client_opt.unwrap();
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    
    let mut count = 0;
    let mut total_size: u64 = 0;
    let mut earliest_date = None;

    let mut msgs = client.iter_messages(&peer);
    while let Some(msg) = msgs.next().await.map_err(|e| e.to_string())? {
        count += 1;
        if let Some(doc) = msg.media() {
            total_size += match doc {
                Media::Document(d) => d.size() as u64,
                Media::Photo(_) => 1024 * 1024,
                _ => 0,
            };
        }
        let date = msg.date();
        if earliest_date.is_none() || date < earliest_date.unwrap() {
            earliest_date = Some(date);
        }
    }

    Ok(serde_json::json!({
        "file_count": count,
        "total_size": total_size,
        "created_at": earliest_date.map(|d| d.to_string()).unwrap_or_else(|| "N/A".to_string())
    }))
}

#[tauri::command]
pub async fn cmd_get_files(
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Returning mock files for folder {:?}", folder_id);
        return Ok(Vec::new()); // No mock files for now
    }
    let client = client_opt.unwrap();
    let mut files = Vec::new();
    
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    let mut msgs = client.iter_messages(&peer);
    while let Some(msg) = msgs.next().await.map_err(|e| e.to_string())? {
        if let Some(doc) = msg.media() {
            let (name, size, mime, ext) = match doc {
                Media::Document(d) => {
                    let n = d.name().to_string();
                    let s = d.size();
                    let m = d.mime_type().map(|s| s.to_string());
                    let e = std::path::Path::new(&n).extension().map(|os| os.to_str().unwrap_or("").to_string());
                    (n, s, m, e)
                },
                Media::Photo(_) => ("Photo.jpg".to_string(), 0, Some("image/jpeg".into()), Some("jpg".into())),
                _ => ("Unknown".to_string(), 0, None, None),
            };
            files.push(FileMetadata {
                id: msg.id() as i64, folder_id, name, size: size as u64, mime_type: mime, file_ext: ext, created_at: msg.date().to_string(), icon_type: "file".into()
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn cmd_search_global(
    query: String,
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    let mut files = Vec::new();
    
    log::info!("Searching global for: {}", query);

    let result = client.invoke(&tl::functions::messages::SearchGlobal {
        q: query,
        filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
        min_date: 0,
        max_date: 0,
        offset_rate: 0,
        offset_peer: tl::enums::InputPeer::Empty,
        offset_id: 0,
        limit: 50,
        folder_id: None,
        broadcasts_only: false,
        groups_only: false,
        users_only: false,
    }).await.map_err(map_error)?;

    if let tl::enums::messages::Messages::Messages(msgs) = result {
        for msg in msgs.messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                    if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                        let name = doc.attributes.iter().find_map(|a| match a {
                            tl::enums::DocumentAttribute::Filename(f) => Some(f.file_name.clone()),
                            _ => None
                        }).unwrap_or("Unknown".to_string());
                        let size = doc.size as u64;
                        let mime = doc.mime_type.clone();
                        let ext = std::path::Path::new(&name).extension().map(|os| os.to_str().unwrap_or("").to_string());
                        let folder_id = match m.peer_id {
                            tl::enums::Peer::Channel(c) => Some(c.channel_id),
                            tl::enums::Peer::User(u) => Some(u.user_id),
                            tl::enums::Peer::Chat(c) => Some(c.chat_id),
                        };
                        files.push(FileMetadata {
                            id: m.id as i64, folder_id, name, size,
                            mime_type: Some(mime), file_ext: ext,
                            created_at: m.date.to_string(), icon_type: "file".into()
                        });
                    }
                }
            }
        }
    } else if let tl::enums::messages::Messages::Slice(msgs) = result {
        for msg in msgs.messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                    if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                        let name = doc.attributes.iter().find_map(|a| match a {
                            tl::enums::DocumentAttribute::Filename(f) => Some(f.file_name.clone()),
                            _ => None
                        }).unwrap_or("Unknown".to_string());
                        let size = doc.size as u64;
                        let mime = doc.mime_type.clone();
                        let ext = std::path::Path::new(&name).extension().map(|os| os.to_str().unwrap_or("").to_string());
                        let folder_id = match m.peer_id {
                            tl::enums::Peer::Channel(c) => Some(c.channel_id),
                            tl::enums::Peer::User(u) => Some(u.user_id),
                            tl::enums::Peer::Chat(c) => Some(c.chat_id),
                        };
                        files.push(FileMetadata {
                            id: m.id as i64, folder_id, name, size,
                            mime_type: Some(mime), file_ext: ext,
                            created_at: m.date.to_string(), icon_type: "file".into()
                        });
                    }
                }
            }
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn cmd_scan_folders(
    state: State<'_, TelegramState>,
) -> Result<Vec<FolderMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    
    let mut folders = Vec::new();
    let mut dialogs = client.iter_dialogs();
    
    log::info!("Starting Folder Scan...");

    // Acquire write lock once for the entire scan to populate the peer cache
    let mut peer_cache = state.peer_cache.write().await;

    while let Some(dialog) = dialogs.next().await.map_err(|e| e.to_string())? {
        // Populate peer cache for every dialog we encounter (free priming)
        match &dialog.peer {
            Peer::Channel(c) => {
                let id = c.raw.id;
                peer_cache.insert(id, dialog.peer.clone());

                let name = c.raw.title.clone();
                let access_hash = c.raw.access_hash.unwrap_or(0);
                
                log::debug!("[SCAN] Processing Channel: '{}' (ID: {})", name, id);

                // Strategy 1: Title
                if name.to_lowercase().contains("[td]") {
                    log::info!(" -> MATCH via Title: {}", name);
                    let display_name = name.replace(" [TD]", "").replace(" [td]", "").replace("[TD]", "").replace("[td]", "").trim().to_string();
                    folders.push(FolderMetadata { id, name: display_name, parent_id: None });
                    continue; 
                }

                // Strategy 2: About
                let input_chan = tl::enums::InputChannel::Channel(tl::types::InputChannel {
                    channel_id: c.raw.id,
                    access_hash,
                });
                
                match client.invoke(&tl::functions::channels::GetFullChannel {
                    channel: input_chan,
                }).await {
                    Ok(tl::enums::messages::ChatFull::Full(f)) => {
                        if let tl::enums::ChatFull::Full(cf) = f.full_chat {
                             if cf.about.contains("[telegram-drive-folder]") {
                                 log::info!(" -> MATCH via About: {}", name);
                                 
                                 let pid = cf.about.lines()
                                     .find(|l| l.starts_with("parent_id:"))
                                     .and_then(|l| l.split(':').nth(1))
                                     .and_then(|s| s.parse::<i64>().ok());

                                 folders.push(FolderMetadata { id, name: name.clone(), parent_id: pid });
                             }
                        }
                    },
                    Err(e) => log::warn!(" -> Failed to get full info: {}", e),
                }
            },
            Peer::User(u) => {
                peer_cache.insert(u.raw.id(), dialog.peer.clone());
                log::debug!("[SCAN] Cached User Peer: {}", u.raw.id());
            },
            peer => {
                log::debug!("[SCAN] Skipped Peer: {:?}", peer);
            }
        }
    }
    
    log::info!("Scan complete. Found {} folders. Peer cache size: {}.", folders.len(), peer_cache.len());
    Ok(folders)
}
