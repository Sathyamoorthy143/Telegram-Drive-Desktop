//! Master-admin dashboard API: cross-org overview.
//!
//! All endpoints require Telegram auth (master admin). Org members use the
//! `/api/org/{id}/...` routes in [`crate::orgs`] instead.

use actix_web::{web, HttpResponse, Responder};

use crate::auth_org::require_master;
use crate::supabase_org;
use crate::AppState;

/// `GET /api/admin/overview` — per-org member/trash/audit counts + totals.
pub async fn overview(state: web::Data<AppState>) -> impl Responder {
    if require_master(&state).await.is_err() {
        return HttpResponse::Unauthorized().body("Master admin authentication required");
    }
    if !supabase_org::is_configured() {
        return HttpResponse::ServiceUnavailable().body("Supabase not configured");
    }
    let orgs = match supabase_org::list_organizations().await {
        Ok(o) => o,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    // Fan out per-org lookups concurrently: sequential awaits would cost
    // O(orgs × 4 round trips); join_all makes it ~1 round-trip latency.
    let rows: Vec<serde_json::Value> = futures::future::join_all(orgs.iter().map(|org| async move {
        let (members, trash, audit, settings) = futures::future::join4(
            supabase_org::list_org_members(&org.id),
            supabase_org::list_org_trash(&org.id),
            supabase_org::list_org_audit(&org.id, 1),
            supabase_org::get_org_settings(&org.id),
        )
        .await;
        // Surface lookup failures explicitly: zeros must mean "empty",
        // never "the query failed".
        let mut errors: Vec<&str> = Vec::new();
        let members = members.map(|m| m.len()).unwrap_or_else(|_| { errors.push("members"); 0 });
        let trash = trash.map(|t| t.len()).unwrap_or_else(|_| { errors.push("trash"); 0 });
        let has_audit = audit.map(|a| !a.is_empty()).unwrap_or_else(|_| { errors.push("audit"); false });
        let settings = settings.map_err(|_| errors.push("settings")).ok().flatten();
        let mut row = serde_json::json!({
            "id": org.id,
            "name": org.name,
            "subdomain": org.subdomain,
            "active": org.active,
            "created_at": org.created_at,
            "member_count": members,
            "trash_count": trash,
            "has_audit": has_audit,
            "provisioned": settings.as_ref().and_then(|s| s.channel_id).is_some(),
            "channel_id": settings.as_ref().and_then(|s| s.channel_id),
            "backup_channel_id": settings.as_ref().and_then(|s| s.backup_channel_id),
        });
        if !errors.is_empty() {
            row["partial"] = serde_json::json!(true);
            row["errors"] = serde_json::json!(errors);
        }
        row
    }))
    .await;
    let partial = rows.iter().any(|r| r.get("partial").and_then(|v| v.as_bool()).unwrap_or(false));
    HttpResponse::Ok().json(serde_json::json!({
        "org_count": rows.len(),
        "orgs": rows,
        "partial": partial,
    }))
}
