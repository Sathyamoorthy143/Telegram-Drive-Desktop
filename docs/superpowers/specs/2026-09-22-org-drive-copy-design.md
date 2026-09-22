# Org Panel as Exact Copy of Master Drive — Design

Date: 2026-09-22 | Status: approved by user (all 3 sections) | Approach: A (reuse real Dashboard)

## 1. Goal

Every organization panel — existing and future — renders as an exact copy of
the master drive UI: left `Sidebar`, top `TopBar`, file explorer main area.
Prior convergence work unified design tokens via `components/org/ui.tsx`;
this spec unifies the layout and the drive feature set.

## 2. Locked decisions (user Q&A)

1. **Copy depth — everything that works.** Reuse the real `Dashboard`
   component in org context. Features with no org backend surface the
   existing "not available in organization" error to the user.
2. **Members/Activity/Settings — sidebar entries, admin-only.** They sit
   beside Starred/Recent/Trash and render only for admins.
3. **Roles — everyone full power on files.** Viewer, editor, and admin all
   browse/search/upload/download/delete. Roles gate only the three admin
   sidebar entries.
4. **Org identity — org name header.** Sidebar header shows org name + role
   badge; Switch organization + Logout entries stay.

## 3. Architecture

- `App.tsx`: the `org-dashboard` route renders `<Dashboard
  onLogout onSwitchOrganization orgMode={{ org, session }} />` instead of
  `OrgAdminDashboard`. `session` is null on master bypass (full power),
  otherwise the member session (`{ username, role, member_id }`).
- `Dashboard` stays a single component — no fork. Org context (set via
  `api.setOrgContext`, as today) keeps driving auto-routing. The `orgMode`
  prop only switches sidebar header/entries and main-area view switching.
- `Sidebar` changes are props-only: optional org header block, optional
  admin entries, extended `activeView`/`onViewChange` ids. Without `orgMode`
  it renders byte-identical to today — zero visual change for master.
- Members/Activity/Settings panels are extracted verbatim from
  `OrgAdminDashboard.tsx` into focused components, rendered in the main area
  when their sidebar entry is active. Same API calls (`getOrgMembers`,
  `getOrgActivity`, `getOrgSettings`, `updateOrgSettings`,
  `getOrgStorageStatus`, member add/remove), new home.
- `OrgAdminDashboard.tsx` is deleted after extraction + route switch. Its
  tests migrate to the extracted panels + org-mode Dashboard wiring.
- Every org boots through the same route, so existing and future orgs get
  the copy automatically — including future master improvements.

## 4. Components + data flow

- **No new data layer.** Existing queries (`files`, `trash`, `favorites`,
  `recent`, `bandwidth`) run unchanged; `api.ts` auto-routing
  (`getFiles`→`getOrgFiles`, `uploadFile`→`uploadOrgFile`,
  `downloadFile`→org blob) sends them to org endpoints under org context.
- **Sidebar:** `orgName` + `role` header replaces the user-info block;
  `showAdminEntries` adds Members/Activity/Settings below Trash.
  Starred/Recent/Trash keep working where org endpoints exist, else §5.
- **Main area:** `activeFolderId` drives Files/Starred/Recent/Trash exactly
  as master. Admin entries switch the main area to the extracted panels.
- **TopBar:** reused as-is (upload/folder/camera, search, bulk actions, view
  settings, lock). Lock/PIN stays device-local and unchanged.
- **Master bypass:** `session: null` + org context shows admin entries with
  all actions enabled; logout/switch flow unchanged.

## 5. Error handling

- Features with no org backend throw `<feature> is not available in
  organization context` (existing `requireNoOrgContext` guard). Each call
  site shows this via sonner toast — no crashes, no silent failures.
- Audit list (verify-or-toast-or-hide each): share links, tags, versions,
  bandwidth widget, storage insights/duplicates, global activity log,
  favorites/star, recent, settings modal contents, command palette actions,
  camera upload, encryption PIN flow, `getUserInfo`.
- Admin entries never render for non-admins (not merely disabled). Backend
  403s surface via the shared `Banner` error style.
- Auth expiry keeps today's behavior (session-expired toast → logout/login).

## 6. Testing

- `npx tsc --noEmit` clean; `cargo test` green (no backend changes).
- Frontend suite green with migrated coverage: extracted panels keep current
  scenarios; new org-mode Dashboard tests assert org header + admin entries
  for admins, hidden entries for viewers/editors, file actions enabled for
  all roles, and toast behavior for unavailable features.
- Residue scan: no legacy tokens in touched files. `graphify update .` after
  changes. Whole-branch review before merge to `main`.

## 7. Out of scope

- Backend changes (org endpoints already exist; gaps stay gaps with toasts).
- Master drive visual/behavioral changes (props-only additions, render path
  untouched without `orgMode`).
- `AuthWizard`, `Landing`, master SettingsModal contents.
- Per-org theming or customization.
