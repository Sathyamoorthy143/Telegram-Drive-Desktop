# Common Sign-In Design

Date: 2026-09-23
Status: approved (Approach A)
Scope: single shared Sign-In for master admin and organisation entry; Telegram login demoted to setup/reconnect; org list gone.

## 1. UX / flow

- New `web/frontend/src/components/org/SignIn.tsx`, built on `OrgShell` + `AuthCard`
  (same convergence pattern as `OrgPicker` / `OrgLogin` / `MasterPasswordSetup`).
- One "Organisation name" field, one password field, one Sign in button, one error line.
- Identifier `master` (trimmed, case-insensitive) + master password unlocks master
  and routes to the master dashboard.
- Any other identifier resolves the org by display name OR subdomain (trimmed,
  case-insensitive) and checks that org's entry password, then routes to the org
  dashboard in `orgMode`.
- `OrgPicker.tsx` is deleted; nothing lists organisations at login.
- `App.tsx` boot: when the backend reports existing orgs, render `SignIn`
  instead of the Telegram wizard.
- `AuthWizard` survives ONLY as first-run setup (bot token + master password
  creation with the new Telegram-token design) and as in-app reconnect.
  It is no longer a login path.
- Org-URL member login (`OrgLogin`) is unchanged.

## 2. Backend

- New public `GET /api/orgs/resolve?name=` returning `{org_id, display_name}`
  or 404. Matching mirrors the frontend normalization (trim, lowercase,
  display name or subdomain).
- Unlock calls stay as-is: existing master unlock, existing org unlock by id
  after resolve.
- New unlock throttling (in scope): per-IP plus per-account failure counting,
  temporary lockout with `Retry-After` on excess failures.

## 3. Errors / security

- Single generic failure string — "Invalid name or password" — for unknown
  name, wrong password, and throttled states alike.
- A resolve 404 is folded into the same generic message client-side; there is
  no separate "organisation not found" text.
- Throttle responses carry a retry hint and nothing identifying.
- No enumeration: no org list, no which-half-failed signal, anywhere.

## 4. Components / files touched

- ADD `web/frontend/src/components/org/SignIn.tsx` (+ test).
- DELETE `web/frontend/src/components/org/OrgPicker.tsx`.
- EDIT `web/frontend/src/App.tsx` (boot renders `SignIn` when orgs exist).
- EDIT `web/frontend/src/components/AuthWizard.tsx` (setup/reconnect only).
- KEEP `web/frontend/src/components/org/OrgLogin.tsx` (org-URL member login).
- Backend: resolve endpoint, throttling on unlock paths (+ tests).

## 5. Testing

- Frontend: reserved-word routing to master unlock; org name resolve then
  unlock; generic error for unknown name and wrong password; no org list rendered.
- Backend: resolve matching (case, subdomain, unknown yields 404); throttle
  lockout after repeated failures; `Retry-After` present.
- Gates: `npx tsc --noEmit`, `npm test` in `web/frontend`, `cargo test` in
  `web/backend`, `graphify update .`.
