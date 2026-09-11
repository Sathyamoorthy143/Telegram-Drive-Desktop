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

/// How long a cached premium verdict stays valid (10 minutes). `get_me` is
/// one cheap RPC, but downloads/uploads shouldn't pay it on every request.
pub const TIER_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(600);

/// Pure freshness check for the cache (unit-testable).
pub fn cache_fresh(cached_at: Option<std::time::Instant>, now: std::time::Instant) -> bool {
    cached_at.map(|t| now.duration_since(t) < TIER_CACHE_TTL).unwrap_or(false)
}

/// Cached premium verdict: at most one `get_me` RPC per [`TIER_CACHE_TTL`].
/// Unknown/offline defaults to free tier (safe).
pub async fn premium_cached(state: &AppState) -> bool {
    {
        let g = state.premium_cache.lock().await;
        if let (Some(p), Some(at)) = (g.0, g.1) {
            if cache_fresh(Some(at), std::time::Instant::now()) {
                return p;
            }
        }
    }
    let premium = match get_client(state).await {
        Ok(client) => is_premium(&client).await,
        Err(_) => false,
    };
    *state.premium_cache.lock().await = (Some(premium), Some(std::time::Instant::now()));
    premium
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

    #[test]
    fn tier_cache_expires_after_ttl() {
        let now = std::time::Instant::now();
        assert!(cache_fresh(Some(now), now));
        assert!(!cache_fresh(None, now));
        assert!(!cache_fresh(
            Some(now - std::time::Duration::from_secs(601)),
            now
        ));
    }
}
