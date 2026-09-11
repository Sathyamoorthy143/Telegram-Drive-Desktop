//! Voice-to-text for voice/video messages (Telegram Premium feature).
//!
//! Uses Telegram's own server-side transcription (`messages.transcribeAudio`),
//! so there are no new dependencies and no audio leaves Telegram's servers.
//! Requires a Premium account; free accounts get a clear error.

use actix_web::{web, HttpResponse, Responder};
use grammers_client::peer::Peer;
use grammers_tl_types as tl;
use serde::{Deserialize, Serialize};

use crate::auth::get_client;
use crate::AppState;

/// How often to poll while the server is still transcribing.
const POLL_INTERVAL_SECS: u64 = 2;
/// Max polls before giving up (~30s of server-side transcription).
const MAX_POLLS: u32 = 15;

#[derive(Deserialize)]
pub struct TranscribeRequest {
    pub channel_id: Option<i64>,
    pub message_id: i32,
}

#[derive(Serialize)]
pub struct TranscribeResponse {
    pub text: String,
    pub pending: bool,
}

fn input_peer_for(peer: &Peer) -> Result<tl::enums::InputPeer, String> {
    match peer {
        Peer::Channel(c) => Ok(tl::enums::InputPeer::Channel(
            tl::types::InputPeerChannel {
                channel_id: c.raw.id,
                access_hash: c.raw.access_hash.unwrap_or(0),
            },
        )),
        _ => Err("transcription is only supported for channel messages".into()),
    }
}

fn friendly_error(e: String) -> String {
    if e.to_uppercase().contains("PREMIUM") {
        "Voice-to-text needs Telegram Premium on the signed-in account".into()
    } else {
        e
    }
}

/// Invoke server-side transcription and poll until text is ready.
/// Returns the transcript, or an error (including `pending` timeout).
pub async fn transcribe_message(
    client: &grammers_client::Client,
    peer: &Peer,
    message_id: i32,
) -> Result<String, String> {
    let input = input_peer_for(peer)?;
    for _ in 0..MAX_POLLS {
        let res = client
            .invoke(&tl::functions::messages::TranscribeAudio {
                peer: input.clone(),
                msg_id: message_id,
            })
            .await
            .map_err(|e| friendly_error(e.to_string()))?;
        match res {
            tl::enums::messages::TranscribedAudio::Audio(t) => {
                if !t.pending {
                    return Ok(t.text);
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
    }
    Err("transcription still pending, try again shortly".into())
}

/// `POST /api/preview/transcribe` — transcript for a voice/video message.
/// `channel_id` defaults to MAIN; resolves via the peer cache/dialogs.
pub async fn transcribe(
    state: web::Data<AppState>,
    req: web::Json<TranscribeRequest>,
) -> impl Responder {
    let channel = req
        .channel_id
        .or_else(|| crate::storage::main_id(&state));
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    let peer = match crate::utils::resolve_peer(&client, channel, &state.peer_cache).await {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().body(e),
    };
    match transcribe_message(&client, &peer, req.message_id).await {
        Ok(text) => HttpResponse::Ok().json(TranscribeResponse { text, pending: false }),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcribe_response_carries_text() {
        let r = TranscribeResponse {
            text: "hello world".into(),
            pending: false,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["text"], "hello world");
        assert_eq!(v["pending"], false);
    }
}
