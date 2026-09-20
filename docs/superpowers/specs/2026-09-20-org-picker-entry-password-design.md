# Post-login org picker and org entry password

Date: 2026-09-20
Status: approved for planning (pending user review of this file)

## Problem

After Telegram Sign In the app lands on the personal drive. Organizations are a separate username/password system with no Telegram ownership. Master Telegram can open any org without a password. Created orgs are not presented as a first-class choice after login.

Desired flow: after Telegram login, show organizations first (Master Admin plus orgs this user created). Master Admin opens with no extra password. Selecting an org requires the unique password set when Master Admin created that org. Master Admin can reset that password. Org member username/password on `/slug` stays for other people.

## Goals

- After successful Telegram auth, boot to an org picker, not the personal drive.
- Picker lists Master Admin (personal drive) plus organizations this Telegram user created.
- Master Admin requires no extra password (Telegram session is enough).
- Each org has one entry password, set at create time, resettable by Master Admin.
- Unlocking an org opens it as master/owner. User stays in that org until they Switch organization or Logout.
- Member username/password, Members tab, and `/slug` OrgLogin stay unchanged.
- Existing orgs without an entry password cannot be unlocked until Master Admin sets one.

## Non-goals

- Replacing org member accounts with a shared org password.
- Requiring a Master Admin password in addition to Telegram.
- Multi-Telegram-user tenancy on one backend process (still one GramJS client).
- Changing folder grants, provisioning, or org trash.
- Storing org-unlock sessions in Postgres (master bypass remains the in-process Telegram client).

## Current state (facts)

Two auth systems sit side by side:

- Master Telegram session: one GramJS client. Whoever is logged in is master admin.
- Org members: per-org username/password in `org_members`. No Telegram id on those rows.

`organizations.master_admin_id` exists (uuid, nullable) but is never written. Create org inserts only `name` + `subdomain`. After Telegram login, `App.tsx` sets `master-drive`. `master-orgs` is only reached from a banner. Visiting `/{slug}` while Telegram is connected skips OrgLogin (synthetic owner session).

## Architecture

```text
Telegram Sign In
        |
        v
   Org picker  ---- Switch organization ----+
        |                                   |
        | Master Admin (no password)        |
        v                                   |
  Personal drive  --------------------------+
  (Switch organization / Logout)            |
        |                                   |
        | pick org + entry password         |
        v                                   |
  Org dashboard (master as owner) ----------+
  (Switch organization / Logout)

/{slug} member username/password  ->  OrgLogin  ->  Org dashboard (member session)
```

Boot change in `web/frontend/src/App.tsx`:

- New boot kind: `org-picker`.
- After Telegram `checkConnection()` succeeds and there is no org path/subdomain context, set `org-picker` instead of `master-drive`.
- Path/subdomain org resolution is unchanged: stored member token, else Telegram master bypass, else `org-login`.
- `AuthWizard.onLogin` goes to `org-picker`, not `master-drive`.
- Auto-login that reconnects Telegram also goes to `org-picker`.

Master bypass on `/{slug}` stays so bookmarked org URLs still work when Telegram is live. The picker is the default for `/` after Telegram login.

## UI flow

### Org picker screen

CloudSphere styling (zinc canvas, navy CTAs, amber hover, Poppins).

Cards:

1. Master Admin — subtitle “Personal drive”. Click opens `master-drive` with no password modal.
2. One card per org from `GET /api/admin/my-orgs` — name, subdomain, active flag. Click opens an entry-password modal.

Empty org list is valid: only the Master Admin card plus a short hint to create orgs from Master Admin → Organizations.

Primary actions on picker:

- None required besides selecting a card.
- Create Organization is not on the picker (stays in master console), per approved UI.

Password modal (org card only):

- Password field, Submit, Cancel.
- Wrong password: inline error, stay on picker/modal.
- Inactive org: card disabled or submit returns an error; cannot unlock.
- Org with no entry password set: modal copy “Set an entry password in Organizations first”; submit disabled or 409.

### After unlock / Master Admin

- Org dashboard: no Back that dumps to the picker.
- Add Switch organization (drive sidebar/top bar and org dashboard chrome). It returns to `org-picker` without calling Telegram logout and without clearing org member tokens for other orgs.
- Logout remains Telegram sign-out and returns to marketing landing (`master-auth` + `showLanding`).
- Master console (`master-orgs`) still reachable from the personal drive banner “Master admin · Organizations”. Create org there requires the entry password. Reset entry password lives on the org detail in that console.

### Member `/slug` flow

Unchanged: `OrgLogin` username + password, single-session revoke for that member, Members tab, folder grants.

## Data model

New migration `supabase/migrations/003_org_entry_password.sql` (idempotent):

```sql
alter table public.organizations
  add column if not exists entry_password_hash text;

alter table public.organizations
  alter column master_admin_id type text using master_admin_id::text;
```

`master_admin_id` is currently uuid but Telegram user ids are integers. Store them as text (stringified Telegram id from `get_me()`). Existing nulls stay null.

Hash function: reuse `hash_org_password` in `web/backend/src/supabase_org.rs` (SHA-256 of `password || "::telegram-drive-org::" || lowercase(username)`). For org entry passwords there is no member username; use the org id as the pepper:

```text
sha256(password || "::telegram-drive-org-entry::" || org_id)
```

Do not reuse member password hashing with a fake username. Keep a dedicated `hash_org_entry_password(password, org_id)` so member hashes and entry hashes cannot be confused.

`entry_password_hash` is never returned on list/overview/get APIs.

Create organization payload becomes `{ name, subdomain, entry_password }`. Minimum length 4, same as members. Backend writes `master_admin_id = telegram_user_id` and `entry_password_hash`.

Existing orgs: hash is null until Master Admin sets/resets it. Unlock rejects those with 409.

## APIs

All three new routes require live Telegram master (`require_master`). They do not accept org member tokens.

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/admin/my-orgs` | — | `{ orgs: Organization[] }` filtered `master_admin_id = current Telegram id`. Never includes `entry_password_hash`. Include `has_entry_password: boolean`. |
| POST | `/api/admin/organizations` | `{ name, subdomain, entry_password }` | created org (existing handler, extra fields). 400 if password missing/short. |
| POST | `/api/admin/organizations/{id}/unlock` | `{ password }` | `{ ok: true, org: { id, name, subdomain } }`. 401 wrong password, 403 not owner / not master, 409 no hash set, 403/409 inactive. |
| POST | `/api/admin/organizations/{id}/reset-entry-password` | `{ new_password }` | `{ ok: true }`. Master Telegram only, and only for orgs this Telegram user created (`master_admin_id` match) or hash-null orgs being claimed. Does not require the old password. Min length 4. Sets `entry_password_hash` and, if `master_admin_id` is null, writes the current Telegram id. |

Unlock does not create an `OrgSession` and does not revoke member sessions. Frontend, on success, navigates into that org the same way today’s master bypass does (`setOrgContext`, boot `org-dashboard` with `session: null`).

`GET /api/admin/overview` and `GET /api/admin/organizations` remain the full fleet for the master console. The picker uses only `my-orgs` so users do not see orgs they did not create.

Audit: log `org.unlock` and `org.entry_password.reset` on `org_audit_logs` with `user_id` null (master).

## Frontend components

- New `web/frontend/src/components/org/OrgPicker.tsx`: list + password modal.
- `App.tsx`: boot kind `org-picker`; AuthWizard success → picker; Switch organization → picker; Logout → landing.
- `Dashboard.tsx` / `OrgAdminDashboard.tsx`: Switch organization control; remove “Back dumps to picker” for unlocked master-in-org (today Back exists only for master bypass — replace that Back with Switch organization).
- `MasterAdminDashboard.tsx`: create-org form adds entry password; org detail adds reset-entry-password; keep member create/reset as today.
- `api.ts`: `getMyOrgs`, `unlockOrganization`, `resetOrgEntryPassword`; `createOrganization` sends `entry_password`.

Do not store the org entry password in localStorage. Unlock is a one-shot check; the live Telegram client is the continuing credential.

## Error handling

| Case | Behavior |
|---|---|
| Wrong org password | 401, modal error, stay on picker |
| Inactive org | cannot unlock; card shows inactive |
| No entry password set | 409, instruct to set it in Organizations |
| Unlock org not owned by this Telegram id | 403 even if master process could list it in overview |
| Telegram session dropped on picker | treat as logged out, landing |
| `my-orgs` empty | show Master Admin card only |
| Member `/slug` 401 | existing OrgLogin errors; unrelated to entry password |

## Testing

Frontend (vitest):

- Picker renders Master Admin plus returned orgs.
- Master Admin click does not open a password modal.
- Org click opens modal; success callback fires; failure shows error.
- Switch organization handler does not call `api.logout`.

Backend (existing Rust unit style in `auth_org.rs` / new tests beside org handlers if runnable; otherwise pure hash + filter helpers):

- `hash_org_entry_password` is deterministic and differs from member hashing.
- `my-orgs` filter keeps only matching `master_admin_id`.
- Unlock accepts matching password, rejects wrong/empty/inactive/missing hash.
- Reset sets a new hash without the old password; rejects short passwords.

Regression: `orgLogin` member username/password and `revoke_sessions_for_member` unchanged.

## Out of scope follow-ups

- Migrating historical orgs’ `master_admin_id` for rows created before this feature (they stay unlistable on the picker until recreated or a one-off SQL backfill).
- Replacing SHA-256 with argon2 (same as current member passwords).
- Persisting “this org is unlocked” across backend restarts (master bypass already depends on the Telegram client).
