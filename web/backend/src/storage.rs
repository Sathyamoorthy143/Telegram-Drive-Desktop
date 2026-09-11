//! Dedicated MAIN + BACKUP storage channels (Option A).
//!
//! All uploads land in ONE main channel; every new file there is copied to
//! the backup channel in the background. Channels are discovered by a hidden
//! marker in their `about` text (same trick folder channels use) and created
//! on demand by `POST /api/storage/provision`.

use actix_web::{web, HttpResponse, Responder};
use grammers_client::peer::Peer;
use grammers_tl_types as tl;

use crate::auth::get_client;
use crate::settings::save_settings;
use crate::utils::{map_error, peer_bare_id};
use crate::AppState;

/// Hidden marker in the channel `about` text identifying the MAIN channel.
pub const MAIN_MARKER: &str = "[telegram-drive-main]";
/// Hidden marker in the channel `about` text identifying the BACKUP channel.
pub const BACKUP_MARKER: &str = "[telegram-drive-backup]";
pub const MAIN_TITLE: &str = "My Drive Storage [TD]";
pub const BACKUP_TITLE: &str = "My Drive Backup [TD]";

/// Configured MAIN channel id (0/unset means not provisioned yet).
pub fn main_id(state: &AppState) -> Option<i64> {
    state
        .settings
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .channel_id
        .filter(|id| *id != 0)
}

/// Configured BACKUP channel id (0/unset means not provisioned yet).
pub fn backup_id(state: &AppState) -> Option<i64> {
    state
        .settings
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .backup_channel_id
        .filter(|id| *id != 0)
}

/// Scan dialogs for a channel whose `about` carries the marker.
async fn find_marked_channel(
    client: &grammers_client::Client,
    marker: &str,
) -> Option<i64> {
    let mut dialogs = client.iter_dialogs();
    while let Ok(Some(dialog)) = dialogs.next().await {
        if let Peer::Channel(c) = &dialog.peer {
            let raw = &c.raw;
            let input_chan = tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: raw.id,
                access_hash: raw.access_hash.unwrap_or(0),
            });
            if let Ok(tl::enums::messages::ChatFull::Full(full)) = client
                .invoke(&tl::functions::channels::GetFullChannel {
                    channel: input_chan,
                })
                .await
            {
                if let tl::enums::ChatFull::ChannelFull(cf) = full.full_chat {
                    if cf.about.contains(marker) {
                        return peer_bare_id(&dialog.peer);
                    }
                }
            }
        }
    }
    None
}

async fn create_storage_channel(
    client: &grammers_client::Client,
    title: &str,
    about: &str,
) -> Result<i64, String> {
    let result = client
        .invoke(&tl::functions::channels::CreateChannel {
            broadcast: true,
            megagroup: false,
            title: title.to_string(),
            about: about.to_string(),
            geo_point: None,
            address: None,
            for_import: false,
            forum: false,
            ttl_period: None,
        })
        .await
        .map_err(map_error)?;
    match result {
        tl::enums::Updates::Updates(u) => match u.chats.into_iter().next() {
            Some(tl::enums::Chat::Channel(c)) => Ok(c.id),
            _ => Err("Not a channel".into()),
        },
        _ => Err("Unexpected response".into()),
    }
}

/// Find-or-create MAIN + BACKUP channels and persist their ids.
/// Idempotent: existing marked channels are reused, never duplicated.
pub async fn ensure_storage(state: &AppState) -> Result<(i64, i64), String> {
    let client = get_client(state).await?;
    let main = match find_marked_channel(&client, MAIN_MARKER).await {
        Some(id) => id,
        None => {
            create_storage_channel(
                &client,
                MAIN_TITLE,
                &format!("Telegram Drive main storage\n{}", MAIN_MARKER),
            )
            .await?
        }
    };
    let backup = match find_marked_channel(&client, BACKUP_MARKER).await {
        Some(id) => id,
        None => {
            create_storage_channel(
                &client,
                BACKUP_TITLE,
                &format!("Telegram Drive backup mirror\n{}", BACKUP_MARKER),
            )
            .await?
        }
    };
    {
        let mut s = state
            .settings
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        s.channel_id = Some(main);
        s.backup_channel_id = Some(backup);
        save_settings(&s);
    }
    Ok((main, backup))
}

/// `POST /api/storage/provision` — create (or adopt) MAIN + BACKUP channels.
pub async fn provision_storage(state: web::Data<AppState>) -> impl Responder {
    match ensure_storage(&state).await {
        Ok((main, backup)) => HttpResponse::Ok().json(serde_json::json!({
            "main_channel_id": main,
            "backup_channel_id": backup,
        })),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// `GET /api/storage/status` — provisioning state for the UI.
pub async fn storage_status(state: web::Data<AppState>) -> impl Responder {
    let main = main_id(&state);
    let backup = backup_id(&state);
    HttpResponse::Ok().json(serde_json::json!({
        "provisioned": main.is_some() && backup.is_some(),
        "main_channel_id": main,
        "backup_channel_id": backup,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_are_stable_channel_tags() {
        // Guard: changing a marker orphans already-provisioned channels
        // (provisioning would create duplicates instead of adopting them).
        assert_eq!(MAIN_MARKER, "[telegram-drive-main]");
        assert_eq!(BACKUP_MARKER, "[telegram-drive-backup]");
        assert_ne!(MAIN_MARKER, BACKUP_MARKER);
    }

    #[test]
    fn marked_about_text_matches_its_marker() {
        assert!("My Drive Storage\n[telegram-drive-main]".contains(MAIN_MARKER));
        assert!("My Drive Backup\n[telegram-drive-backup]".contains(BACKUP_MARKER));
        assert!(!"Work [TD]\n[telegram-drive-folder]".contains(MAIN_MARKER));
    }
}
