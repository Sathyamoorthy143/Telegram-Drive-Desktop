# Org Picker and Entry Passwords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Telegram login, boot to a Master Admin password setup (first time) or org picker, then require Master Admin password or per-org entry password before entering a workspace.

**Architecture:** Keep Telegram master auth and org-member `/slug` login. Add SHA-256 entry hashes (`user_settings.master_password_hash`, `organizations.entry_password_hash`). New master-only admin APIs unlock in-memory UI state only. Frontend adds `org-picker` and `master-password-setup` boot kinds; Switch organization returns to the picker without Telegram logout.

**Tech Stack:** Rust/Actix backend, React + TypeScript + Vite frontend, Vitest, Supabase Postgres, SHA-256 (`sha2`).

## Global Constraints

- CloudSphere styling: zinc canvas (`bg-zinc-200`), navy CTAs (`cs-btn-navy` / `#1e3a8a`), amber hover (`cs-btn-ghost:hover` / `#fbbf24`), Poppins (`cs-landing` font-family).
- Do not replace org member username/password, Members tab, or `/slug` OrgLogin.
- One live org-member token per user stays; `revoke_sessions_for_member` unchanged.
- Unlock is in-memory only (no localStorage for Master Admin or org entry passwords).
- `master_admin_id` stores stringified Telegram user id (text), not uuid.
- Hash peppers: `sha256(password || "::telegram-drive-master-entry::" || telegram_user_id)` and `sha256(password || "::telegram-drive-org-entry::" || org_id)`. Do not reuse `hash_org_password` or `hash_pin`.
- Never return `entry_password_hash` or `master_password_hash` on list/overview/get APIs; status endpoints return booleans only.
- Min password length 4. First-login Master Admin password cannot be skipped. Later reset from Settings does not require the old password. Org reset does not require the old password.
- Create org payload is `{ name, subdomain, entry_password }`.
- Master bypass on bookmarked `/{slug}` stays. Default `/` after Telegram is picker/setup, never `master-drive`.
- TDD, frequent commits. Do not commit unless a task step says Commit.
- Branch: `260919-feat-cloudsphere-ui-single-session` (already checked out). Do not switch to `main`.
- Backend tests: `cargo test` in `web/backend` if `cargo` exists; otherwise still write `#[cfg(test)]` modules. Frontend: `npx vitest run` and `npx tsc --noEmit` in `web/frontend`.
- No comments in new code unless asked. No emojis.

## File map

- Create: `supabase/migrations/003_org_entry_password.sql`
- Create: `web/frontend/src/components/org/OrgPicker.tsx`
- Create: `web/frontend/src/components/org/OrgPicker.test.tsx`
- Create: `web/frontend/src/components/org/MasterPasswordSetup.tsx`
- Create: `web/frontend/src/components/org/MasterPasswordSetup.test.tsx`
- Modify: `web/backend/src/models.rs` — `CreateOrgRequest.entry_password`, `Organization` skip-serialize hash
- Modify: `web/backend/src/supabase.rs` — `SettingsRow.master_password_hash`, `set_master_password_hash`, `hash_master_password`
- Modify: `web/backend/src/supabase_org.rs` — create org writes owner+hash; `hash_org_entry_password`; filter helper
- Modify: `web/backend/src/orgs.rs` — create requires password; my-orgs/unlock/reset handlers
- Modify: `web/backend/src/admin.rs` — master-unlock-status / master-password / master-unlock
- Modify: `web/backend/src/auth.rs` or `auth_org.rs` — `current_telegram_user_id`
- Modify: `web/backend/src/main.rs` — new routes
- Modify: `web/frontend/src/api.ts` — new clients; `createOrganization` sends `entry_password`
- Modify: `web/frontend/src/api.test.ts` — client existence / create payload if testable
- Modify: `web/frontend/src/App.tsx` — boot kinds + AuthWizard + Switch organization
- Modify: `web/frontend/src/components/org/MasterAdminDashboard.tsx` — entry password on create + reset
- Modify: `web/frontend/src/components/org/OrgAdminDashboard.tsx` — Switch organization for master-in-org
- Modify: `web/frontend/src/components/dashboard/Dashboard.tsx` + `Sidebar.tsx` — Switch organization
- Modify: `web/frontend/src/components/dashboard/SettingsModal.tsx` — reset Master Admin password
- Modify: `web/backend/SUPABASE.md` — document `master_password_hash` column

---

### Task 1: Hash helpers and migration

**Files:**
- Create: `supabase/migrations/003_org_entry_password.sql`
- Modify: `web/backend/src/supabase.rs`
- Modify: `web/backend/src/supabase_org.rs`
- Modify: `web/backend/src/models.rs`
- Test: `#[cfg(test)]` in `supabase.rs` and `supabase_org.rs`

**Interfaces:**
- Consumes: existing `hash_pin`, `hash_org_password`
- Produces:
  - `pub fn hash_master_password(password: &str, telegram_user_id: &str) -> String`
  - `pub fn verify_master_password(password: &str, telegram_user_id: &str, hash: &str) -> bool`
  - `pub fn hash_org_entry_password(password: &str, org_id: &str) -> String`
  - `pub fn verify_org_entry_password(password: &str, org_id: &str, hash: &str) -> bool`
  - `CreateOrgRequest { name: String, subdomain: String, entry_password: String }`
  - `Organization.entry_password_hash: Option<String>` with `#[serde(default, skip_serializing)]`

- [ ] **Step 1: Write the failing hash tests** at the bottom of `web/backend/src/supabase.rs` and `web/backend/src/supabase_org.rs`

In `supabase.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_password_hash_is_stable_and_user_scoped() {
        let a = hash_master_password("secret", "123");
        assert_eq!(a, hash_master_password("secret", "123"));
        assert_ne!(a, hash_master_password("secret", "456"));
        assert_ne!(a, hash_pin("secret"));
        assert!(verify_master_password("secret", "123", &a));
        assert!(!verify_master_password("wrong", "123", &a));
    }
}
```

In `supabase_org.rs` existing `tests` module, add:

```rust
    #[test]
    fn org_entry_password_hash_is_stable_and_org_scoped() {
        let a = hash_org_entry_password("secret", "org-1");
        assert_eq!(a, hash_org_entry_password("secret", "org-1"));
        assert_ne!(a, hash_org_entry_password("secret", "org-2"));
        assert_ne!(a, hash_org_password("secret", "alice"));
        assert!(verify_org_entry_password("secret", "org-1", &a));
        assert!(!verify_org_entry_password("wrong", "org-1", &a));
    }

    #[test]
    fn org_owned_by_matches_telegram_id() {
        let org = Organization {
            id: "o1".into(),
            name: "Acme".into(),
            subdomain: "acme".into(),
            master_admin_id: Some("99".into()),
            created_at: None,
            active: Some(true),
            entry_password_hash: None,
        };
        assert!(org_owned_by(&org, "99"));
        assert!(!org_owned_by(&org, "1"));
        let orphan = Organization { master_admin_id: None, ..org.clone() };
        assert!(!org_owned_by(&orphan, "99"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web/backend && cargo test master_password_hash -- --nocapture`
Expected: compile fail (`hash_master_password` not found) if cargo exists; if cargo is missing, skip run and continue.

- [ ] **Step 3: Write migration + helpers + model fields**

`supabase/migrations/003_org_entry_password.sql`:

```sql
create table if not exists public.user_settings (
  user_id bigint primary key,
  lock_pin_hash text,
  lock_interval_ms bigint default 900000,
  notification_mode text default 'hide',
  updated_at timestamptz default now()
);

alter table public.user_settings
  add column if not exists master_password_hash text;

alter table public.organizations
  add column if not exists entry_password_hash text;

alter table public.organizations
  alter column master_admin_id type text using master_admin_id::text;
```

`models.rs` — Organization add:

```rust
    #[serde(default, skip_serializing)]
    pub entry_password_hash: Option<String>,
```

`CreateOrgRequest`:

```rust
#[derive(Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
    pub subdomain: String,
    pub entry_password: String,
}
```

`SettingsRow`:

```rust
    #[serde(default)]
    pub master_password_hash: Option<String>,
```

`supabase.rs`:

```rust
pub fn hash_master_password(password: &str, telegram_user_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(b"::telegram-drive-master-entry::");
    hasher.update(telegram_user_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn verify_master_password(password: &str, telegram_user_id: &str, hash: &str) -> bool {
    hash_master_password(password, telegram_user_id) == hash
}

pub async fn set_master_password_hash(user_id: i64, hash: String) -> Result<(), String> {
    let (url, key) = match supabase_config() {
        Some(c) => c,
        None => return Ok(()),
    };
    let row = serde_json::json!({
        "user_id": user_id,
        "master_password_hash": hash,
    });
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
        return Err(txt);
    }
    Ok(())
}
```

`supabase_org.rs`:

```rust
pub fn hash_org_entry_password(password: &str, org_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    h.update(b"::telegram-drive-org-entry::");
    h.update(org_id.as_bytes());
    format!("{:x}", h.finalize())
}

pub fn verify_org_entry_password(password: &str, org_id: &str, hash: &str) -> bool {
    hash_org_entry_password(password, org_id) == hash
}

pub fn org_owned_by(org: &Organization, telegram_id: &str) -> bool {
    org.master_admin_id.as_deref() == Some(telegram_id)
}

pub async fn create_organization(
    name: &str,
    subdomain: &str,
    master_admin_id: Option<&str>,
    entry_password_hash: Option<&str>,
) -> Result<Organization, String> {
    let mut row = serde_json::json!({ "name": name, "subdomain": subdomain.to_lowercase() });
    if let Some(id) = master_admin_id {
        row["master_admin_id"] = serde_json::Value::String(id.to_string());
    }
    if let Some(h) = entry_password_hash {
        row["entry_password_hash"] = serde_json::Value::String(h.to_string());
    }
    let resp = sb_req("POST", "organizations", Some(row)).await?;
    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("create organization failed: {}", txt));
    }
    let rows: Vec<Organization> = resp.json().await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| "create returned no row".into())
}

pub fn strip_entry_hash_fields(org: &Organization) -> serde_json::Value {
    serde_json::json!({
        "id": org.id,
        "name": org.name,
        "subdomain": org.subdomain,
        "active": org.active,
        "created_at": org.created_at,
        "master_admin_id": org.master_admin_id,
        "has_entry_password": org.entry_password_hash.as_ref().map(|h| !h.is_empty()).unwrap_or(false),
    })
}
```

Update the existing `create_organization(name, subdomain)` call site in `orgs.rs` in Task 2 (leave a compile error until then, or add a temporary wrapper — prefer updating the call in Task 2 immediately after this compile).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web/backend && cargo test master_password_hash org_entry_password org_owned_by -- --nocapture`
Expected: PASS (or cargo missing).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/003_org_entry_password.sql web/backend/src/supabase.rs web/backend/src/supabase_org.rs web/backend/src/models.rs
git commit -m "feat(org): entry-password hashes and migration 003"
```

---

### Task 2: Backend unlock APIs and create-org password

**Files:**
- Modify: `web/backend/src/auth_org.rs` — `current_telegram_user_id`
- Modify: `web/backend/src/admin.rs`
- Modify: `web/backend/src/orgs.rs`
- Modify: `web/backend/src/main.rs`
- Modify: `web/backend/SUPABASE.md`
- Test: pure unlock helpers in `orgs.rs` or `admin.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: hash helpers from Task 1
- Produces HTTP:
  - `GET /api/admin/master-unlock-status` → `{ has_master_password: bool }`
  - `POST /api/admin/master-password` body `{ password }` → `{ ok: true }`
  - `POST /api/admin/master-unlock` body `{ password }` → `{ ok: true }`
  - `GET /api/admin/my-orgs` → `{ orgs: [...] }` with `has_entry_password`, no hash
  - `POST /api/admin/organizations` requires `entry_password` min 4; writes `master_admin_id` + hash
  - `POST /api/admin/organizations/{id}/unlock` body `{ password }`
  - `POST /api/admin/organizations/{id}/reset-entry-password` body `{ new_password }`

Unlock helper (pure, test this):

```rust
#[derive(Debug, PartialEq)]
pub enum EntryUnlockError { MissingHash, WrongPassword, Inactive, NotOwner }

pub fn evaluate_master_unlock(stored: Option<&str>, password: &str, telegram_id: &str) -> Result<(), EntryUnlockError> {
    let Some(hash) = stored.filter(|h| !h.is_empty()) else { return Err(EntryUnlockError::MissingHash); };
    if crate::supabase::verify_master_password(password, telegram_id, hash) { Ok(()) } else { Err(EntryUnlockError::WrongPassword) }
}

pub fn evaluate_org_unlock(
    stored: Option<&str>,
    password: &str,
    org_id: &str,
    active: bool,
    owner_id: Option<&str>,
    telegram_id: &str,
) -> Result<(), EntryUnlockError> {
    if owner_id != Some(telegram_id) { return Err(EntryUnlockError::NotOwner); }
    if !active { return Err(EntryUnlockError::Inactive); }
    let Some(hash) = stored.filter(|h| !h.is_empty()) else { return Err(EntryUnlockError::MissingHash); };
    if crate::supabase_org::verify_org_entry_password(password, org_id, hash) { Ok(()) } else { Err(EntryUnlockError::WrongPassword) }
}
```

Map: MissingHash → 409, WrongPassword → 401, Inactive/NotOwner → 403.

`current_telegram_user_id` in `auth_org.rs`:

```rust
pub async fn current_telegram_user_id(state: &web::Data<AppState>) -> Result<i64, HttpResponse> {
    require_master(state).await?;
    let client = crate::auth::get_client(state).await.map_err(|e| HttpResponse::InternalServerError().body(e))?;
    match client.get_me().await {
        Ok(me) => Ok(me.id().bare_id().unwrap_or(0) as i64),
        Err(e) => Err(HttpResponse::Unauthorized().body(e.to_string())),
    }
}
```

Create-org handler must reject missing/short `entry_password` with 400, then:

```rust
let uid = match crate::auth_org::current_telegram_user_id(&state).await {
    Ok(id) => id,
    Err(resp) => return resp,
};
let uid_s = uid.to_string();
let hash = supabase_org::hash_org_entry_password(&body.entry_password, "pending");
```

Org id is unknown until insert. Spec hashes with `org_id`. So: create the org row first without hash (or with a placeholder), then PATCH hash using the returned id — **do not do that** (race). Instead: create org, then immediately PATCH `entry_password_hash` using the new id, in the same handler. If PATCH fails, still return the org but unlock will 409 until reset.

Better: generate nothing; after `create_organization` returns `org.id`, compute `hash_org_entry_password(password, &org.id)` and PATCH.

```rust
let org = supabase_org::create_organization(name, &sub, Some(&uid_s), None).await?;
let hash = supabase_org::hash_org_entry_password(&body.entry_password, &org.id);
let _ = supabase_org::sb_req("PATCH", &format!("organizations?id=eq.{}", org.id), Some(serde_json::json!({ "entry_password_hash": hash }))).await;
```

Reset-entry-password: min 4; master only; if `master_admin_id` is null, claim it; if set and != current id, 403.

Audit: `org.unlock` and `org.entry_password.reset` with `user_id` None.

Password body structs:

```rust
#[derive(Deserialize)]
pub struct PasswordBody { pub password: String }
#[derive(Deserialize)]
pub struct NewPasswordBody { pub new_password: String }
```

Put these in `models.rs`.

Routes in `main.rs` next to existing admin org routes:

```rust
.route("/admin/master-unlock-status", web::get().to(admin::master_unlock_status))
.route("/admin/master-password", web::post().to(admin::set_master_password))
.route("/admin/master-unlock", web::post().to(admin::master_unlock))
.route("/admin/my-orgs", web::get().to(orgs::list_my_organizations))
.route("/admin/organizations/{id}/unlock", web::post().to(orgs::unlock_organization))
.route("/admin/organizations/{id}/reset-entry-password", web::post().to(orgs::reset_entry_password))
```

Master password set: min 4; upsert hash; no old password required.

- [ ] **Step 1: Write failing unit tests** for `evaluate_master_unlock` / `evaluate_org_unlock` in `orgs.rs` or a small `entry_unlock.rs` module if `orgs.rs` is already huge — prefer adding `web/backend/src/entry_unlock.rs` and `mod entry_unlock;` in `main.rs` to keep handlers thin.

- [ ] **Step 2: Run tests, expect fail**

- [ ] **Step 3: Implement helpers + handlers + routes**

- [ ] **Step 4: Run `cargo test`** Expected: PASS if cargo present.

- [ ] **Step 5: Commit** `feat(api): master and org entry-password unlock endpoints`

---

### Task 3: Frontend API client

**Files:**
- Modify: `web/frontend/src/api.ts`
- Modify: `web/frontend/src/api.test.ts`

**Interfaces:**
- Produces:
  - `getMasterUnlockStatus(): Promise<{ has_master_password: boolean }>`
  - `setMasterPassword(password: string): Promise<{ ok: boolean }>`
  - `unlockMaster(password: string): Promise<{ ok: boolean }>`
  - `getMyOrgs(): Promise<{ orgs: MyOrg[] }>`
  - `unlockOrganization(id: string, password: string): Promise<{ ok: boolean; org: { id: string; name: string; subdomain: string } }>`
  - `resetOrgEntryPassword(id: string, new_password: string): Promise<{ ok: boolean }>`
  - `createOrganization(name, subdomain, entry_password)` — third argument required

```ts
export interface MyOrg {
  id: string;
  name: string;
  subdomain: string;
  active?: boolean;
  created_at?: string;
  master_admin_id?: string | null;
  has_entry_password: boolean;
}

export const getMasterUnlockStatus = () =>
  api<{ has_master_password: boolean }>('GET', '/api/admin/master-unlock-status');

export const setMasterPassword = (password: string) =>
  api<{ ok: boolean }>('POST', '/api/admin/master-password', { password });

export const unlockMaster = (password: string) =>
  api<{ ok: boolean }>('POST', '/api/admin/master-unlock', { password });

export const getMyOrgs = () =>
  api<{ orgs: MyOrg[] }>('GET', '/api/admin/my-orgs');

export const unlockOrganization = (id: string, password: string) =>
  api<{ ok: boolean; org: { id: string; name: string; subdomain: string } }>(
    'POST', `/api/admin/organizations/${id}/unlock`, { password });

export const resetOrgEntryPassword = (id: string, new_password: string) =>
  api<{ ok: boolean }>('POST', `/api/admin/organizations/${id}/reset-entry-password`, { new_password });

export const createOrganization = (name: string, subdomain: string, entry_password: string) =>
  api<any>('POST', '/api/admin/organizations', { name, subdomain, entry_password });
```

Test: keep existing api tests green; add that `createOrganization` is a function of arity 3 if needed. Do not hit network.

- [ ] **Step 1–4: TDD the exports exist and `createOrganization` sends three fields** (mock fetch if the `api()` helper is interceptable; otherwise skip network test and rely on compile).

- [ ] **Step 5: Commit** `feat(ui): admin unlock API client helpers`

---

### Task 4: MasterPasswordSetup + OrgPicker

**Files:**
- Create: `web/frontend/src/components/org/MasterPasswordSetup.tsx`
- Create: `web/frontend/src/components/org/MasterPasswordSetup.test.tsx`
- Create: `web/frontend/src/components/org/OrgPicker.tsx`
- Create: `web/frontend/src/components/org/OrgPicker.test.tsx`

**Interfaces:**
- Consumes: Task 3 API helpers
- Produces:
  - `MasterPasswordSetup({ onReady: () => void })`
  - `OrgPicker({ onUnlockMaster: () => void; onUnlockOrg: (org: { id: string; name: string; subdomain: string }) => void; onTelegramLost?: () => void })`

MasterPasswordSetup: two fields, min 4, must match, Submit, cannot skip. Calls `setMasterPassword`. On success `onReady()`. CloudSphere card on `bg-zinc-200`.

OrgPicker: loads `getMyOrgs`. Master Admin card “Personal drive”. Org cards show name, subdomain, inactive. Click opens password modal (password, Submit, Cancel). Master submit → `unlockMaster`. Org submit → `unlockOrganization`. Wrong password inline error. No hash → “Set an entry password in Organizations first”; submit disabled. Inactive: card disabled. Empty orgs: only Master Admin + hint. 401 on `getMyOrgs` → `onTelegramLost`. Do not store passwords in localStorage.

Tests (jsdom, mock `../../api`):
- Setup submit matching passwords calls `setMasterPassword` then `onReady`.
- Mismatch / short password does not call API.
- Picker renders Master Admin + returned orgs.
- Master click opens modal; success calls `onUnlockMaster`; 401 stays on picker with error.
- Org click; success calls `onUnlockOrg`; failure shows error.
- Inactive org has disabled card.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run `npx vitest run src/components/org/MasterPasswordSetup.test.tsx src/components/org/OrgPicker.test.tsx`** Expected: fail (modules missing)
- [ ] **Step 3: Implement components**
- [ ] **Step 4: Tests pass**
- [ ] **Step 5: Commit** `feat(ui): org picker and master password setup screens`

---

### Task 5: App boot, Switch organization, create/reset UI

**Files:**
- Modify: `web/frontend/src/App.tsx`
- Modify: `web/frontend/src/components/org/MasterAdminDashboard.tsx`
- Modify: `web/frontend/src/components/org/OrgAdminDashboard.tsx`
- Modify: `web/frontend/src/components/org/OrgAdminDashboard.test.tsx`
- Modify: `web/frontend/src/components/dashboard/Dashboard.tsx`
- Modify: `web/frontend/src/components/dashboard/Sidebar.tsx`
- Modify: `web/frontend/src/components/dashboard/SettingsModal.tsx`

**Interfaces:**
- Boot kinds add `{ kind: "org-picker" }` and `{ kind: "master-password-setup" }`
- After Telegram connected and no org path: `getMasterUnlockStatus()` → setup if `!has_master_password` else picker
- `AuthWizard onLogin` same rule (never `master-drive`)
- Auto-login reconnect same rule
- Path/subdomain org resolution unchanged
- `onSwitchOrganization`: `api.setOrgContext(null)`; `setBoot({ kind: "org-picker" })`; do **not** call `api.logout`; do **not** clear other orgs’ tokens
- Logout still `api.logout()` + landing
- Dashboard: optional `onSwitchOrganization`; Sidebar button “Switch organization”
- OrgAdminDashboard: replace master `onBack` ArrowLeft with “Switch organization”; keep member logout
- MasterAdminDashboard: entry password field on create; reset field on org detail
- SettingsModal: Master Admin password + confirm, `setMasterPassword`, no old password

App helper:

```ts
async function bootAfterTelegram(): Promise<BootState> {
  const st = await api.getMasterUnlockStatus().catch(() => ({ has_master_password: false }));
  return { kind: st.has_master_password ? "org-picker" : "master-password-setup" };
}
```

Org unlock success:

```ts
api.setOrgContext(org.id);
api.setOrgSlug(org.subdomain);
setBoot({ kind: "org-dashboard", org, session: null });
```

Master unlock success: `setBoot({ kind: "master-drive" })`.

If Telegram lost on picker: `setShowLanding(true); setBoot({ kind: "master-auth" })`.

Tests:
- OrgAdminDashboard master (session null) shows “Switch organization” not “Back” if `onSwitchOrganization` provided.
- Do not call `api.logout` from switch handler (test App via extracting `switchOrganization` is overkill — test OrgAdminDashboard click does not call `orgLogout`/`logout`).

- [ ] **Step 1: Write/extend failing tests**
- [ ] **Step 2: Run vitest, expect fail**
- [ ] **Step 3: Wire App + dashboards + settings**
- [ ] **Step 4: `npx vitest run` and `npx tsc --noEmit` in `web/frontend`** Expected: all pass, tsc clean
- [ ] **Step 5: Commit** `feat(ui): picker boot, switch organization, and password reset`

---

### Task 6: Docs + regression

**Files:**
- Modify: `web/backend/SUPABASE.md` — add `master_password_hash` to `user_settings` snippet
- Confirm `orgLogin` / `revoke_sessions_for_member` untouched

- [ ] **Step 1: Update SUPABASE.md user_settings block** with `master_password_hash text`
- [ ] **Step 2: Run frontend tests + tsc**
- [ ] **Step 3: Commit** `docs: master_password_hash on user_settings`

---

## Self-review

**Spec coverage:**
- Picker after Telegram — Task 5
- First-login Master Admin password — Tasks 2, 4, 5
- Org entry password at create / reset without old — Tasks 2, 5
- Unlock in-memory — Task 5
- Member `/slug` unchanged — Task 6 + do not touch OrgLogin
- Hashes and peppers — Task 1
- APIs table — Task 2
- Switch organization vs Logout — Task 5
- Inactive / missing hash / 401/403/409 — Task 2 + Task 4
- `my-orgs` filter — Task 2
- Historical orgs unlistable until claimed via reset — Task 2 reset claims null owner

**Placeholders:** none.

**Types:** `CreateOrgRequest.entry_password`, `MyOrg.has_entry_password`, `evaluate_*` error enum used by handlers.
