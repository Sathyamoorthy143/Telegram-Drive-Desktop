# Org UI/UX convergence onto Master Admin — Design Spec

Date: 2026-09-21 | Approach: shared shell components (Approach 2) | Status: approved for planning

## 1. Problem

The three organization screens each speak a different visual language from the
master admin, and from each other:

- `MasterAdminDashboard.tsx` (452 lines): telegram theme tokens
  (`bg-telegram-surface`, `border-telegram-border`, `text-telegram-subtext`),
  centered `max-w-5xl` column, header row (back + icon + title/subtitle +
  actions), banner slots, `grid gap-3` cards.
- `OrgAdminDashboard.tsx` (957 lines): own header, own 5-tab bar
  (`files | trash | members | activity | settings`), dense file-first layout.
- `OrgPicker.tsx` (195 lines): `bg-zinc-200`, inline Poppins font, navy/amber
  cards, `cs-btn-*` button classes.
- `OrgLogin.tsx` (118 lines): `bg-zinc-200` + telegram tokens mixed, plus a
  lazy-loaded WebGL `Scene3D` backdrop inside `TiltCard`.

## 2. Decisions (from brainstorming Q&A)

- Q1 scope = B: all org screens (`OrgPicker`, `OrgLogin`, `OrgAdminDashboard`).
- Q2 depth = A: full convergence onto master-admin tokens; zinc-200, Poppins,
  navy/amber, `cs-btn-*`, and the 3D login backdrop go away.
- Q3 layout = A: everything — including files/trash — lives in the centered
  `max-w-5xl` card column. Density loss on narrow content is accepted.
- Q4 navigation = A: keep the 5 tabs, restyled, inside the centered column.
- Q5 guardrails = C: visual work plus simplification of redundant paths
  (unlock modal vs login card, banners, empty states, buttons).

## 3. Architecture

New file `web/frontend/src/components/org/ui.tsx` exporting, extracted from
what `MasterAdminDashboard` already does (no new visual language invented):

- `OrgShell` — scroll container + `max-w-5xl mx-auto` + `p-6`.
- `PageHeader` — icon + title + subtitle + right-side action slot.
- `Banner` — variants `error` (stale backend), `warning` (partial/inactive),
  `info`.
- `OrgCard` — `bg-telegram-surface border border-telegram-border rounded-xl`.
- `OrgModal` — overlay + dialog frame (replaces picker's bespoke modal).
- `AuthCard` — username/password form shell with `mode: 'unlock' |
  'member-login'` (see §5a).
- `EmptyState` — muted centered text for empty lists and footnotes.
- `TabBar` — the 5-tab style in the master-admin button idiom
  (primary-filled active, bordered hover inactive).

`MasterAdminDashboard` is refactored to consume these components first with
zero visual change, proving them before the org screens adopt them.

## 4. Per-screen changes

- **OrgPicker.** Drop `bg-zinc-200`, Poppins, navy/amber, `cs-btn-*`. Render
  in `OrgShell` + `PageHeader` (Building2, "Choose a workspace"). Master Admin
  and org rows become `OrgCard`s reusing the `inactive` pill. Unlock dialog
  becomes `OrgModal` + `AuthCard mode='unlock'`.
- **OrgLogin.** Delete the `Scene3D`/`TiltCard` lazy imports so three.js never
  loads on this route (extends the tier1 bundle diet). Card becomes `OrgCard`
  + `AuthCard mode='member-login'` centered in `OrgShell`. Inactive notice
  becomes `Banner warning`. Back-link and info note become `EmptyState` text.
  `friendlyOrgLoginError` wording is kept unchanged.
- **OrgAdminDashboard.** Whole dashboard moves inside `OrgShell`. Header
  becomes `PageHeader` with back/logout/switch-organization in the action
  slot. Same 5 tabs in the restyled `TabBar` with identical role gating.
  Members/activity/settings sections become `OrgCard`s. Files/trash keep all
  behavior (folder tree, upload engine, bulk ops, thumbnail cache, pagination)
  but render in the centered column with surface tokens.

## 5. Simplifications (exhaustive — nothing beyond this list)

- (a) Picker unlock-modal and member login-card merge into `AuthCard` with
  two modes. One password form, one error style.
- (b) All ad-hoc notices (picker empty text, login inactive, dashboard
  partial/stale) become `Banner` variants.
- (c) All buttons converge on two patterns: `bg-telegram-primary text-white`
  primary and bordered `hover:bg-telegram-hover` secondary. `cs-btn-*` and
  `bg-blue-900` usages are removed from these three screens.
- (d) Upload engine, pagination, thumbnail cache, audit calls, and all API
  shapes are behaviorally untouched.

## 6. Non-goals and guardrails

- No backend changes of any kind.
- Role gating (`canEdit`/`canAdmin`, tab visibility) is behaviorally
  identical; viewers never gain admin affordances.
- `MasterPasswordSetup` is untouched (setup wizard, out of scope).
- Dark mode comes free via telegram tokens; verified visually, not
  re-engineered.
- File-manager density on wide screens is knowingly traded for convergence
  (Q3=A); cards wrap, no separate wide mode.

## 7. Testing and acceptance

- Update the existing org test files (`OrgPicker.test.tsx`,
  `OrgAdminDashboard.test.tsx`, `MasterPasswordSetup.test.tsx`, plus any
  login coverage) for new text/classes only; no test-logic changes.
- `npx tsc --noEmit` clean, `npm test` green, `cargo test` run once for
  safety (no backend changes expected).
- Manual acceptance: picker, login, and dashboard eyeballed for
  owner/admin/editor/viewer, light + dark, confirming the master-admin look.
- `graphify update .` after code changes; commit spec, plan, and
  implementation separately.
