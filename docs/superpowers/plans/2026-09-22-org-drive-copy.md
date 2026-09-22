# Org Panel as Exact Copy of Master Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the real master `Dashboard` for the `org-dashboard` route with org-aware sidebar entries, so every org gets the exact master drive layout.

**Architecture:** Props-only additions to `Sidebar`/`Dashboard` (master render path byte-identical); Members/Activity/Settings extracted verbatim from `OrgAdminDashboard.tsx` into focused panel components; `App.tsx` route switch; `OrgAdminDashboard.tsx` deleted last. Approach A per `docs/superpowers/specs/2026-09-22-org-drive-copy-design.md`.

**Tech Stack:** React 18 + TypeScript, Tailwind telegram tokens, Vitest + Testing Library, existing `api.ts` org auto-routing (no backend changes).

## Global Constraints

- No `web/backend/` changes of any kind.
- Master render path unchanged: `Sidebar`/`Dashboard` without the new optional props render byte-identical output.
- No per-org theming; new orgs inherit the copy automatically through the shared route.
- All roles have full file power; admin sidebar entries render only for admins (`!session` master bypass or role `admin`/`owner`) — never merely disabled.
- Unavailable-in-org features surface the backend/api message via sonner toast; no crashes, no silent failures.
- Commit per task on branch `feat/org-drive-copy`; push only that branch until final review passes; then merge to `main`, push, `graphify update .`.

---

## File Structure

- Modify: `web/frontend/src/components/dashboard/Sidebar.tsx` — add optional `orgHeader`, `adminViews`, `activeAdminView`, `onSelectAdminView` props (Task 2).
- Create: `web/frontend/src/components/org/OrgMembersPanel.tsx` — verbatim members + grants section (Task 1).
- Create: `web/frontend/src/components/org/OrgActivityPanel.tsx` — verbatim activity section (Task 1).
- Create: `web/frontend/src/components/org/OrgSettingsPanel.tsx` — verbatim settings section (Task 1).
- Test: `web/frontend/src/components/org/OrgPanels.test.tsx` — migrated panel scenarios (Task 1).
- Test: `web/frontend/src/components/dashboard/Sidebar.org.test.tsx` — org header + admin entries (Task 2).
- Modify: `web/frontend/src/components/dashboard/Dashboard.tsx` — add optional `orgMode` prop, wire sidebar, main-area view switch (Task 3).
- Modify: `web/frontend/src/App.tsx` — `org-dashboard` renders `Dashboard` with `orgMode` (Task 3).
- Test: `web/frontend/src/components/dashboard/Dashboard.org.test.tsx` — org-mode wiring (Task 3).
- Modify: `web/frontend/src/components/dashboard/Dashboard.tsx` — toast guards for unavailable features (Task 4).
- Delete: `web/frontend/src/components/org/OrgAdminDashboard.tsx` + migrate `OrgAdminDashboard.test.tsx` (Task 5).

### Shared interfaces (exact — every task uses these verbatim)

```ts
// Panels
OrgMembersPanel({ orgId, role, sessionMemberId, folders }: {
  orgId: string; role: string; sessionMemberId: string | null; folders: any[];
})
OrgActivityPanel({ orgId }: { orgId: string })
OrgSettingsPanel({ orgId, role }: { orgId: string; role: string })

// Sidebar additions (all optional)
orgHeader?: { name: string; detail: string };
adminViews?: { id: 'members' | 'activity' | 'settings'; label: string }[];
activeAdminView?: 'members' | 'activity' | 'settings' | null;
onSelectAdminView?: (id: 'members' | 'activity' | 'settings') => void;

// Dashboard addition (optional)
orgMode?: {
  org: { id: string; name: string; subdomain: string };
  session: { username: string; role: string; member_id: string } | null;
};
```

Role rule: `const showAdmin = !orgMode || !orgMode.session || ['admin', 'owner'].includes(orgMode.session.role);`

---

### Task 1: Extract Members/Activity/Settings panels verbatim

**Files:**
- Create: `web/frontend/src/components/org/OrgMembersPanel.tsx`
- Create: `web/frontend/src/components/org/OrgActivityPanel.tsx`
- Create: `web/frontend/src/components/org/OrgSettingsPanel.tsx`
- Test: `web/frontend/src/components/org/OrgPanels.test.tsx`

**Interfaces:**
- Consumes: org API fns (`getOrgMembers`, `createOrgMember`, `deleteOrgMember`, `getOrgGrants`, `setOrgGrant`, `deleteOrgGrant`, `getOrgActivity`, `getOrgStorageStatus`, `getOrgSettings`, `updateOrgSettings`), types `OrgMember`, `AuditEntry`, `api.OrgFolderGrant`.
- Produces: the three panel components with the exact props from Shared interfaces (Task 3 renders them).

- [ ] **Step 1: Create `OrgMembersPanel.tsx` by moving lines 752-860 of `OrgAdminDashboard.tsx`**

Move the `{tab === 'members' && (...)}` inner JSX plus its state/handlers (`members`, `grants`, `newUser`, `grantForm`, `loadMembers`, `loadGrants`, `saveGrant`, `removeGrant`, `createMember`, `deleteMember`, `memberName`, `folderName`) into the new component with props `{ orgId, role, sessionMemberId, folders }`. Replace `org.id` → `orgId`, `session?.member_id` → `sessionMemberId`. Keep `canAdmin` local: `const canAdmin = (r: string) => ['admin', 'owner'].includes(r);`. Fetch on mount with `useEffect(() => { loadMembers(); loadGrants(); }, [orgId])`. Wrap output in `<OrgCard>` as today.

- [ ] **Step 2: Create `OrgActivityPanel.tsx` by moving lines 862-889**

Move the activity JSX + `activity` state + `loadActivity`, props `{ orgId }`, fetch on mount, `<OrgCard>` wrapper kept.

- [ ] **Step 3: Create `OrgSettingsPanel.tsx` by moving lines 891-938**

Move the settings JSX + `storage`, `orgSettings`, `settingsDraft`, `savingSettings` state + `loadStorage`, `saveSettings`, props `{ orgId, role }`, fetch on mount (`loadStorage()` in `useEffect(..., [orgId])`), `<OrgCard>` wrapper kept.

- [ ] **Step 4: Write `OrgPanels.test.tsx` migrating `OrgAdminDashboard.test.tsx` scenarios**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OrgMembersPanel } from './OrgMembersPanel';

vi.mock('../../api', () => ({
  getOrgMembers: vi.fn(async () => [{ id: 'm1', username: 'alice', role: 'viewer' }]),
  getOrgGrants: vi.fn(async () => []),
  createOrgMember: vi.fn(),
  deleteOrgMember: vi.fn(),
  setOrgGrant: vi.fn(),
  deleteOrgGrant: vi.fn(),
}));

describe('OrgMembersPanel', () => {
  it('lists members with role badges', async () => {
    render(<OrgMembersPanel orgId="o1" role="admin" sessionMemberId="m9" folders={[]} />);
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    expect(screen.getByText('viewer')).toBeTruthy();
  });
});
```

Add equivalent cases for `OrgActivityPanel` (renders rows from mocked `getOrgActivity`) and `OrgSettingsPanel` (shows provisioned status from mocked `getOrgStorageStatus`/`getOrgSettings`).

- [ ] **Step 5: Run the panel tests**

Run: `npx vitest run src/components/org/OrgPanels.test.tsx` from `web/frontend`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add web/frontend/src/components/org/OrgMembersPanel.tsx web/frontend/src/components/org/OrgActivityPanel.tsx web/frontend/src/components/org/OrgSettingsPanel.tsx web/frontend/src/components/org/OrgPanels.test.tsx
git commit -m "feat(org-drive-copy): extract members/activity/settings panels verbatim"
```

---

### Task 2: Sidebar org header + admin entries (props-only)

**Files:**
- Modify: `web/frontend/src/components/dashboard/Sidebar.tsx:12-39` (props), `:251-272` (header), `:302-328` (entries)
- Test: `web/frontend/src/components/dashboard/Sidebar.org.test.tsx`

**Interfaces:**
- Consumes: existing `SidebarProps`, `SidebarItem`, lucide `Users`, `Settings`, `Activity` icons.
- Produces: the four optional Sidebar props from Shared interfaces (Task 3 passes them).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

const baseProps = {
  folders: [], activeFolderId: null, userInfo: null,
  setActiveFolderId: vi.fn(), onDrop: vi.fn(), onDelete: vi.fn(),
  onRename: vi.fn(), onCut: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(),
  canPaste: false, onProperties: vi.fn(), onCreate: vi.fn(async () => {}),
  onSettings: vi.fn(), isSyncing: false, isConnected: true,
  onSync: vi.fn(), onRefresh: vi.fn(), onLogout: vi.fn(),
  bandwidth: null, onActivityLog: vi.fn(), onAllVersions: vi.fn(),
};

describe('Sidebar org mode', () => {
  it('shows org header and admin entries, selecting one calls back', () => {
    const onSelect = vi.fn();
    render(<Sidebar {...baseProps}
      orgHeader={{ name: 'Acme', detail: 'acme · alice (admin)' }}
      adminViews={[{ id: 'members', label: 'Members' }, { id: 'activity', label: 'Activity' }, { id: 'settings', label: 'Settings' }]}
      activeAdminView={null}
      onSelectAdminView={onSelect} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    fireEvent.click(screen.getByText('Members'));
    expect(onSelect).toHaveBeenCalledWith('members');
  });

  it('renders no admin entries without adminViews', () => {
    render(<Sidebar {...baseProps} orgHeader={{ name: 'Acme', detail: 'acme' }} />);
    expect(screen.queryByText('Members')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/Sidebar.org.test.tsx` from `web/frontend`
Expected: FAIL — `orgHeader`/`adminViews` props do not exist.

- [ ] **Step 3: Add the optional props and render branches**

In `SidebarProps` add:

```ts
orgHeader?: { name: string; detail: string };
adminViews?: { id: 'members' | 'activity' | 'settings'; label: string }[];
activeAdminView?: 'members' | 'activity' | 'settings' | null;
onSelectAdminView?: (id: 'members' | 'activity' | 'settings') => void;
```

Destructure them in the `Sidebar` signature. Replace the header name block (`:264-271`) with:

```tsx
<div className="flex flex-col min-w-0">
    <span className="font-bold text-sm text-telegram-text truncate">
        {orgHeader ? orgHeader.name : (userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}` : 'Cloudsphere Space')}
    </span>
    <span className="text-[10px] text-telegram-subtext truncate">
        {orgHeader ? orgHeader.detail : (userInfo?.username ? `@${userInfo.username}` : (isConnected ? 'Online' : 'Offline'))}
    </span>
</div>
```

After the Versions `SidebarItem` (`:320-328`), insert:

```tsx
{(adminViews ?? []).map((v) => (
    <SidebarItem
        key={v.id}
        icon={v.id === 'members' ? Users : v.id === 'activity' ? Activity : Settings}
        label={v.label}
        active={activeAdminView === v.id}
        onClick={() => onSelectAdminView?.(v.id)}
        onDrop={(e: React.DragEvent) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        folderId={null}
    />
))}
```

Add `Users, Activity` to the lucide import on line 2 (`Settings` is already imported).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/dashboard/Sidebar.org.test.tsx` from `web/frontend`
Expected: PASS. Then run `npx vitest run src/components/dashboard/TopBar.test.tsx` to confirm no regressions in neighboring suites.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/components/dashboard/Sidebar.tsx web/frontend/src/components/dashboard/Sidebar.org.test.tsx
git commit -m "feat(org-drive-copy): sidebar org header and admin entries (props-only)"
```

---

### Task 3: Dashboard `orgMode` + App route switch

**Files:**
- Modify: `web/frontend/src/components/dashboard/Dashboard.tsx` (signature `:113`, Sidebar call `:1266-1284`, main area after TopBar)
- Modify: `web/frontend/src/App.tsx:314-331` (org-dashboard route)
- Test: `web/frontend/src/components/dashboard/Dashboard.org.test.tsx`

**Interfaces:**
- Consumes: Task 1 panels, Task 2 Sidebar props, `orgMode` from Shared interfaces.
- Produces: org-dashboard route rendering the real drive UI (Task 4 hardens edge features; Task 5 removes the old component).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const mod: any = await importOriginal();
  return { ...mod, useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: vi.fn(), prefetchQuery: vi.fn(), setQueryData: vi.fn() }) };
});

import { Dashboard } from './Dashboard';

describe('Dashboard org mode', () => {
  it('shows org header and admin entries for admins', () => {
    render(<Dashboard onLogout={vi.fn()} orgMode={{ org: { id: 'o1', name: 'Acme', subdomain: 'acme' }, session: { username: 'alice', role: 'admin', member_id: 'm1' } }} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('hides admin entries for viewers', () => {
    render(<Dashboard onLogout={vi.fn()} orgMode={{ org: { id: 'o1', name: 'Acme', subdomain: 'acme' }, session: { username: 'bob', role: 'viewer', member_id: 'm2' } }} />);
    expect(screen.queryByText('Members')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/Dashboard.org.test.tsx` from `web/frontend`
Expected: FAIL — `orgMode` prop does not exist.

- [ ] **Step 3: Add `orgMode` prop and wire the Sidebar**

Change signature `:113` to:

```tsx
export function Dashboard({ onLogout, onSwitchOrganization, topBanner, orgMode }: {
    onLogout: () => void; onSwitchOrganization?: () => void; topBanner?: React.ReactNode;
    orgMode?: { org: { id: string; name: string; subdomain: string }; session: { username: string; role: string; member_id: string } | null };
}) {
```

Near the top of the component add:

```tsx
const showAdmin = !orgMode || !orgMode.session || ['admin', 'owner'].includes(orgMode.session.role);
const [orgAdminView, setOrgAdminView] = useState<null | 'members' | 'activity' | 'settings'>(null);
```

In the `<Sidebar>` call (`:1266-1284`) add:

```tsx
orgHeader={orgMode ? { name: orgMode.org.name, detail: `${orgMode.org.subdomain} · ${orgMode.session ? `${orgMode.session.username} (${orgMode.session.role})` : 'master admin'}` } : undefined}
adminViews={orgMode && showAdmin ? [{ id: 'members', label: 'Members' }, { id: 'activity', label: 'Activity' }, { id: 'settings', label: 'Settings' }] : undefined}
activeAdminView={orgAdminView}
onSelectAdminView={(id) => setOrgAdminView(id)}
setActiveFolderId={(id) => { setOrgAdminView(null); setActiveFolderId(id); }}
```

Wrapping `setActiveFolderId` guarantees picking any file view (Saved Messages, Starred, Recent, Trash, folder tree) clears the admin panel back to the drive.

- [ ] **Step 4: Render panels in place of the file area + switch the App route**

Replace the `{isTrash ? (` opener at line 1374 with:

```tsx
{(orgMode && orgAdminView) ? (
    <div className="flex-1 p-4 overflow-auto">
        {orgAdminView === 'members' && <OrgMembersPanel orgId={orgMode.org.id} role={orgMode.session?.role || 'owner'} sessionMemberId={orgMode.session?.member_id || null} folders={folders} />}
        {orgAdminView === 'activity' && <OrgActivityPanel orgId={orgMode.org.id} />}
        {orgAdminView === 'settings' && <OrgSettingsPanel orgId={orgMode.org.id} role={orgMode.session?.role || 'owner'} />}
    </div>
) : isTrash ? (
```

The existing trash block (`:1374-1395`) and explorer block (`:1396-1426`) become the `:` branches untouched — master output identical.

Add imports: `import { OrgMembersPanel } from '../org/OrgMembersPanel';` etc. at the top of `Dashboard.tsx`.

In `App.tsx`, replace the `org-dashboard` branch (`:314-331`) body component with:

```tsx
<Dashboard
  onLogout={() => {
    api.setOrgToken(null, boot.org.id);
    api.setOrgContext(null);
    if (boot.session) {
      window.location.href = `/${boot.org.subdomain}`;
    } else {
      api.logout().catch(() => {});
      setShowLanding(true);
      setBoot({ kind: "master-auth" });
    }
  }}
  onSwitchOrganization={boot.session ? undefined : () => { api.setOrgContext(null); setBoot({ kind: "org-picker" }); }}
  orgMode={{ org: boot.org, session: boot.session }}
/>
```

Keep the surrounding `{boot.kind === "org-dashboard" && (...)}` and remove the `OrgAdminDashboard` import once no longer referenced.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/dashboard/Dashboard.org.test.tsx` then `npx tsc --noEmit` from `web/frontend`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add web/frontend/src/components/dashboard/Dashboard.tsx web/frontend/src/App.tsx web/frontend/src/components/dashboard/Dashboard.org.test.tsx
git commit -m "feat(org-drive-copy): dashboard orgMode wiring and route switch"
```

---

### Task 4: Toast guards for features with no org backend

**Files:**
- Modify: `web/frontend/src/components/dashboard/Dashboard.tsx` (handlers found by audit)
- Test: extend `web/frontend/src/components/dashboard/Dashboard.org.test.tsx`

**Interfaces:**
- Consumes: `requireNoOrgContext` throwers in `api.ts`, sonner `toast`.
- Produces: every unavailable-in-org action shows a toast instead of crashing.

- [ ] **Step 1: Audit — list every `requireNoOrgContext` caller reachable from Dashboard**

Run: `Select-String -Path web/frontend/src/api.ts -Pattern 'requireNoOrgContext'` and note each guarded export name. Then run: `Select-String -Path web/frontend/src/components/dashboard/Dashboard.tsx -Pattern 'api\.<guardedName>'` for each. Write the resulting list (handler → guarded call) as a code comment block at the top of the new test file section — the list itself is the audit deliverable, e.g. share (`createShare`), tags (`getTags`/`setTags`), versions, bandwidth (`getBandwidth`), insights/duplicates, `getUserInfo`.

- [ ] **Step 2: Add failing tests for toast-on-unavailable**

For each audited handler reachable via UI in org mode, add a test that clicks/renders the entry point with `orgMode` set and expects `toast.error` (mock `sonner`) with `/not available in organization/i`. Example for share (if `createShare` is guarded):

```tsx
import { toast } from 'sonner';
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

it('toasts instead of crashing when share has no org backend', async () => {
  // render file row + trigger share via the same handler path Dashboard uses,
  // then: expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/not available in organization/i));
});
```

Where a feature's entry point makes no sense in orgs (e.g. bandwidth widget with no org data), hide the entry instead and assert absence (`queryBy...` null) rather than a toast.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/dashboard/Dashboard.org.test.tsx` from `web/frontend`
Expected: FAIL on each new case (unhandled throw or missing hide).

- [ ] **Step 4: Implement minimal guards**

Wrap each audited call site in `try/catch` showing `toast.error(err.message)` where not already covered, or conditionally skip rendering the entry when `orgMode` is set and the audit shows no org path. Do not change master behavior: every guard must be `if (orgMode ...)` scoped or rely on the api throw + existing catch.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/dashboard/Dashboard.org.test.tsx` then full `npm test` from `web/frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/frontend/src/components/dashboard/Dashboard.tsx web/frontend/src/components/dashboard/Dashboard.org.test.tsx
git commit -m "feat(org-drive-copy): toast guards for unavailable-in-org features"
```

---

### Task 5: Delete OrgAdminDashboard + final verification

**Files:**
- Delete: `web/frontend/src/components/org/OrgAdminDashboard.tsx`
- Modify: `web/frontend/src/components/org/OrgAdminDashboard.test.tsx` (migrate remaining scenarios or delete if fully covered by `OrgPanels.test.tsx` + `Dashboard.org.test.tsx`)

**Interfaces:**
- Consumes: all prior tasks (nothing may import `OrgAdminDashboard` anymore).
- Produces: clean tree, green gates, pushed branch ready for whole-branch review.

- [ ] **Step 1: Confirm zero references then delete**

Run: `Select-String -Recurse -Path web/frontend/src -Pattern 'OrgAdminDashboard'` — expected: only the test file and this task. Migrate any scenario not yet covered (role-tab gating is now covered by `Dashboard.org.test.tsx` role cases; panel scenarios by `OrgPanels.test.tsx`). Then delete both files:

```bash
git rm web/frontend/src/components/org/OrgAdminDashboard.tsx web/frontend/src/components/org/OrgAdminDashboard.test.tsx
```

- [ ] **Step 2: Full gates**

Run from `web/frontend`: `npx tsc --noEmit` (clean) and `npm test` (all pass). Run from `web/backend`: `cargo test` (all pass, backend untouched). Run residue scan: `Select-String -Recurse -Path web/frontend/src/components/org -Pattern 'zinc-200|Poppins|blue-900|cs-btn|amber-'` (no matches).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/org-drive-copy
```

Expected: branch pushed, `main` untouched. Then run `graphify update .` from repo root. Report: test counts, gates, push SHA — do NOT merge; whole-branch review + human visual pass come first.
