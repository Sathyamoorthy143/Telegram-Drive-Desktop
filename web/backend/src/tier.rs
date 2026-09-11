//! Telegram Premium tier detection and tier-aware upload caps.
//!
//! Telegram enforces upload limits server-side per account: 2 GB for free
//! accounts, 4 GB for Premium. The app must never advertise more than the
//! signed-in account is allowed.

/// Max upload size for free Telegram accounts (2 GB, server-enforced).
pub const FREE_MAX_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Max upload size for Telegram Premium accounts (4 GB, server-enforced).
pub const PREMIUM_MAX_UPLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Server-enforced upload cap for the given account tier.
pub fn max_upload_bytes(premium: bool) -> u64 {
    if premium {
        PREMIUM_MAX_UPLOAD_BYTES
    } else {
        FREE_MAX_UPLOAD_BYTES
    }
}

use actix_web::{web, HttpResponse, Responder};
use grammers_client::Client;
use serde::Serialize;

use crate::auth::get_client;
use crate::AppState;

/// Thin adapter over the Telegram API: true iff the signed-in account carries
/// the Premium flag. Any failure (offline, expired session) means false —
/// the caller then enforces the free-tier cap, which is always safe.
pub async fn is_premium(client: &Client) -> bool {
    match client.get_me().await {
        Ok(me) => matches!(
            me.raw,
            grammers_tl_types::enums::User::User(ref u) if u.premium
        ),
        Err(_) => false,
    }
}

/// Live upload cap for the current session. Unknown/offline defaults to the
/// free-tier cap so the app never advertises more than Telegram will accept.
pub async fn current_cap(state: &AppState) -> u64 {
    match get_client(state).await {
        Ok(client) => max_upload_bytes(is_premium(&client).await),
        Err(_) => FREE_MAX_UPLOAD_BYTES,
    }
}

#[derive(Serialize)]
pub struct AccountTier {
    pub premium: bool,
    pub max_upload_bytes: u64,
}

/// `GET /api/account/tier` — account premium status + honest upload cap.
pub async fn account_tier(state: web::Data<AppState>) -> impl Responder {
    let client = match get_client(&state).await {
        Ok(c) => c,
        Err(e) => return HttpResponse::Unauthorized().body(e),
    };
    let premium = is_premium(&client).await;
    HttpResponse::Ok().json(AccountTier {
        premium,
        max_upload_bytes: max_upload_bytes(premium),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_accounts_cap_at_2gb() {
        assert_eq!(max_upload_bytes(false), 2 * 1024 * 1024 * 1024);
    }

    #[test]
    fn premium_accounts_cap_at_4gb() {
        assert_eq!(max_upload_bytes(true), 4 * 1024 * 1024 * 1024);
    }

    #[test]
    fn tier_response_carries_cap() {
        let t = AccountTier {
            premium: true,
            max_upload_bytes: max_upload_bytes(true),
        };
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["premium"], true);
        assert_eq!(v["max_upload_bytes"], PREMIUM_MAX_UPLOAD_BYTES);
    }
}
