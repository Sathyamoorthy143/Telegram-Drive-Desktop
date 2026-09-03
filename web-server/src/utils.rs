use grammers_client::Client;
use grammers_client::types::Peer;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub async fn resolve_peer(
    client: &Client,
    folder_id: Option<i64>,
    peer_cache: &Arc<RwLock<HashMap<i64, Peer>>>,
) -> Result<Peer, String> {
    if let Some(fid) = folder_id {
        {
            let cache = peer_cache.read().await;
            if let Some(peer) = cache.get(&fid) {
                return Ok(peer.clone());
            }
        }

        let mut found: Option<Peer> = None;
        let mut dialogs = client.iter_dialogs();
        let mut cache = peer_cache.write().await;
        while let Some(dialog) = dialogs.next().await.map_err(|e| e.to_string())? {
            let id = match &dialog.peer {
                Peer::Channel(c) => Some(c.raw.id),
                Peer::User(u) => Some(u.raw.id()),
                _ => None,
            };
            if let Some(id) = id {
                cache.insert(id, dialog.peer.clone());
                if id == fid {
                    found = Some(dialog.peer.clone());
                }
            }
        }

        found.ok_or_else(|| format!("Folder/Chat {} not found", fid))
    } else {
        match client.get_me().await {
            Ok(me) => Ok(Peer::User(me)),
            Err(e) => Err(e.to_string()),
        }
    }
}

pub fn map_error(e: impl std::fmt::Display) -> String {
    let err_str = e.to_string();
    if err_str.contains("FLOOD_WAIT") {
        if let Some(start) = err_str.find("(value: ") {
             let rest = &err_str[start + 8..];
             if let Some(end) = rest.find(')') {
                 if let Ok(seconds) = rest[..end].parse::<i64>() {
                     return format!("FLOOD_WAIT_{}", seconds);
                 }
             }
        }
        return "FLOOD_WAIT_60".to_string();
    }
    err_str
}
