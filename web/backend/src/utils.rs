use grammers_client::peer::Peer;
use grammers_session::types::PeerRef;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub fn map_error<E: std::fmt::Display>(e: E) -> String {
    format!("Telegram Error: {}", e)
}

/// Get the bare i64 ID from a Peer
pub fn peer_bare_id(peer: &Peer) -> Option<i64> {
    peer.id().bare_id()
}

/// Resolve a folder_id to a Peer
pub async fn resolve_peer(
    client: &grammers_client::Client,
    folder_id: Option<i64>,
    cache: &Arc<RwLock<HashMap<i64, Peer>>>,
) -> Result<Peer, String> {
    if let Some(id) = folder_id {
        // Check cache first
        {
            let g = cache.read().await;
            if let Some(p) = g.get(&id) {
                return Ok(p.clone());
            }
        }
        // Scan dialogs to find the peer
        let mut dialogs = client.iter_dialogs();
        while let Ok(Some(dialog)) = dialogs.next().await {
            let pid = peer_bare_id(&dialog.peer);
            if pid == Some(id) {
                let mut g = cache.write().await;
                g.insert(id, dialog.peer.clone());
                return Ok(dialog.peer);
            }
        }
        Err(format!("Could not resolve peer for ID: {}", id))
    } else {
        // No folder = "Saved Messages" = self user
        let me = client.get_me().await.map_err(|e| e.to_string())?;
        Ok(Peer::User(me))
    }
}

/// Resolve a folder_id to a PeerRef, suitable for use with client methods
pub async fn resolve_peer_ref(
    client: &grammers_client::Client,
    folder_id: Option<i64>,
    cache: &Arc<RwLock<HashMap<i64, Peer>>>,
) -> Result<PeerRef, String> {
    let peer = resolve_peer(client, folder_id, cache).await?;
    peer.to_ref()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Could not convert peer to reference for folder_id: {:?}", folder_id))
}

pub async fn clear_peer_cache(cache: &Arc<RwLock<HashMap<i64, Peer>>>) {
    cache.write().await.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_error_wraps_display_type() {
        let err = map_error("boom");
        assert_eq!(err, "Telegram Error: boom");
    }

    #[test]
    fn map_error_with_io_error() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "nope");
        let msg = map_error(err);
        assert!(msg.starts_with("Telegram Error:"));
        assert!(msg.contains("nope"));
    }
}
