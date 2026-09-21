# Org UI convergence onto Master Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `OrgPicker`, `OrgLogin`, and `OrgAdminDashboard` look exactly like `MasterAdminDashboard` via a shared `components/org/ui.tsx` shell library.

**Architecture:** Extract master-admin markup into 8 presentational components in one new file, prove them by refactoring `MasterAdminDashboard` with zero visual change, then converge the three org screens onto them. No backend changes, no logic changes, identical role gating.

**Tech Stack:** React + TypeScript, Tailwind telegram-theme tokens, vitest + @testing-library/react (jsdom), lucide-react icons.

## Global Constraints

- No backend changes of any kind (`web/backend/` untouched).
- Role gating (`canEdit`/`canAdmin`, tab visibility in `OrgAdminDashboard.tsx:538-548`) behaviorally identical.
- `MasterPasswordSetup.tsx` untouched.
- `components/three/` directory intact; only `OrgLogin.tsx`'s imports of it are removed.
- User-facing copy stays identical unless the spec says otherwise ('Choose a workspace', 'Master Admin', 'Personal drive', 'Submit', 'Switch organization', 'Upload Files', `friendlyOrgLoginError` strings).
- Styling uses telegram tokens only (`bg-telegram-surface`, `border-telegram-border`, `text-telegram-subtext`, `bg-telegram-primary`, `hover:bg-telegram-hover`); no `bg-zinc-200`, no Poppins, no navy/amber, no `cs-btn-*`.
- Every task ends with `graphify update .` only on the final task; intermediate tasks just commit.

---

## File structure

- Create `web/frontend/src/components/org/ui.tsx` — 8 presentational components, zero API imports, zero state. Single responsibility: the master-admin visual language.
- Create `web/frontend/src/components/org/ui.test.tsx` — render tests for all 8.
- Modify `web/frontend/src/components/org/MasterAdminDashboard.tsx` — consume `ui.tsx`, zero visual change (proves components).
- Modify `web/frontend/src/components/org/OrgPicker.tsx` (195 lines) — full render rewrite on `ui.tsx`, logic untouched.
- Modify `web/frontend/src/components/org/OrgLogin.tsx` (118 lines) — drop 3D imports, render on `ui.tsx`, logic untouched.
- Create `web/frontend/src/components/org/OrgLogin.test.tsx` — render + error-path tests.
- Modify `web/frontend/src/components/org/OrgAdminDashboard.tsx` (957 lines, header/tabs at 538-591, sections at 592-957) — shell + sections on `ui.tsx`, logic untouched.
- Existing tests (`OrgPicker.test.tsx`, `OrgAdminDashboard.test.tsx`) are NOT modified; they are the regression gate.

---

### Task 1: Shared `org/ui.tsx` + render tests

**Files:**
- Create: `web/frontend/src/components/org/ui.tsx`
- Create: `web/frontend/src/components/org/ui.test.tsx`

**Interfaces:**
- Consumes: nothing (presentational only; `react` types only).
- Produces (exact exports later tasks import): `OrgShell`, `PageHeader`, `Banner`, `OrgCard`, `OrgModal`, `AuthCard`, `EmptyState`, `TabBar` with the prop types defined in Step 3.

- [ ] **Step 1: Write the failing test file** `web/frontend/src/components/org/ui.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Building2 } from 'lucide-react';
import { OrgShell, PageHeader, Banner, OrgCard, OrgModal, AuthCard, EmptyState, TabBar } from './ui';

describe('org ui shell', () => {
  it('OrgShell renders children in a centered column', () => {
    render(<OrgShell><span>hello-shell</span></OrgShell>);
    expect(screen.getByText('hello-shell')).toBeTruthy();
  });

  it('PageHeader back button calls onBack', () => {
    const onBack = vi.fn();
    render(<PageHeader icon={<Building2 />} title="T" onBack={onBack} />);
    fireEvent.click(screen.getByTitle('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('Banner warning renders children', () => {
    render(<Banner variant="warning">watch out</Banner>);
    expect(screen.getByText('watch out')).toBeTruthy();
  });

  it('TabBar calls onChange with the tab id', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={[{ id: 'files', label: 'Files', icon: Building2 }]} active="files" onChange={onChange} />);
    fireEvent.click(screen.getByText('Files'));
    expect(onChange).toHaveBeenCalledWith('files');
  });

  it('AuthCard submits', () => {
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(<AuthCard title="Unlock" submitLabel="Submit" busy={false} error={null} onSubmit={onSubmit}><input aria-label="pw" /></AuthCard>);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx vitest run src/components/org/ui.test.tsx`
Expected: FAIL with "Failed to resolve import './ui'" (file does not exist).
Workdir: `web/frontend`.

- [ ] **Step 3: Write minimal `ui.tsx`** with exactly these exports (copy verbatim):

```tsx
import type { ComponentType, FormEvent, ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';

export function OrgShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  );
}

export function PageHeader({ icon, title, subtitle, actions, onBack }: {
  icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode; onBack?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {onBack && (
        <button onClick={onBack} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      {icon}
      <div className="flex-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-telegram-subtext">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Banner({ variant, children }: { variant: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const cls = variant === 'error'
    ? 'mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-sm text-red-500'
    : variant === 'warning'
      ? 'mb-4 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/40 text-sm text-yellow-600'
      : 'mb-4 p-3 rounded-xl bg-telegram-surface border border-telegram-border text-sm text-telegram-subtext';
  return <div className={cls}>{children}</div>;
}

export function OrgCard({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  return <div className={`p-4 bg-telegram-surface border border-telegram-border rounded-xl ${dimmed ? 'opacity-60' : ''}`}>{children}</div>;
}

export function OrgModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm bg-telegram-surface border border-telegram-border rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-telegram-hover" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthCard({ title, submitLabel, busy, error, onSubmit, children, footer }: {
  title: string; submitLabel: string; busy: boolean; error: string | null;
  onSubmit: (e: FormEvent) => void; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit}>
      <h2 className="font-bold mb-4">{title}</h2>
      {children}
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full px-4 py-2 rounded-lg bg-telegram-primary text-white font-medium disabled:opacity-50">
        {busy ? 'Working…' : submitLabel}
      </button>
      {footer}
    </form>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-telegram-subtext">{children}</p>;
}

export function TabBar<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string; icon: ComponentType<{ className?: string }> }[];
  active: T; onChange: (id: T) => void;
}) {
  return (
    <nav className="flex gap-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${active === t.id ? 'bg-telegram-primary text-white' : 'hover:bg-telegram-hover'}`}>
          <t.icon className="w-3.5 h-3.5" /> {t.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/org/ui.test.tsx` — Expected: 5 passed.
Run: `npx tsc --noEmit` — Expected: clean.
Workdir: `web/frontend`.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/components/org/ui.tsx web/frontend/src/components/org/ui.test.tsx
git commit -m "feat(org-ui): shared master-admin shell components plus render tests"
```

---

### Task 2: `MasterAdminDashboard` consumes `ui.tsx`, zero visual change

**Files:**
- Modify: `web/frontend/src/components/org/MasterAdminDashboard.tsx:1-10` (imports), `:239-292` (shell/header/banners), `:318-320` (org card wrapper)
- Test: existing suite (`OrgAdminDashboard.test.tsx`, `OrgPicker.test.tsx` untouched) + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `OrgShell, PageHeader, Banner, OrgCard` from `./ui` (Task 1).
- Produces: byte-identical rendered output (same text, same classNames from `ui.tsx` which were copied from this file).

- [ ] **Step 1: Swap imports** — replace lines 1-6 imports, add:

```tsx
import { OrgShell, PageHeader, Banner, OrgCard } from './ui';
```

Keep all other imports (`api`, icons used in buttons, `runParallelPool`, types).

- [ ] **Step 2: Replace shell + header + banners** — replace the block at lines 239-292:
  - `<div className="h-full w-full overflow-y-auto p-6"><div className="max-w-5xl mx-auto">` → `<OrgShell>…</OrgShell>`.
  - Header div (lines 242-258) → `<PageHeader icon={<Building2 className="w-6 h-6 text-telegram-primary" />} title="Organizations" subtitle="Master admin — create orgs, provision Telegram channels, manage admins." onBack={onBack} actions={…} />` where `actions` is exactly:

```tsx
<button
  onClick={() => (showAlerts ? setShowAlerts(false) : loadAlertsOverview())}
  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover"
  title="Recent activity across all organizations"
>
  <Bell className="w-3.5 h-3.5" /> {showAlerts ? 'Hide alerts' : 'Alerts overview'}
</button>
```

(`Bell` stays imported; `ArrowLeft` import is removed since `PageHeader` owns the back button.)
  - `backendStale` div → `<Banner variant="error">` with identical children.
  - `overviewPartial` div → `<Banner variant="warning">` with identical children.

- [ ] **Step 3: Replace org card wrapper** — at line 320, `<div key={org.id} className={…}>` → `<OrgCard key={org.id} dimmed={org.active === false}>`, keeping the inner content verbatim. Fix the closing tag accordingly.

- [ ] **Step 4: Verify zero-change** — Run: `npx tsc --noEmit` (clean) and `npx vitest run src/components/org` (all pass, no test file modified). Visually confirm via `git diff` that only wrapper tags changed (class strings moved into `ui.tsx`, no text changes).

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/components/org/MasterAdminDashboard.tsx
git commit -m "refactor(org-ui): master admin dashboard on shared shell components"
```

---

### Task 3: Converge `OrgPicker`

**Files:**
- Modify: `web/frontend/src/components/org/OrgPicker.tsx` (full render, logic lines 16-100 untouched)
- Modify: `web/frontend/src/components/org/ui.tsx` (AuthCard: render `<h2>` only when `title` non-empty)
- Test: `OrgPicker.test.tsx` UNMODIFIED — asserts 'Choose a workspace', 'Master Admin', 'Personal drive', 'Acme', 'Idle', Submit button, 'Wrong password'.

**Interfaces:**
- Consumes: `OrgShell, PageHeader, OrgCard, OrgModal, AuthCard, EmptyState` from `./ui`.
- Produces: same props/callbacks (`onUnlockMaster`, `onUnlockOrg`, `onTelegramLost`), same state machine.

- [ ] **Step 1: Rewrite the render only** — keep lines 1-100 logic verbatim except imports (drop nothing; add `import { OrgShell, PageHeader, OrgCard, OrgModal, AuthCard, EmptyState } from './ui';` and `Building2, HardDrive` stay). Replace the return block (lines 102-194) with:

```tsx
return (
  <OrgShell>
    <PageHeader icon={<Building2 className="w-6 h-6 text-telegram-primary" />} title="Choose a workspace" subtitle="Unlock Master Admin or an organization you created." />
    {loading ? (
      <EmptyState>Loading organizations…</EmptyState>
    ) : (
      <div className="grid gap-3">
        <OrgCard>
          <button type="button" onClick={openMaster} className="w-full text-left flex items-center gap-3">
            <span className="p-2 rounded-xl bg-telegram-primary text-white"><HardDrive className="w-5 h-5" /></span>
            <div><div className="font-semibold">Master Admin</div><div className="text-xs text-telegram-subtext">Personal drive</div></div>
          </button>
        </OrgCard>
        {orgs.length === 0 && <EmptyState>No organizations yet. Create one from Master Admin → Organizations.</EmptyState>}
        {orgs.map((org) => {
          const inactive = org.active === false;
          return (
            <OrgCard key={org.id} dimmed={inactive}>
              <button type="button" disabled={inactive} onClick={() => openOrg(org)} className="w-full text-left flex items-center gap-3 disabled:cursor-not-allowed">
                <span className="p-2 rounded-xl bg-telegram-primary text-white"><Building2 className="w-5 h-5" /></span>
                <div>
                  <div className="font-semibold flex items-center gap-2">{org.name}
                    {inactive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-500">inactive</span>}
                  </div>
                  <div className="text-xs text-telegram-subtext">{org.subdomain}</div>
                </div>
              </button>
            </OrgCard>
          );
        })}
      </div>
    )}
    {modal && (
      <OrgModal title={modal.kind === 'master' ? 'Master Admin password' : `Unlock ${modal.org.name}`} onClose={closeModal}>
        {orgNeedsPassword ? (
          <EmptyState>Set an entry password in Organizations first</EmptyState>
        ) : (
          <AuthCard title="" submitLabel="Submit" busy={busy} error={error} onSubmit={submit}>
            <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" />
          </AuthCard>
        )}
      </OrgModal>
    )}
  </OrgShell>
);
```

Note: `AuthCard` renders its own `<h2>` title — pass the password label block as children and set `title` to the modal title instead of `""`: use `<AuthCard title={modal.kind === 'master' ? 'Master Admin password' : `Unlock ${modal.org.name}`} …>` and give `OrgModal` a fixed `title=""`… simpler: keep `OrgModal title="Unlock"` out — final choice (no ambiguity): `OrgModal` receives `title=""` and renders nothing when empty? It always renders `<h2>`. Decision: pass modal title to `OrgModal`, pass `title=""` to `AuthCard`, and `AuthCard` skips the `<h2>` when title is empty (`{title && <h2 …>}`). Update `ui.tsx` AuthCard line to `{title ? <h2 className="font-bold mb-4">{title}</h2> : null}` in this task (test in Task 1 still passes: it passes a non-empty title).

- [ ] **Step 2: Run picker tests unmodified**

Run: `npx vitest run src/components/org/OrgPicker.test.tsx` — Expected: 5 passed.
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/components/org/OrgPicker.tsx web/frontend/src/components/org/ui.tsx
git commit -m "feat(org-ui): picker converged onto master-admin shell"
```

---

### Task 4: Converge `OrgLogin` (+ new test)

**Files:**
- Modify: `web/frontend/src/components/org/OrgLogin.tsx:1-7` (drop `lazy, Suspense`, `TiltCard`, `Scene3D` imports) and `:58-117` (render)
- Create: `web/frontend/src/components/org/OrgLogin.test.tsx`
- Test: new test + `friendlyOrgLoginError` behavior preserved via mocked `api.orgLogin` rejection.

**Interfaces:**
- Consumes: `OrgShell, OrgCard, AuthCard, Banner, EmptyState` from `./ui`.
- Produces: same props (`orgId, orgName, inactive, onLogin`), same session calls (`api.setOrgToken`, `api.setOrgId`).

- [ ] **Step 1: Write failing test** `web/frontend/src/components/org/OrgLogin.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrgLogin } from './OrgLogin';

const orgLogin = vi.fn<(id: string, u: string, p: string) => Promise<{ org_id: string; token: string; username: string; role: string; member_id: string }>>();

vi.mock('../../api', () => ({
  orgLogin: (id: string, u: string, p: string) => orgLogin(id, u, p),
  setOrgToken: vi.fn(),
  setOrgId: vi.fn(),
}));

describe('OrgLogin', () => {
  it('renders org name and sign-in form', () => {
    render(<OrgLogin orgId="o1" orgName="Acme" onLogin={() => {}} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('shows friendly error on bad credentials', async () => {
    orgLogin.mockRejectedValue(new Error('Invalid username or password'));
    render(<OrgLogin orgId="o1" orgName="Acme" onLogin={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. alice'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/wrong username or password/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run src/components/org/OrgLogin.test.tsx` FAILs (no test target change yet? It fails because render output lacks placeholders — actually it fails only after rewrite; run now to confirm current code passes test 1 but test 2 error text differs? Current code shows raw `friendlyOrgLoginError` text already, so both may pass pre-change. The gate that matters: after rewrite both still pass. Run now to record baseline: Expected currently PASS/PASS.)

- [ ] **Step 3: Rewrite render** — delete lines 1-7 three.js imports (`lazy, Suspense`, `TiltCard`, `Scene3D` const). Replace return (lines 58-117) with:

```tsx
return (
  <OrgShell>
    <div className="flex justify-center pt-8">
      <div className="w-full max-w-sm">
        <OrgCard>
          <AuthCard title={orgName} submitLabel="Sign in" busy={busy || !!inactive} error={error} onSubmit={submit}
            footer={<>
              <button type="button" onClick={() => { window.location.href = '/'; }}
                className="w-full mt-3 text-xs text-telegram-primary hover:underline">← Back to master dashboard</button>
              <p className="text-xs text-telegram-subtext mt-3 text-center">Organization accounts are created by your org admin. No Telegram login needed. Signing in here ends any other session for this account.</p>
            </>}>
            {inactive && <Banner variant="warning">This organization is deactivated. Contact your admin to reactivate it.</Banner>}
            <p className="text-sm text-telegram-subtext mb-5">Sign in with your organization account.</p>
            <label className="block text-xs font-medium text-telegram-subtext mb-1">Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
              className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" placeholder="e.g. alice" />
            <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              className="w-full mb-4 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" placeholder="••••••••" />
          </AuthCard>
        </OrgCard>
      </div>
    </div>
  </OrgShell>
);
```

Keep `submit`, `friendlyOrgLoginError`, and all logic verbatim. Note `AuthCard`'s submit button gets `disabled={busy}` — pass `busy={busy || inactive}` so deactivated orgs can't submit (matches old `disabled={busy || inactive}`).

- [ ] **Step 4: Run tests** — `npx vitest run src/components/org/OrgLogin.test.tsx` (2 passed), `npx tsc --noEmit` (clean). Confirm no `three` import remains in file: search `three` in `OrgLogin.tsx` → zero matches.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/components/org/OrgLogin.tsx web/frontend/src/components/org/OrgLogin.test.tsx
git commit -m "feat(org-ui): login converged onto master-admin shell, 3D backdrop removed"
```

---

### Task 5: `OrgAdminDashboard` shell, tabs, admin sections

**Files:**
- Modify: `web/frontend/src/components/org/OrgAdminDashboard.tsx:1-6` (imports), `:550-591` (shell/header/tabs), `:594-598` (provisioned banner), `:772-879` (members), `:880-906` (activity), `:907-957` (settings)
- Test: `OrgAdminDashboard.test.tsx` UNMODIFIED (tab labels, 'Switch organization', role gating).

**Interfaces:**
- Consumes: `OrgShell, PageHeader, Banner, OrgCard, TabBar` from `./ui`.
- Produces: identical tab logic (`tabs` array lines 538-548 passed straight into `TabBar` — same `{id,label,icon}` shape; `icon: any` satisfies `ComponentType<{className?: string}>`).

- [ ] **Step 1: Header + tabs** — replace lines 550-591 with:

```tsx
return (
  <OrgShell>
    <PageHeader
      icon={<Files className="w-6 h-6 text-telegram-primary" />}
      title={org.name}
      subtitle={`${org.subdomain} · ${session ? `${session.username} (${session.role})` : 'master admin (acting as owner)'}`}
      onBack={!onSwitchOrganization && onBack ? onBack : undefined}
      actions={<>
        {onSwitchOrganization && (
          <button onClick={onSwitchOrganization} className="text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Switch organization">Switch organization</button>
        )}
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
        <button onClick={logout} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Sign out"><LogOut className="w-4 h-4" /></button>
        {!session && !onSwitchOrganization && (
          <button onClick={() => { window.location.href = '/'; }} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Master dashboard"><FolderOpen className="w-4 h-4" /></button>
        )}
      </>}
    />
```

Note: old header put `TabBar` inside a sticky top bar; new layout stacks header then content. The `tabs` const (538-548) stays exactly as-is. `setTab` passes directly as `onChange` (types: `(id: Tab) => void` matches).

- [ ] **Step 2: Provisioned banner** — replace lines 594-598 `<p className="text-sm text-yellow-600 …">` with `<Banner variant="warning">Organization not provisioned yet — ask the master admin to provision Telegram channels before files appear.</Banner>`.

- [ ] **Step 3: Members/activity/settings cards** — wrap each section's inner content: members block (772-879) inner forms/lists stay verbatim, outer container becomes `<OrgCard>`; activity list (880-906) → `<OrgCard>`; settings (907-957) → `<OrgCard>`. Do not touch handlers (`createMember`, `deleteMember`, settings save).

- [ ] **Step 4: Run dashboard tests unmodified**

Run: `npx vitest run src/components/org/OrgAdminDashboard.test.tsx` — Expected: all pass (tab labels 'Files'/'Trash'/'Activity'/'Members'/'Settings', 'Switch organization', role gating).
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/components/org/OrgAdminDashboard.tsx
git commit -m "feat(org-ui): dashboard shell, tabs, and admin sections on shared components"
```

---

### Task 6: Files + trash sections into the centered column

**Files:**
- Modify: `web/frontend/src/components/org/OrgAdminDashboard.tsx:590-591` (drop inner `<div className="flex-1 overflow-y-auto p-4"><div className="max-w-4xl mx-auto">`), `:592-737` (files), `:738-771` (trash)
- Test: `OrgAdminDashboard.test.tsx` upload-actions test ('Upload Files' visible to editors, hidden from viewers).

**Interfaces:**
- Consumes: `OrgCard, EmptyState` from `./ui`; all handlers (`createFolder`, `handleFileSelect`, `runUploads`, `purgeItem`, `restoreItem`) unchanged.
- Produces: same DOM text for file rows, same upload flow.

- [ ] **Step 1: Remove the inner width constraint** — delete the `<div className="flex-1 overflow-y-auto p-4"><div className="max-w-4xl mx-auto">` wrapper (lines 590-591) and its closers; `OrgShell` now owns scroll + `max-w-5xl`.

- [ ] **Step 2: Card the sections** — wrap the files tab content (592-737: provision prompt, create-folder form, upload buttons, file list) in `<OrgCard>`, and the trash tab content (738-771) in `<OrgCard>`. File-row markup, `OrgImageThumb`, bulk-action buttons, and empty states (convert `<p className="text-sm text-telegram-subtext">` empties to `<EmptyState>` only where the string is verbatim identical) stay otherwise untouched.

- [ ] **Step 3: Run tests** — `npx vitest run src/components/org/OrgAdminDashboard.test.tsx` (all pass), `npx tsc --noEmit` (clean).

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/components/org/OrgAdminDashboard.tsx
git commit -m "feat(org-ui): files and trash tabs inside centered card column"
```

---

### Task 7: Final verification, cleanup scan, push

**Files:**
- Modify: none (verification only).

- [ ] **Step 1: Residue scan** — search `web/frontend/src/components/org` for `bg-zinc-200`, `Poppins`, `cs-btn-`, `bg-blue-900`, `three/`, `Scene3D`, `TiltCard`. Expected: zero matches. (`components/three/` directory itself must still exist for `AuthWizard`/`Landing`.)

- [ ] **Step 2: Full frontend gate** — Run `npx tsc --noEmit` (clean) then `npm test` (all files pass, including `ui.test.tsx`, `OrgLogin.test.tsx`, unmodified picker/dashboard/setup tests). Workdir: `web/frontend`.

- [ ] **Step 3: Backend safety run** — Run `cargo test` (all pass; no backend files changed). Workdir: `web/backend`.

- [ ] **Step 4: Manual acceptance checklist** (eyeball in browser, light + dark): picker renders centered column; login has no 3D backdrop; dashboard header/tabs/cards match master admin for owner, admin, editor, viewer (viewer sees no Members/Settings); file upload + thumbnail flow works in the centered column.

- [ ] **Step 5: Graph update, commit state, push**

```bash
graphify update .
git log --oneline -8
git push origin main
```

Expected: working tree clean, `main` pushed. (No code changes in this task, so no commit unless the scan in Step 1 found residue — if it did, fix it first and amend the relevant task's commit, then re-run Step 2.)
