//! Schema self-check: verifies that required Supabase tables exist.
//!
//! Tier 3 #16 — Schema self-check endpoint + dashboard banner.
//!
//! The backend relies on Supabase tables (`telegram_sessions`,
//! `user_settings`, `trash_items`, `file_favorites`, etc.) for session
//! persistence, lockscreen settings, and metadata. If the schema is missing
//! or partially migrated, the app degrades subtly (e.g. refresh loops asking
//! for OTP even after login). This endpoint lets the frontend detect the
//! problem and show an actionable banner.
//!
//! It hits `POST /rest/v1/rpc/exec` (Supabase SQL RPC) — but since free-tier
//! Supabase may not expose an `exec` RPC, we use a lightweight approach:
//! `GET /rest/v1/<table>?select=1&limit=0` probes each table headlessly.
//! A 200 means the table exists; a 404/405/5xx means it is missing.

use actix_web::{web, HttpResponse, Responder};
use serde::Serialize;
use crate::AppState;

/// Tables the backend expects to find in Supabase. Each entry is checked
/// with a zero-row `select=1&limit=0` probe — cheap, no data transfer.
const REQUIRED_TABLES: &[&str] = &[
    "telegram_sessions",
    "user_settings",
    "trash_items",
    "file_favorites",
    "file_starred",
    "file_tags",
    "file_versions",
    "shared_links",
    "activity_log",
];

#[derive(Serialize)]
struct TableCheck {
    table: String,
    exists: bool,
    error: Option<String>,
}

#[derive(Serialize)]
struct SchemaStatus {
    supabase_configured: bool,
    tables: Vec<TableCheck>,
    healthy: bool,
}

/// `GET /api/schema/check` — returns per-table existence status.
pub async fn check_schema(_state: web::Data<AppState>) -> impl Responder {
    let configured = crate::supabase_org::is_configured();
    if !configured {
        return HttpResponse::Ok().json(SchemaStatus {
            supabase_configured: false,
            tables: REQUIRED_TABLES
                .iter()
                .map(|t| TableCheck {
                    table: (*t).to_string(),
                    exists: false,
                    error: Some("Supabase not configured".to_string()),
                })
                .collect(),
            healthy: false,
        });
    }

    let mut checks = Vec::new();
    let mut all_ok = true;

    for table in REQUIRED_TABLES {
        let path = format!("{}?select=1&limit=0", table);
        match crate::supabase_org::sb_req("GET", &path, None).await {
            Ok(resp) if resp.status().is_success() => {
                checks.push(TableCheck {
                    table: (*table).to_string(),
                    exists: true,
                    error: None,
                });
            }
            Ok(resp) => {
                all_ok = false;
                checks.push(TableCheck {
                    table: (*table).to_string(),
                    exists: false,
                    error: Some(format!("HTTP {}", resp.status())),
                });
            }
            Err(e) => {
                all_ok = false;
                checks.push(TableCheck {
                    table: (*table).to_string(),
                    exists: false,
                    error: Some(e),
                });
            }
        }
    }

    HttpResponse::Ok().json(SchemaStatus {
        supabase_configured: true,
        tables: checks,
        healthy: all_ok,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_tables_lists_essential_tables() {
        assert!(REQUIRED_TABLES.contains(&"telegram_sessions"));
        assert!(REQUIRED_TABLES.contains(&"user_settings"));
        assert!(REQUIRED_TABLES.contains(&"trash_items"));
        assert!(REQUIRED_TABLES.contains(&"file_favorites"));
    }

    #[test]
    fn schema_status_serializes() {
        let status = SchemaStatus {
            supabase_configured: true,
            tables: vec![
                TableCheck {
                    table: "test".to_string(),
                    exists: true,
                    error: None,
                },
            ],
            healthy: true,
        };
        let v = serde_json::to_value(&status).unwrap();
        assert_eq!(v["supabase_configured"], true);
        assert_eq!(v["healthy"], true);
        assert_eq!(v["tables"][0]["table"], "test");
    }
}