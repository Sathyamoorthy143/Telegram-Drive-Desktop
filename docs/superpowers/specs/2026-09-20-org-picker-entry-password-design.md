# Post-login org picker and org entry password

Date: 2026-09-20
Status: approved for planning (pending user review of this file)

## Problem

After Telegram Sign In the app lands on the personal drive. Organizations are a separate username/password system with no Telegram ownership. Master Telegram can open any org without a password. Created orgs are not presented as a first-class choice after login.

Desired flow: after Telegram login, show organizations first (Master Admin plus orgs this user created). Then a password: Master Admin uses the password created on first Telegram login; each org uses the unique password set when Master Admin created that org. Master Admin can reset org passwords. Org member username/password on `/slug` stays for other people.

## Goals

- After successful Telegram auth, boot to an org picker, not the personal drive.
- Picker lists Master Admin (personal drive) plus organizations this Telegram user created.
- First Telegram login prompts once to create a Master Admin password (min 4). Later logins: picker, then that password to open the personal drive.
- Each org has one entry password, set at create time, resettable by Master Admin without the old password.
- Unlocking an org opens it as master/owner. User stays in that workspace until they Switch organization or Logout.
- Member username/password, Members tab, and `/slug` OrgLogin stay unchanged.
- Existing orgs without an entry password cannot be unlocked until Master Admin sets one.

## Non-goals

- Replacing org member accounts with a shared org password.
- Using the dashboard lock PIN as the Master Admin or org entry password.
- Multi-Telegram-user tenancy on one backend process (still one GramJS client).
- Changing folder grants, provisioning, or org trash.
- Persisting unlock in Postgres or localStorage (unlock is in-memory for this browser session).

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
  Master password missing? --yes--> Create Master Admin password (once)
        | no
        v
   Org picker  ---------------- Switch organization --------+
        |                                                   |
        | Master Admin + master password                    |
        v                                                   |
  Personal drive  ------------------------------------------+
  (Switch organization / Logout)                            |
        |                                                   |
        | pick org + org entry password                     |
        v                                                   |
  Org dashboard (master as owner) --------------------------+
  (Switch organization / Logout)

/{slug} member username/password  ->  OrgLogin  ->  Org dashboard (member session)
```

Boot change in `web/frontend/src/App.tsx`:

- New boot kinds: `org-picker`, `master-password-setup`.
- After Telegram `checkConnection()` succeeds and there is no org path/subdomain context: if Master Admin password is unset, `master-password-setup`; else `org-picker`. Never boot straight to `master-drive`.
- Path/subdomain org resolution is unchanged: stored member token, else Telegram master bypass, else `org-login`.
- `AuthWizard.onLogin` follows the same setup-or-picker rule, not `master-drive`.
- Auto-login that reconnects Telegram follows the same rule.

Master bypass on `/{slug}` stays so bookmarked org URLs still work when Telegram is live. The picker (with passwords) is the default for `/` after Telegram login.

## UI flow

### Org picker screen

CloudSphere styling (zinc canvas, navy CTAs, amber hover, Poppins).

First Telegram login (Master Admin password unset): full-screen setup before the picker. Two fields (password + confirm), min 4 characters, Submit. Success goes to the picker. Cannot skip.

Cards:

1. Master Admin — subtitle “Personal drive”. Click opens a password modal (Master Admin password). Success opens `master-drive`.
2. One card per org from `GET /api/admin/my-orgs` — name, subdomain, active flag. Click opens an org entry-password modal.

Empty org list is valid: only the Master Admin card plus a short hint to create orgs from Master Admin → Organizations.

Primary actions on picker:

- None required besides selecting a card.
- Create Organization is not on the picker (stays in master console), per approved UI.

Password modal (Master Admin and org cards):

- Password field, Submit, Cancel.
- Wrong password: inline error, stay on picker/modal.
- Inactive org: card disabled or submit returns an error; cannot unlock.
- Org with no entry password set: modal copy “Set an entry password in Organizations first”; submit disabled or 409.

### After unlock / Master Admin

- Org dashboard: no Back that dumps to the picker.
- Add Switch organization (drive sidebar/top bar and org dashboard chrome). It returns to `org-picker` without calling Telegram logout and without clearing org member tokens for other orgs.
- Logout remains Telegram sign-out and returns to marketing landing (`master-auth` + `showLanding`).
- Master console (`master-orgs`) still reachable from the personal drive banner “Master admin · Organizations”. Create org there requires the org entry password. Reset org entry password lives on the org detail in that console. Reset Master Admin password lives in Settings on the personal drive (already unlocked); does not require the old password.

### Member `/slug` flow

Unchanged: `OrgLogin` username + password, single-session revoke for that member, Members tab, folder grants.

## Data model

New migration `supabase/migrations/003_org_entry_password.sql` (idempotent):

```sql
alter table public.organizations
  add column if not exists entry_password_hash text;

alter table public.organizations
  alter column master_admin_id type text using master_admin_id::text;

alter table public.user_settings
  add column if not exists master_password_hash text;
```

`master_admin_id` is currently uuid but Telegram user ids are integers. Store them as text (stringified Telegram id from `get_me()`). Existing nulls stay null.

Hash functions (dedicated; do not reuse member hashing):

```text
sha256(password || "::telegram-drive-master-entry::" || telegram_user_id)
sha256(password || "::telegram-drive-org-entry::" || org_id)
```

`entry_password_hash` and `master_password_hash` are never returned on list/overview/get APIs. Status endpoints return only booleans (`has_master_password`, `has_entry_password`).

Create organization payload becomes `{ name, subdomain, entry_password }`. Minimum length 4, same as members. Backend writes `master_admin_id = telegram_user_id` and `entry_password_hash`.

Existing orgs: hash is null until Master Admin sets/resets it. Unlock rejects those with 409.

Master Admin password lives on `user_settings.master_password_hash` keyed by Telegram `user_id`. If `user_settings` has no row yet, upsert one on first set. If a deploy has no `user_settings` table, the same migration creates it to match `web/backend/SUPABASE.md` (user_id PK, lock columns, master_password_hash) before adding the column.

## APIs

All new routes require live Telegram master (`require_master`). They do not accept org member tokens.

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/admin/master-unlock-status` | — | `{ has_master_password: boolean }` |
| POST | `/api/admin/master-password` | `{ password }` | `{ ok: true }`. First-login set when hash is null. Later reset from personal drive Settings without the old password. Min length 4. |
| POST | `/api/admin/master-unlock` | `{ password }` | `{ ok: true }`. 401 wrong password, 409 if hash not set. |
| GET | `/api/admin/my-orgs` | — | `{ orgs: Organization[] }` filtered `master_admin_id = current Telegram id`. Never includes `entry_password_hash`. Include `has_entry_password: boolean`. |
| POST | `/api/admin/organizations` | `{ name, subdomain, entry_password }` | created org (existing handler, extra fields). 400 if password missing/short. |
| POST | `/api/admin/organizations/{id}/unlock` | `{ password }` | `{ ok: true, org: { id, name, subdomain } }`. 401 wrong password, 403 not owner / not master, 409 no hash set, 403/409 inactive. |
| POST | `/api/admin/organizations/{id}/reset-entry-password` | `{ new_password }` | `{ ok: true }`. Master Telegram only, and only for orgs this Telegram user created (`master_admin_id` match) or hash-null orgs being claimed. Does not require the old password. Min length 4. Sets `entry_password_hash` and, if `master_admin_id` is null, writes the current Telegram id. |

Org unlock does not create an `OrgSession` and does not revoke member sessions. Frontend, on success, navigates into that org the same way today’s master bypass does (`setOrgContext`, boot `org-dashboard` with `session: null`). Master unlock only flips in-memory UI state to `master-drive`. Neither password is stored in localStorage. Switch organization or full page reload returns to the picker and requires the password again.

`GET /api/admin/overview` and `GET /api/admin/organizations` remain the full fleet for the master console. The picker uses only `my-orgs` so users do not see orgs they did not create.

Audit: log `org.unlock` and `org.entry_password.reset` on `org_audit_logs` with `user_id` null (master).

## Frontend components

- New `web/frontend/src/components/org/OrgPicker.tsx`: list + password modal for Master Admin and orgs.
- New `web/frontend/src/components/org/MasterPasswordSetup.tsx`: first-login create Master Admin password.
- `App.tsx`: boot kinds `master-password-setup` and `org-picker`; AuthWizard success → setup or picker; Switch organization → picker; Logout → landing.
- `Dashboard.tsx` / `OrgAdminDashboard.tsx`: Switch organization control; replace master-bypass Back with Switch organization. Settings can reset Master Admin password.
- `MasterAdminDashboard.tsx`: create-org form adds entry password; org detail adds reset-entry-password; keep member create/reset as today.
- `api.ts`: `getMasterUnlockStatus`, `setMasterPassword`, `unlockMaster`, `getMyOrgs`, `unlockOrganization`, `resetOrgEntryPassword`; `createOrganization` sends `entry_password`.

Do not store Master Admin or org entry passwords in localStorage.

## Error handling

| Case | Behavior |
|---|---|
| First login, master password unset | `master-password-setup`; cannot reach picker until set |
| Wrong Master Admin password | 401, modal error, stay on picker |
| Wrong org password | 401, modal error, stay on picker |
| Inactive org | cannot unlock; card shows inactive |
| No org entry password set | 409, instruct to set it in Organizations |
| Unlock org not owned by this Telegram id | 403 even if master process could list it in overview |
| Telegram session dropped on picker | treat as logged out, landing |
| `my-orgs` empty | show Master Admin card only |
| Member `/slug` 401 | existing OrgLogin errors; unrelated to entry password |

## Testing

Frontend (vitest):

- First-login setup submits password + confirm and then shows the picker.
- Picker renders Master Admin plus returned orgs.
- Master Admin click opens a password modal; success opens the drive; failure stays on picker.
- Org click opens modal; success callback fires; failure shows error.
- Switch organization handler does not call `api.logout`.

Backend (existing Rust unit style in `auth_org.rs` / new tests beside org handlers if runnable; otherwise pure hash + filter helpers):

- `hash_master_password` / `hash_org_entry_password` are deterministic and differ from member hashing.
- `my-orgs` filter keeps only matching `master_admin_id`.
- Master unlock accepts matching password, rejects wrong/empty/missing hash.
- Org unlock accepts matching password, rejects wrong/empty/inactive/missing hash.
- Master password set on first login; later reset does not require the old password.
- Org reset sets a new hash without the old password; rejects short passwords.

Regression: `orgLogin` member username/password and `revoke_sessions_for_member` unchanged.

## Out of scope follow-ups

- Migrating historical orgs’ `master_admin_id` for rows created before this feature (they stay unlistable on the picker until recreated or a one-off SQL backfill).
- Replacing SHA-256 with argon2 (same as current member passwords).
- Persisting “this org is unlocked” across backend restarts (master bypass already depends on the Telegram client).
