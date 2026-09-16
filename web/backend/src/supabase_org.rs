//! Shared Supabase REST helper for org-scoped tables.
//!
//! Deduplicates the identical `supabase_req` (trash.rs) / `sb` (meta.rs)
//! helpers so org queries stay consistent. Uses the service-role key when
//! present (bypasses RLS — the backend is the policy enforcement point via
//! [`crate::auth_org::require_org_role`]); falls back to anon key.

use crate::models::{OrgAuditLog, OrgMember, OrgSettings, Organization};

fn config() -> Result<(String, String), String> {
    let url = std::env::var("SUPABASE_URL").map_err(|_| "SUPABASE_URL not set".to_string())?;
    let key = std::env::var("SUPABASE_SERVICE_KEY")
        .or_else(|_| std::env::var("SUPABASE_SERVICE_ROLE_KEY"))
        .or_else(|_| std::env::var("SUPABASE_ANON_KEY"))
        .map_err(|_| "no Supabase key set".to_string())?;
    if url.trim().is_empty() || key.trim().is_empty() {
        return Err("Supabase not configured".into());
    }
    Ok((url.trim_end_matches('/').to_string(), key))
}

pub fn is_configured() -> bool {
    config().is_ok()
}

/// Generic REST call against `<SUPABASE_URL>/rest/v1/<path>`.
pub async fn sb_req(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<reqwest::Response, String> {
    let (url, key) = config()?;
    let full = format!("{}/rest/v1/{}", url, path.trim_start_matches('/'));
    let client = reqwest::Client::new();
    let mut req = match method {
        "GET" => client.get(&full),
        "POST" => client.post(&full),
        "DELETE" => client.delete(&full),
        "PATCH" => client.patch(&full),
        _ => client.get(&full),
    };
    req = req
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key));
    if method == "POST" || method == "PATCH" {
        req = req
            .header("Prefer", "return=representation")
            .header("Content-Type", "application/json");
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    req.send().await.map_err(|e| e.to_string())
}

pub async fn sb_get_json(path: &str) -> Result<serde_json::Value, String> {
    let resp = sb_req("GET", path, None).await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("Supabase GET {} failed: {}", path, txt));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

// ---- Organizations ----

pub async fn list_organizations() -> Result<Vec<Organization>, String> {
    let v = sb_get_json("organizations?select=*&order=created_at.desc").await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

pub async fn get_org_by_id(org_id: &str) -> Result<Option<Organization>, String> {
    let v =
        sb_get_json(&format!("organizations?id=eq.{}&select=*&limit=1", org_id)).await?;
    let rows: Vec<Organization> = serde_json::from_value(v).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().next())
}

pub async fn get_org_by_subdomain(sub: &str) -> Result<Option<Organization>, String> {
    let v = sb_get_json(&format!(
        "organizations?subdomain=eq.{}&select=*&limit=1",
        urlencoding(sub)
    ))
    .await?;
    let rows: Vec<Organization> = serde_json::from_value(v).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().next())
}

fn urlencoding(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('?', "%3F")
        .replace('#', "%23")
        .replace('+', "%2B")
        .replace('/', "%2F")
}

pub async fn create_organization(name: &str, subdomain: &str) -> Result<Organization, String> {
    let row = serde_json::json!({ "name": name, "subdomain": subdomain.to_lowercase() });
    let resp = sb_req("POST", "organizations", Some(row)).await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("create organization failed: {}", txt));
    }
    let rows: Vec<Organization> = resp.json().await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| "create returned no row".into())
}

// ---- Org settings ----

pub async fn get_org_settings(org_id: &str) -> Result<Option<OrgSettings>, String> {
    let v = sb_get_json(&format!("org_settings?org_id=eq.{}&select=*&limit=1", org_id)).await?;
    let rows: Vec<OrgSettings> = serde_json::from_value(v).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().next())
}

pub async fn upsert_org_settings(org_id: &str, patch: &serde_json::Value) -> Result<OrgSettings, String> {
    let (url, key) = config()?;
    let mut row = patch.clone();
    row["org_id"] = serde_json::Value::String(org_id.to_string());
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/rest/v1/org_settings", url))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {}", key))
        .header("Prefer", "resolution=merge-duplicates,return=representation")
        .header("Content-Type", "application/json")
        .query(&[("on_conflict", "org_id")])
        .json(&row)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("upsert org_settings failed: {}", txt));
    }
    let rows: Vec<OrgSettings> = resp.json().await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| "upsert returned no row".into())
}

// ---- Org members ----

pub async fn list_org_members(org_id: &str) -> Result<Vec<OrgMember>, String> {
    let v = sb_get_json(&format!(
        "org_members?org_id=eq.{}&select=*&order=created_at.asc",
        org_id
    ))
    .await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

pub async fn get_org_member_by_username(
    org_id: &str,
    username: &str,
) -> Result<Option<OrgMember>, String> {
    let v = sb_get_json(&format!(
        "org_members?org_id=eq.{}&username=eq.{}&select=*&limit=1",
        org_id,
        urlencoding(username)
    ))
    .await?;
    let rows: Vec<OrgMember> = serde_json::from_value(v).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().next())
}

pub async fn create_org_member(
    org_id: &str,
    username: &str,
    password_hash: &str,
    role: &str,
    created_by: Option<&str>,
) -> Result<OrgMember, String> {
    let row = serde_json::json!({
        "org_id": org_id,
        "username": username,
        "password_hash": password_hash,
        "role": role,
        "created_by": created_by,
    });
    let resp = sb_req("POST", "org_members", Some(row)).await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("create member failed: {}", txt));
    }
    let rows: Vec<OrgMember> = resp.json().await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| "create returned no row".into())
}

pub async fn delete_org_member(org_id: &str, member_id: &str) -> Result<(), String> {
    let resp = sb_req(
        "DELETE",
        &format!("org_members?id=eq.{}&org_id=eq.{}", member_id, org_id),
        None,
    )
    .await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("delete member failed: {}", txt));
    }
    Ok(())
}

// ---- Org trash ----

pub async fn list_org_trash(org_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let v = sb_get_json(&format!(
        "org_trash?org_id=eq.{}&select=*&order=deleted_at.desc",
        org_id
    ))
    .await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

pub async fn insert_org_trash(row: serde_json::Value) -> Result<(), String> {
    let resp = sb_req("POST", "org_trash", Some(row)).await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("insert org_trash failed: {}", txt));
    }
    Ok(())
}

pub async fn delete_org_trash_item(org_id: &str, message_id: i64, folder_id: Option<i64>) -> Result<(), String> {
    let folder_filter = folder_id
        .map(|v| format!("eq.{}", v))
        .unwrap_or_else(|| "eq.0".into());
    let _ = sb_req(
        "DELETE",
        &format!(
            "org_trash?org_id=eq.{}&message_id=eq.{}&folder_id={}",
            org_id, message_id, folder_filter
        ),
        None,
    )
    .await?;
    Ok(())
}

// ---- Org audit ----

pub async fn insert_org_audit(row: serde_json::Value) -> Result<(), String> {
    let resp = sb_req("POST", "org_audit_logs", Some(row)).await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("insert audit failed: {}", txt));
    }
    Ok(())
}

pub async fn list_org_audit(org_id: &str, limit: u32) -> Result<Vec<OrgAuditLog>, String> {
    let v = sb_get_json(&format!(
        "org_audit_logs?org_id=eq.{}&select=*&order=created_at.desc&limit={}",
        org_id, limit
    ))
    .await?;
    serde_json::from_value(v).map_err(|e| e.to_string())
}

/// Best-effort audit write — never fails the user-facing request.
pub async fn audit_best_effort(
    org_id: &str,
    user_id: Option<String>,
    action: &str,
    target_type: &str,
    target_id: &str,
    details: serde_json::Value,
    ip: Option<String>,
    ua: Option<String>,
) {
    if !is_configured() {
        return;
    }
    let row = serde_json::json!({
        "org_id": org_id,
        "user_id": user_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "details": details,
        "ip_address": ip,
        "user_agent": ua,
    });
    if let Err(e) = insert_org_audit(row).await {
        log::warn!("org audit insert failed: {}", e.chars().take(160).collect::<String>());
    }
}

// ---- Password hashing (SHA-256 + static salt; matches supabase::hash_pin style) ----

pub fn hash_org_password(password: &str, username: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    h.update(b"::telegram-drive-org::");
    h.update(username.to_lowercase().as_bytes());
    format!("{:x}", h.finalize())
}

pub fn verify_org_password(password: &str, username: &str, hash: &str) -> bool {
    hash_org_password(password, username) == hash
}

/// Role hierarchy: viewer < editor < admin < owner. Master admin bypasses.
pub fn role_rank(role: &str) -> u8 {
    match role {
        "viewer" => 1,
        "editor" => 2,
        "admin" => 3,
        "owner" => 4,
        _ => 0,
    }
}

pub fn role_satisfies(have: &str, need: &str) -> bool {
    role_rank(have) >= role_rank(need)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_is_stable_and_user_scoped() {
        let a = hash_org_password("secret", "alice");
        assert_eq!(a, hash_org_password("secret", "alice"));
        assert_ne!(a, hash_org_password("secret", "bob"));
        assert!(verify_org_password("secret", "alice", &a));
        assert!(!verify_org_password("wrong", "alice", &a));
    }

    #[test]
    fn role_hierarchy_orders_correctly() {
        assert!(role_satisfies("editor", "viewer"));
        assert!(role_satisfies("admin", "editor"));
        assert!(role_satisfies("owner", "admin"));
        assert!(!role_satisfies("viewer", "editor"));
        assert!(!role_satisfies("editor", "admin"));
    }
}
