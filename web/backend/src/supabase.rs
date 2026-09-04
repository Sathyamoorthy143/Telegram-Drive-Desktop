use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionRow {
    pub user_id: i64,
    pub session_blob: String,
    pub api_id: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SettingsRow {
    pub user_id: i64,
    pub lock_pin_hash: Option<String>,
    pub lock_interval_ms: Option<i64>,
    pub notification_mode: Option<String>,
}

fn supabase_config() -> Option<(String, String)> {
    let url = std::env::var("SUPABASE_URL").ok()?;
    let key = std::env::var("SUPABASE_SERVICE_KEY")
        .or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY"))
        .or_else(|_| std::env::var("SUPABASE_ANON_KEY"))
        .ok()?;
    if url.trim().is_empty() || key.trim().is_empty() {
        return None;
    }
    Some((url.trim_end_matches('/').to_string(), key))
}

fn is_supabase_enabled() -> bool {
    supabase_config().is_some()
}

pub async fn upsert_session(user_id: i64, api_id: Option<i32>) -> Result<(), String> {
    let (url, key) = match supabase_config() {
        Some(c) => c,
        None => return Ok(()), // no-op if not configured
    };

    let session_path = std::env::var("SESSION_PATH").unwrap_or_else(|_| "telegram.session".into());
    let data = match tokio::fs::read(&session_path).await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("supabase upsert_session: cannot read {}: {}", session_path, e);
            return Ok(());
        }
    };
    let blob = BASE64.encode(&data);

    let row = serde_json::json!({
        "user_id": user_id,
        "session_blob": blob,
        "api_id": api_id
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/rest/v1/telegram_sessions", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .query(&[("on_conflict", "user_id")])
        .json(&row)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        log::warn!("supabase upsert_session failed: {}", txt);
        return Err(format!("Supabase upsert failed: {}", txt));
    }
    log::info!("Supabase session upserted for user {}", user_id);
    Ok(())
}

pub async fn get_session(user_id: i64) -> Option<Vec<u8>> {
    let (url, key) = supabase_config()?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/rest/v1/telegram_sessions", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .query(&[
            ("user_id", format!("eq.{}", user_id)),
            ("select", "session_blob".into()),
            ("limit", "1".into()),
        ])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }
    let rows: Vec<serde_json::Value> = resp.json().await.ok()?;
    let blob = rows.get(0)?.get("session_blob")?.as_str()?;
    BASE64.decode(blob).ok()
}

pub async fn restore_session_if_needed(user_id: Option<i64>) -> bool {
    // if file exists and non-empty, no need
    let path = std::env::var("SESSION_PATH").unwrap_or_else(|_| "telegram.session".into());
    if let Some(p) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if let Ok(meta) = tokio::fs::metadata(&path).await {
        if meta.len() > 100 {
            return false;
        }
    }
    // need user_id to fetch; if not provided, try to list most recent?
    let uid = match user_id {
        Some(id) => id,
        None => {
            // try to fetch any session (for single-user Free tier, take first)
            let (url, key) = match supabase_config() {
                Some(c) => c,
                None => return false,
            };
            let client = reqwest::Client::new();
            let resp = match client
                .get(format!("{}/rest/v1/telegram_sessions", url))
                .header("apikey", &key)
                .header("Authorization", format!("Bearer {}", key))
                .query(&[("select", "user_id,session_blob"), ("limit", "1"), ("order", "updated_at.desc")])
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return false,
            };
            if !resp.status().is_success() {
                return false;
            }
            let rows: Vec<serde_json::Value> = match resp.json().await {
                Ok(v) => v,
                Err(_) => return false,
            };
            let first = match rows.get(0) {
                Some(v) => v,
                None => return false,
            };
            let blob = match first.get("session_blob").and_then(|v| v.as_str()) {
                Some(b) => b,
                None => return false,
            };
            let data = match BASE64.decode(blob) {
                Ok(d) => d,
                Err(_) => return false,
            };
            if let Err(e) = tokio::fs::write(&path, &data).await {
                log::warn!("restore_session write failed: {}", e);
                return false;
            }
            let _ = tokio::fs::write(format!("{}-shm", path), b"").await;
            let _ = tokio::fs::write(format!("{}-wal", path), b"").await;
            log::info!("Restored session from Supabase (any user) to {}", path);
            return true;
        }
    };
    if let Some(data) = get_session(uid).await {
        if let Err(e) = tokio::fs::write(&path, &data).await {
            log::warn!("restore_session write failed: {}", e);
            return false;
        }
        log::info!("Restored session for user {} to {}", uid, path);
        return true;
    }
    false
}

pub async fn upsert_user_settings(
    user_id: i64,
    pin_hash: Option<String>,
    lock_interval_ms: Option<i64>,
    notification_mode: Option<String>,
) -> Result<(), String> {
    let (url, key) = match supabase_config() {
        Some(c) => c,
        None => return Ok(()),
    };
    let mut row = serde_json::json!({ "user_id": user_id });
    if let Some(h) = pin_hash {
        row["lock_pin_hash"] = serde_json::Value::String(h);
    }
    if let Some(ms) = lock_interval_ms {
        row["lock_interval_ms"] = serde_json::Value::Number(serde_json::Number::from(ms));
    }
    if let Some(m) = notification_mode {
        row["notification_mode"] = serde_json::Value::String(m);
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/rest/v1/user_settings", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .query(&[("on_conflict", "user_id")])
        .json(&row)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        log::warn!("upsert_user_settings failed: {}", txt);
        return Err(txt);
    }
    Ok(())
}

pub async fn get_user_settings(user_id: i64) -> Option<SettingsRow> {
    let (url, key) = supabase_config()?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/rest/v1/user_settings", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .query(&[
            ("user_id", format!("eq.{}", user_id)),
            ("select", "*".into()),
            ("limit", "1".into()),
        ])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let rows: Vec<SettingsRow> = resp.json().await.ok()?;
    rows.into_iter().next()
}

pub fn hash_pin(pin: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    hasher.update(b"telegram-drive-salt");
    format!("{:x}", hasher.finalize())
}
