# Supabase Integration — Telegram Drive Web Backend (Free Tier)

Self-hosted `Supabase Postgres` for **session persistence** (survives `Render Free` deploy wipes + refresh) + **lockscreen settings** (absolute interval + notification mode).

Backend: `Telegram-Drive-Desktop/web/backend` (`telegram-drive-web` `v1.0.0`), Frontend: `web/frontend`.

---

## Why Supabase?

| Problem | Before (Free) | With Supabase |
|---------|---------------|---------------|
| Refresh asks OTP | `App.tsx:13` `useState(false)` loses auth, backend `telegram.session` in `/app/data` survives sleep but not deploy | `App.tsx:22` `GET /api/auth/user-info` auto-restores from `telegram_sessions` `supabase.rs:11` |
| Deploy wipes session | `/app/data` ephemeral, `logout` after `git push` | `upsert_session` on `sign_in` (`auth.rs:130`) saves `base64(telegram.session)` to Supabase, `restore_session_if_needed` restores on next `get_client` |
| Lockscreen not persisted | `localStorage` only | `user_settings` syncs `lock_pin_hash`/`lock_interval_ms`/`notification_mode` (`settings.rs:83` `PUT /api/settings/lock`) |

Free tier `Supabase` (500MB) is enough: 1 row per user (~50KB session blob).

---

## 1. SQL Schema — Run in Supabase SQL Editor

> **Getting `PGRST205: Could not find the table 'public.X' in the schema cache`?**
> It means that table was never created — just re-run the block below.
> Everything uses `IF NOT EXISTS` / `DROP ... IF EXISTS`, so re-running is
> safe and only creates what's missing. (Share previews and trash deletes
> also work without Supabase now — see §1.1 — but creating the tables unlocks
> link listing/revoke, trash restore, stars, tags, and activity sync.)

```sql
create table if not exists telegram_sessions (
  user_id bigint primary key, -- bare_id from grammers Client.get_me()
  session_blob text not null, -- base64 of telegram.session file
  api_id int,
  updated_at timestamptz default now()
);

create table if not exists user_settings (
  user_id bigint primary key references telegram_sessions(user_id) on delete cascade,
  lock_pin_hash text, -- sha256(pin + "telegram-drive-salt") hex
  lock_interval_ms int default 900000, -- 15min absolute
  notification_mode text default 'hide' check (notification_mode in ('suppress','hide','allow')),
  updated_at timestamptz default now()
);

create table if not exists trash_items (
  id bigserial primary key,
  message_id bigint not null,
  folder_id bigint,
  name text not null,
  size bigint default 0,
  deleted_at timestamptz default now(),
  user_id bigint references telegram_sessions(user_id) on delete cascade
);
create index if not exists idx_trash_user on trash_items(user_id);
create index if not exists idx_trash_folder on trash_items(folder_id);

create table if not exists shared_links (
  token text primary key,
  message_id int not null,
  folder_id bigint,
  name text,
  created_at timestamptz default now(),
  expires_at timestamptz,
  views int default 0,
  user_id bigint references telegram_sessions(user_id) on delete cascade
);
create index if not exists idx_share_user on shared_links(user_id);
create index if not exists idx_share_expires on shared_links(expires_at);

create table if not exists file_favorites (
  message_id bigint not null,
  folder_id bigint,
  name text default '',
  starred_at timestamptz default now(),
  primary key (message_id, folder_id)
);
create table if not exists file_recents (
  message_id bigint not null,
  folder_id bigint,
  name text default '',
  size bigint default 0,
  opened_at timestamptz default now(),
  primary key (message_id, folder_id)
);
create table if not exists file_tags (
  message_id bigint not null,
  folder_id bigint,
  tags text[] default '{}',
  updated_at timestamptz default now(),
  primary key (message_id, folder_id)
);
create table if not exists activity_logs (
  id bigserial primary key,
  action text not null,
  detail text,
  name text,
  created_at timestamptz default now()
);

create table if not exists file_versions (
  id bigserial primary key,
  folder_id bigint,
  name text not null,
  message_id bigint not null,
  size bigint default 0,
  version_no int not null,
  created_at timestamptz default now()
);
create index if not exists idx_versions_file on file_versions(folder_id, name, version_no);

-- Allow service_role (backend) full access; anon not needed
alter table telegram_sessions enable row level security;
alter table user_settings enable row level security;
alter table trash_items enable row level security;
alter table shared_links enable row level security;
alter table file_favorites enable row level security;
alter table file_recents enable row level security;
alter table file_tags enable row level security;
alter table activity_logs enable row level security;
alter table file_versions enable row level security;
drop policy if exists "service_role all" on telegram_sessions;
drop policy if exists "service_role all2" on user_settings;
drop policy if exists "service_role all3" on trash_items;
drop policy if exists "service_role all4" on shared_links;
drop policy if exists "service_role all5" on file_favorites;
drop policy if exists "service_role all6" on file_recents;
drop policy if exists "service_role all7" on file_tags;
drop policy if exists "service_role all8" on activity_logs;
drop policy if exists "service_role all9" on file_versions;
create policy "service_role all" on telegram_sessions for all using (true) with check (true);
create policy "service_role all2" on user_settings for all using (true) with check (true);
create policy "service_role all3" on trash_items for all using (true) with check (true);
create policy "service_role all4" on shared_links for all using (true) with check (true);
create policy "service_role all5" on file_favorites for all using (true) with check (true);
create policy "service_role all6" on file_recents for all using (true) with check (true);
create policy "service_role all7" on file_tags for all using (true) with check (true);
create policy "service_role all8" on activity_logs for all using (true) with check (true);
create policy "service_role all9" on file_versions for all using (true) with check (true);

-- Optional: auto updated_at
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists t_sessions on telegram_sessions;
drop trigger if exists t_settings on user_settings;
create trigger t_sessions before update on telegram_sessions for each row execute procedure touch_updated_at();
create trigger t_settings before update on user_settings for each row execute procedure touch_updated_at();
```

Verify: `Table Editor` shows 8 tables, `SQL` `select * from telegram_sessions;` empty until first login.

### 1.1 Supabase-free fallbacks (no action needed)

- **Share links / office preview**: tokens are stateless HMAC-signed
  (`{mid}.{fid}.{exp}.{sig}`, `share.rs`). Creating and opening links works
  with zero Supabase tables; the `shared_links` table only adds
  list/revoke/view-counts. Optional env `SHARE_SECRET` (falls back to
  `TG_API_HASH`); without it links break on restart (logged warning).
- **Trash**: without `trash_items`, delete falls back to a real (hard) delete
  so the file still goes away instead of silently staying.

---

## 2. Env Vars

### Render (Backend) — Dashboard > Environment

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci... (Settings > API > service_role, NOT anon)
# already set for Free Free:
SESSION_PATH=/app/data/telegram.session
SETTINGS_PATH=/app/data/settings.json
PORT=8080 (Render injects 10000, code handles empty)
RUST_LOG=info
```

`SUPABASE_SERVICE_KEY` also accepts `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` fallback (`supabase.rs:11`).

If `SUPABASE_URL` not set, backend **no-ops** (file-only, refresh still works until deploy).

### Cloudflare Pages (Frontend) — Variables

```
VITE_API_URL=https://telegram-drive-web-1dvn.onrender.com
# Optional, only if frontend direct Supabase (not needed, backend proxies):
# VITE_SUPABASE_URL=https://xxx.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...
```

Vite bakes `VITE_API_URL` at **build time** — set before `Retry deployment`.

---

## 3. Backend Code

| File | What |
|------|------|
| `src/supabase.rs` | `supabase_config()`, `upsert_session(user_id, api_id)` (reads `SESSION_PATH` -> base64 -> `POST /rest/v1/telegram_sessions?on_conflict=user_id`), `get_session`, `restore_session_if_needed`, `upsert_user_settings`, `get_user_settings`, `hash_pin` (sha256) |
| `src/trash.rs` | `soft_delete` (insert `trash_items` + NOT delete from Telegram), `list_trash` (`GET trash_items`), `restore` (DELETE from trash), `empty_trash` (hard `delete_messages` from Telegram), `get_files` (`files.rs:20` filters `trashed` set via Supabase) |
| `src/auth.rs:11` | `get_client` checks `metadata(&sp).is_err` -> `restore_session_if_needed(None)` before `SqliteSession::open`; on `sign_in`/`check_password` success spawns `upsert_session` |
| `src/auth.rs:166` | `logout` deletes Supabase row `DELETE /rest/v1/telegram_sessions?user_id=eq.{uid}` |
| `src/settings.rs:83` | `LockSettingsRequest {pin, lock_interval_ms, notification_mode}` + `PUT /api/settings/lock` (hashes pin, `upsert_user_settings`) + `GET /api/settings/lock` merges `user_settings` row |
| `src/models.rs:38` | `Settings` added `lock_pin_hash`, `lock_interval_ms`, `notification_mode` |
| `src/main.rs:1,80` | `mod supabase`, `mod trash`, routes `POST /files/delete` -> `soft_delete`, `GET /trash`, `POST /trash/restore`, `POST /trash/empty`, `GET/PUT /api/settings/lock`, `PORT` handles empty `supabase.rs:31` |
| `Cargo.toml:32` | `sha2 = "0.10"` for `hash_pin` |

Build check: `cargo check` passes (`LockSettingsRequest` needs `Deserialize`).

---

## 4. Frontend Code

| File | What |
|------|------|
| `src/context/LockContext.tsx` | `hashPin` via `crypto.subtle.digest('SHA-256', pin+salt)` matching Rust `sha2`, `isLocked`, `hasPin`, `lockIntervalMs` (default 15min), `notificationMode` (`suppress`/`hide`/`allow` from `localStorage` + `GET /api/settings/lock`), `setInterval(lock, ms)` absolute + `visibilitychange`/`blur` background lock, `queueToast`/`flushQueue` |
| `src/components/LockScreen.tsx` | `auth-glass` 4-digit `grid-cols-3` `h-14` keypad (phone `FileCard.tsx:49` `2-col` grid safe), dots, `Delete`/`Clear`, 3 fails -> `localStorage.clear()` + reload |
| `src/App.tsx:22` | `useEffect` mount `fetch /api/auth/user-info` (or `/api/check-connection`) -> `setIsAuthenticated(true)` + `localStorage`; fixes refresh OTP; shows `LockScreen` if `hasPin && isLocked`; flushes queued toasts per `notificationMode` |
| `src/components/dashboard/SettingsModal.tsx` | `useLock` adds PIN set (4 digits, confirm), Interval `Select` (5/15/30/60min), Radio `suppress/hide/allow` (user-choice) -> `PUT /api/settings/lock` |
| `src/components/dashboard/Sidebar.tsx:218` | Added `Trash` `SidebarItem` `activeFolderId===-1` `Trash2` icon, `FileExplorer` `w-80` queue `left-4 right-4 md:right-4` phone |
| `src/components/dashboard/Dashboard.tsx:241` | `handleManualUpload` etc now push to `uploadQueue` + `isLocked ? queueToast : toast`, `trash` query `GET /trash`, `handleRestore`/`handleEmptyTrash`, `isTrash` conditional view + `soft_delete` flow |
| `src/api.ts:1` | Added `getTrash`/`restoreTrash`/`emptyTrash` (`/api/trash*`) |

---

## 5. API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `PUT` | `/api/settings/lock` | `{pin?:string, lock_interval_ms?:number, notification_mode?:string}` | Hash pin, upsert `user_settings`, sync `Settings` file |
| `GET` | `/api/settings/lock` | - | Merge `Settings` + Supabase `user_settings` row, return combined |
| `POST` | `/api/files/delete` | `{message_id, folder_id}` | **Soft delete** -> insert `trash_items`, `get_files` filters trashed until `empty` |
| `GET` | `/trash` | - | List `trash_items` `order=deleted_at.desc` |
| `POST` | `/trash/restore` | `{message_id, folder_id}` | `DELETE` from `trash_items`, file reappears (`get_files` no longer filtered) |
| `POST` | `/trash/empty` | - | Hard `delete_messages` from Telegram for all trashed + `DELETE trash_items` |
| `POST` | `/api/auth/request-code` | `{phone, api_id, api_hash}` | Unchanged, but `api_id` also saved for `upsert_session` |
| `POST` | `/api/auth/sign-in` | `{code}` | On success, `upsert_session` |
| `GET` | `/api/auth/user-info` | - | `get_client` restores from Supabase if file missing, so refresh works |

---

## 6. Deploy Flow (Free)

1. **Push** `git push origin main` -> `Render` builds `rust:latest` + `debian:trixie-slim` (`Dockerfile:16`), `cargo build --release` (~17s cached), `HEALTHCHECK curl /api/health` `keep_alive.rs:5`
2. **First login** after env set: OTP -> `sign_in` -> Supabase row created
3. **Refresh** `frestorage.dpdns.org`: `App.tsx:22` hits `/api/auth/user-info` -> `auth.rs:11` finds `telegram.session` (or restores from Supabase if deploy wiped) -> `200` -> no wizard
4. **Deploy again**: `/app/data` wiped, but next request `restore_session_if_needed` pulls `session_blob` base64 -> writes file -> login persists

**Debug:**
*   `Render Logs`: `Supabase session upserted for user X`, `Restored session for user X`
*   `Supabase Table Editor`: `telegram_sessions` should have 1 row after login
*   `curl -H "apikey: $SERVICE_KEY" https://xxx.supabase.co/rest/v1/telegram_sessions?select=*`

---

## 7. Troubleshooting

*   **Refresh still asks OTP**: Check `Render` logs for `restore_session_if_needed` and `Supabase` env set; `nslookup` not needed; check `GET /api/auth/user-info` `Network` `200`?
*   **Supabase 401**: `SERVICE_KEY` must be `service_role`, not `anon`; `supabase_config()` checks `SUPABASE_SERVICE_KEY` first.
*   **PIN unlock fails after reload**: Frontend `hashPin` async `crypto.subtle` vs Rust `sha2` hex must match; `LockContext.tsx` falls back to `hashPinSync` legacy, then re-fetches `GET /api/settings/lock` to sync `sha256` hash.
*   **Notifications leak when locked**: `Dashboard.tsx:241` uses `isLocked` + `notificationMode`; check `SettingsModal` radio saved.
*   **File upload no response**: Already fixed `UploadQueue` `Dashboard.tsx:241` shows `pending->uploading->success`; ensure `VITE_API_URL` set at build.

---

## 8. Costs & Limits

*   Supabase Free: 500MB DB, 50K MAU, 2GB bandwidth - 1 session blob ~50KB, lock settings negligible.
*   Render Free: 512MB RAM, sleeps after 15min, `keep_alive.rs:16` self-ping every 4min via `RENDER_EXTERNAL_URL`.
*   Cloudflare Pages Free: Unlimited builds, `VITE_API_URL` baked at build.

---

## 9. Related Env Examples

`web/backend/.env.example` add:

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
LOCK_INTERVAL_MS=900000
NOTIFICATION_MODE=hide
```

`render.yaml` already has `SESSION_PATH=/app/data/telegram.session` `SETTINGS_PATH=/app/data/settings.json` for Free non-root `appuser` `Dockerfile:28` `chown -R`.
