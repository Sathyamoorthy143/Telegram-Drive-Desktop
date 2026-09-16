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

/// Per-org channel markers — unique per org so `ensure_storage` scans never
/// collide across orgs sharing one Telegram account.
pub fn org_main_marker(org_id: &str) -> String {
    format!("[telegram-drive-org-{}-main]", org_id)
}

pub fn org_backup_marker(org_id: &str) -> String {
    format!("[telegram-drive-org-{}-backup]", org_id)
}

/// Per-org folder marker line embedded in folder channel `about` text.
pub fn org_folder_line(org_id: &str) -> String {
    format!("org_id:{}", org_id)
}

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
) -> Option<i64> {    let mut dialogs = client.iter_dialogs();
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

/// Org channel ids from Supabase `org_settings` (None when unprovisioned or
/// Supabase unconfigured).
pub async fn org_channel_ids(org_id: &str) -> (Option<i64>, Option<i64>) {
    match crate::supabase_org::get_org_settings(org_id).await {
        Ok(Some(s)) => (s.channel_id.filter(|id| *id != 0), s.backup_channel_id.filter(|id| *id != 0)),
        _ => (None, None),
    }
}

/// Find-or-create per-org MAIN + BACKUP channels. Idempotent: existing
/// org-marked channels are reused, never duplicated. Does NOT touch the
/// global settings file — ids belong in `org_settings`.
pub async fn ensure_storage_for_org(
    state: &AppState,
    org_id: &str,
    org_name: &str,
) -> Result<(i64, i64), String> {
    let client = get_client(state).await?;
    let main_marker = org_main_marker(org_id);
    let backup_marker = org_backup_marker(org_id);
    let main = match find_marked_channel(&client, &main_marker).await {
        Some(id) => id,
        None => {
            create_storage_channel(
                &client,
                &format!("{} — Drive [TD]", org_name),
                &format!("Telegram Drive org storage ({})\n{}", org_id, main_marker),
            )
            .await?
        }
    };
    let backup = match find_marked_channel(&client, &backup_marker).await {
        Some(id) => id,
        None => {
            create_storage_channel(
                &client,
                &format!("{} — Backup [TD]", org_name),
                &format!("Telegram Drive org backup ({})\n{}", org_id, backup_marker),
            )
            .await?
        }
    };
    Ok((main, backup))
}

/// Ledger tracking one-shot Saved Messages → MAIN migration (reruns skip
/// already-migrated messages instead of duplicating them).
fn backfill_ledger_path() -> std::path::PathBuf {
    std::path::PathBuf::from(
        std::env::var("BACKFILL_LEDGER_PATH").unwrap_or_else(|_| "backfill_ledger.jsonl".into()),
    )
}

#[derive(serde::Deserialize)]
pub struct BackfillQuery {
    pub limit: Option<usize>,
}

/// `POST /api/storage/backfill` — one-shot migration of legacy Saved Messages
/// media into MAIN (server-side forwards, no re-upload). Reruns are safe:
/// migrated messages are recorded in a local ledger and skipped.
pub async fn backfill_saved(
    state: web::Data<AppState>,
    query: web::Query<BackfillQuery>,
) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    let main = match main_id(&state) {
        Some(id) => id,
        None => return HttpResponse::BadRequest().body("provision storage first"),
    };
    let limit = query.limit.unwrap_or(200).clamp(1, 2000);
    let me = match client.get_me().await {
        Ok(u) => u,
        Err(e) => return HttpResponse::Unauthorized().body(e.to_string()),
    };
    let _ = me;
    let src_ref = match crate::utils::resolve_peer_ref(&client, None, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let dst = match crate::utils::resolve_peer_ref(&client, Some(main), &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    let ledger = backfill_ledger_path();
    let mut copied = 0u32;
    let mut skipped = 0u32;
    let mut checked = 0usize;
    let mut iter = client.iter_messages(src_ref);
    while let Ok(Some(msg)) = iter.next().await {
        if checked >= limit {
            break;
        }
        checked += 1;
        if msg.media().is_none() {
            continue;
        }
        let mid = msg.id() as i64;
        if crate::replicate::already_copied_at(&ledger, mid) {
            skipped += 1;
            continue;
        }
        match client
            .forward_messages(dst, &[msg.id()], src_ref)
            .await
        {
            Ok(sent) => {
                let new_id = sent.into_iter().flatten().map(|m| m.id() as i64).max().unwrap_or(0);
                crate::replicate::record_copy_at(&ledger, mid, new_id);
                copied += 1;
            }
            Err(e) => {
                log::warn!("Backfill: forward of {} failed: {}", mid, e);
                break;
            }
        }
    }
    HttpResponse::Ok().json(serde_json::json!({
        "copied": copied,
        "skipped": skipped,
        "checked": checked,
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

    #[test]
    fn org_markers_are_unique_per_org() {
        let a_main = org_main_marker("org-a");
        let b_main = org_main_marker("org-b");
        let a_backup = org_backup_marker("org-a");
        assert_ne!(a_main, b_main);
        assert_ne!(a_main, a_backup);
        assert!(a_main.contains("org-a"));
        assert_eq!(org_folder_line("org-a"), "org_id:org-a");
    }
}
