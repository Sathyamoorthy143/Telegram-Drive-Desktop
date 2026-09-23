# Common Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the org picker with one shared Sign-In form (reserved word `master` for master admin, name/subdomain resolve for orgs) plus a public resolve endpoint and unlock throttling.

**Architecture:** New pure-Rust `unlock_throttle` module (unit-testable, no actix) wired into the two existing unlock handlers; new public `GET /api/orgs/resolve` handler in `orgs.rs`; new `SignIn.tsx` reusing `OrgShell`/`OrgCard`/`AuthCard` in the exact `org-picker` boot slot; `OrgPicker` deleted.

**Tech Stack:** React 19 + vitest + Testing Library (frontend); actix-web + tokio::sync::Mutex (backend).

## Global Constraints

- Single generic failure string — "Invalid name or password" — for unknown name, wrong password, throttled states alike (429 adds only "try again shortly").
- No org list, no which-half-failed signal, anywhere.
- Reserved word is trimmed, case-insensitive `master`.
- Resolve matches display name OR subdomain, trimmed, case-insensitive.
- Telegram must stay connected: both unlock handlers require `current_telegram_user_id`, so SignIn keeps the post-connect `org-picker` boot slot (it does NOT move before Telegram connect).
- After every task: `npx tsc --noEmit` (frontend) or `cargo test` (backend) as applicable, plus `graphify update .` from the repo root after code changes.

---

### Task 1: Unlock-attempt tracker module (backend)

**Files:**
- Create: `web/backend/src/unlock_throttle.rs`
- Modify: `web/backend/src/main.rs` (register `mod unlock_throttle;` next to `mod entry_unlock;` at line 33)

**Interfaces:**
- Consumes: nothing.
- Produces: `unlock_throttle::AttemptTracker` with `check(&mut self, key: &str) -> Result<(), u64>` (Err carries retry-after seconds) and `record(&mut self, key: &str, success: bool)`; constants `MAX_ATTEMPTS: u32 = 5`, `WINDOW_SECS: u64 = 300`, `LOCKOUT_SECS: u64 = 300`. Task 2 calls these.

- [ ] **Step 1: Write the failing test**

Append to `web/backend/src/unlock_throttle.rs` (new file, module + tests together — file does not exist yet, so this step creates it):

```rust
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const MAX_ATTEMPTS: u32 = 5;
pub const WINDOW_SECS: u64 = 300;
pub const LOCKOUT_SECS: u64 = 300;

#[derive(Default)]
pub struct AttemptTracker {
    attempts: HashMap<String, Vec<Instant>>,
}

impl AttemptTracker {
    /// Returns Ok when another attempt is allowed, Err(retry_after_secs) when locked out.
    pub fn check(&mut self, key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let window = Duration::from_secs(WINDOW_SECS);
        let entries = self.attempts.entry(key.to_string()).or_default();
        entries.retain(|t| now.duration_since(*t) <= window);
        if entries.len() as u32 >= MAX_ATTEMPTS {
            let oldest = entries[0];
            let retry = LOCKOUT_SECS.saturating_sub(now.duration_since(oldest).as_secs());
            return Err(retry.max(1));
        }
        Ok(())
    }

    /// Records an attempt outcome; success clears the key's history.
    pub fn record(&mut self, key: &str, success: bool) {
        if success {
            self.attempts.remove(key);
        } else {
            self.attempts.entry(key.to_string()).or_default().push(Instant::now());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_fewer_than_max_attempts() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            assert!(t.check("k").is_ok());
            t.record("k", false);
        }
    }

    #[test]
    fn blocks_at_max_attempts_with_retry_hint() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            let _ = t.check("k");
            t.record("k", false);
        }
        let err = t.check("k").expect_err("must be locked out");
        assert!(err >= 1 && err <= LOCKOUT_SECS);
    }

    #[test]
    fn success_clears_history() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            let _ = t.check("k");
            t.record("k", false);
        }
        assert!(t.check("k").is_err());
        t.record("k", true);
        assert!(t.check("k").is_ok());
    }

    #[test]
    fn keys_are_independent() {
        let mut t = AttemptTracker::default();
        for _ in 0..MAX_ATTEMPTS {
            let _ = t.check("a");
            t.record("a", false);
        }
        assert!(t.check("a").is_err());
        assert!(t.check("b").is_ok());
    }
}
```

- [ ] **Step 2: Register the module and run tests to verify they pass**

In `web/backend/src/main.rs`, add `mod unlock_throttle;` next to `mod entry_unlock;` (line 33).

Run: `cargo test unlock_throttle` in `web/backend`
Expected: 4 PASS (`allows_fewer_than_max_attempts`, `blocks_at_max_attempts_with_retry_hint`, `success_clears_history`, `keys_are_independent`)

- [ ] **Step 3: Commit**

```bash
git add web/backend/src/unlock_throttle.rs web/backend/src/main.rs
git commit -m "feat: unlock attempt tracker with lockout"
```

---

### Task 2: Enforce throttling in both unlock handlers (backend)

**Files:**
- Modify: `web/backend/src/main.rs:45-64` (add `unlock_attempts` field to `AppState` + init at construction site alongside `download_slots`)
- Modify: `web/backend/src/admin.rs:113-128` (`master_unlock`: add `req: HttpRequest` param, check + record)
- Modify: `web/backend/src/orgs.rs:205-253` (`unlock_organization`: check + record with org-scoped key)

**Interfaces:**
- Consumes: `unlock_throttle::AttemptTracker` from Task 1.
- Produces: throttled unlock endpoints (429 + `Retry-After` header when locked); nothing later tasks consume except the behavior.

- [ ] **Step 1: Add the tracker to AppState**

In `web/backend/src/main.rs`, add the field after `download_slots`:

```rust
/// Failed entry-unlock attempts per "ip:account" key (see unlock_throttle).
pub unlock_attempts: Arc<Mutex<AttemptTracker>>,
```

Add the import (`use crate::unlock_throttle::AttemptTracker;`) and initialize at the `AppState { ... }` construction site:

```rust
unlock_attempts: Arc::new(Mutex::new(AttemptTracker::default())),
```

- [ ] **Step 2: Throttle master unlock**

In `web/backend/src/admin.rs`, change the `master_unlock` signature to take the request (needed for the peer IP):

```rust
pub async fn master_unlock(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<PasswordBody>,
) -> impl Responder {
```

Add `use actix_web::HttpRequest;` if not already imported (check the top of `admin.rs` first). Insert the throttle check as the first statement:

```rust
let ip = req.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
let key = format!("{}:master", ip);
{
    let mut tracker = state.unlock_attempts.lock().await;
    if let Err(retry) = tracker.check(&key) {
        return HttpResponse::TooManyRequests()
            .insert_header(("Retry-After", retry.to_string()))
            .body("Too many attempts — try again shortly");
    }
}
```

Record the outcome around the existing `match evaluate_master_unlock(...)`:

```rust
match evaluate_master_unlock(stored.as_deref(), &body.password, &uid.to_string()) {
    Ok(()) => {
        state.unlock_attempts.lock().await.record(&key, true);
        HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
    }
    Err(e) => {
        state.unlock_attempts.lock().await.record(&key, false);
        unlock_status_response(e)
    }
}
```

- [ ] **Step 3: Throttle org unlock**

In `web/backend/src/orgs.rs` `unlock_organization` (already has `req: HttpRequest`), insert after the org is loaded (after line 223, so the key can include the real org id):

```rust
let ip = req.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
let key = format!("{}:org:{}", ip, org.id);
{
    let mut tracker = state.unlock_attempts.lock().await;
    if let Err(retry) = tracker.check(&key) {
        return HttpResponse::TooManyRequests()
            .insert_header(("Retry-After", retry.to_string()))
            .body("Too many attempts — try again shortly");
    }
}
```

Record the outcome in the existing match arms:

```rust
Ok(()) => {
    state.unlock_attempts.lock().await.record(&key, true);
    let ip = req.peer_addr().map(|a| a.ip().to_string());
    // ... existing audit_best_effort + Ok response unchanged
}
Err(e) => {
    state.unlock_attempts.lock().await.record(&key, false);
    org_unlock_status_response(e)
}
```

- [ ] **Step 4: Run backend tests**

Run: `cargo test` in `web/backend`
Expected: all PASS (existing `entry_unlock` + `unlock_throttle` + slug tests; count grows by the 4 new tests)

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/main.rs web/backend/src/admin.rs web/backend/src/orgs.rs
git commit -m "feat: throttle master and org unlock attempts"
```

---

### Task 3: Public org resolve endpoint + frontend API fn

**Files:**
- Modify: `web/backend/src/orgs.rs` (append `resolve_org` handler + `ResolveQuery`)
- Modify: `web/backend/src/main.rs:231` (register `.route("/orgs/resolve", web::get().to(orgs::resolve_org))` next to the `/current-org` route)
- Modify: `web/frontend/src/api.ts:856` (add `resolveOrg` after `getMyOrgs`)

**Interfaces:**
- Consumes: `supabase_org::get_org_by_subdomain`, `supabase_org::list_organizations`, `Organization { id, name, ... }` (all exist).
- Produces: `GET /api/orgs/resolve?name=` → `{ org_id, display_name }` or 404; frontend `resolveOrg(name)` returning that shape. Task 4 calls `resolveOrg`.

- [ ] **Step 1: Add the resolve handler**

Append to `web/backend/src/orgs.rs` (after `current_org`, near line 82):

```rust
#[derive(serde::Deserialize)]
pub struct ResolveQuery {
    pub name: Option<String>,
}

/// `GET /api/orgs/resolve?name=` — public pre-login resolver used by the
/// shared Sign-In form. Matches subdomain exactly first, then display name
/// (case-insensitive). Returns only `{ org_id, display_name }`; unknown
/// names get a bare 404 so nothing is enumerable beyond existence.
pub async fn resolve_org(q: web::Query<ResolveQuery>) -> impl Responder {
    let needle = q.name.as_deref().unwrap_or("").trim().to_lowercase();
    if needle.is_empty() || needle == "master" || is_reserved_slug(&needle) {
        return HttpResponse::NotFound().body("Not found");
    }
    if !supabase_org::is_configured() {
        return supabase_unavailable();
    }
    if let Ok(Some(org)) = supabase_org::get_org_by_subdomain(&needle).await {
        return HttpResponse::Ok().json(serde_json::json!({
            "org_id": org.id, "display_name": org.name,
        }));
    }
    match supabase_org::list_organizations().await {
        Ok(orgs) => match orgs.into_iter().find(|o| o.name.trim().to_lowercase() == needle) {
            Some(org) => HttpResponse::Ok().json(serde_json::json!({
                "org_id": org.id, "display_name": org.name,
            })),
            None => HttpResponse::NotFound().body("Not found"),
        },
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
```

Register in `web/backend/src/main.rs` next to line 231:

```rust
.route("/orgs/resolve", web::get().to(orgs::resolve_org))
```

(Verify the surrounding scope is the `/api` scope by reading lines 220-235 before editing.)

- [ ] **Step 2: Add the frontend API function**

In `web/frontend/src/api.ts` after `getMyOrgs` (line 856-857):

```ts
export const resolveOrg = (name: string) =>
  api<{ org_id: string; display_name: string }>(
    'GET', `/api/orgs/resolve?name=${encodeURIComponent(name)}`);
```

- [ ] **Step 3: Run checks**

Run: `cargo test` in `web/backend` — Expected: all PASS (no behavior change to existing paths)
Run: `npx tsc --noEmit` in `web/frontend` — Expected: clean

- [ ] **Step 4: Commit**

```bash
git add web/backend/src/orgs.rs web/backend/src/main.rs web/frontend/src/api.ts
git commit -m "feat: public org resolve endpoint"
```

---

### Task 4: SignIn component + tests, delete OrgPicker

**Files:**
- Create: `web/frontend/src/components/org/SignIn.tsx`
- Create: `web/frontend/src/components/org/SignIn.test.tsx`
- Delete: `web/frontend/src/components/org/OrgPicker.tsx`
- Delete: `web/frontend/src/components/org/OrgPicker.test.tsx`
- Modify: `web/frontend/src/api.ts` (remove the now-unused `getMyOrgs` export, lines 856-857)

**Interfaces:**
- Consumes: `api.resolveOrg`, `api.unlockMaster`, `api.unlockOrganization` (same error shape `{ status, message }` the picker relied on); `OrgShell`, `OrgCard`, `AuthCard` from `./ui`.
- Produces: `SignIn({ onUnlockMaster, onUnlockOrg, onTelegramLost })` with the exact prop types the picker had:
  `onUnlockMaster: () => void`,
  `onUnlockOrg: (org: { id: string; name: string; subdomain: string }) => void`,
  `onTelegramLost?: () => void`. Task 5 renders it.

- [ ] **Step 1: Write the failing test**

Create `web/frontend/src/components/org/SignIn.test.tsx` (mirrors `OrgPicker.test.tsx` mocking style):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignIn } from './SignIn';

const resolveOrg = vi.fn<(name: string) => Promise<{ org_id: string; display_name: string }>>();
const unlockMaster = vi.fn<(password: string) => Promise<{ ok: boolean }>>();
const unlockOrganization = vi.fn<(id: string, password: string) => Promise<{ ok: boolean; org: { id: string; name: string; subdomain: string } }>>();

vi.mock('../../api', () => ({
  resolveOrg: (name: string) => resolveOrg(name),
  unlockMaster: (password: string) => unlockMaster(password),
  unlockOrganization: (id: string, password: string) => unlockOrganization(id, password),
}));

describe('SignIn', () => {
  beforeEach(() => {
    resolveOrg.mockReset();
    unlockMaster.mockReset();
    unlockOrganization.mockReset();
    resolveOrg.mockResolvedValue({ org_id: 'o1', display_name: 'Acme' });
    unlockMaster.mockResolvedValue({ ok: true });
    unlockOrganization.mockResolvedValue({ ok: true, org: { id: 'o1', name: 'Acme', subdomain: 'acme' } });
  });

  it('renders one name field, one password field, no org list', () => {
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    expect(screen.getByPlaceholderText(/organisation name/i)).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeTruthy();
    expect(screen.queryByText('Master Admin')).toBeNull();
  });

  it('routes the reserved word to master unlock', async () => {
    const onUnlockMaster = vi.fn();
    render(<SignIn onUnlockMaster={onUnlockMaster} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'master' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(unlockMaster).toHaveBeenCalledWith('secret'));
    expect(resolveOrg).not.toHaveBeenCalled();
    expect(onUnlockMaster).toHaveBeenCalled();
  });

  it('resolves an org name then unlocks it', async () => {
    const onUnlockOrg = vi.fn();
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={onUnlockOrg} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(resolveOrg).toHaveBeenCalledWith('Acme'));
    await waitFor(() => expect(unlockOrganization).toHaveBeenCalledWith('o1', 'secret'));
    expect(onUnlockOrg).toHaveBeenCalledWith({ id: 'o1', name: 'Acme', subdomain: 'acme' });
  });

  it('shows the generic error for unknown names and wrong passwords', async () => {
    resolveOrg.mockRejectedValue({ status: 404, message: 'Not found' });
    const { unmount } = render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'nope' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Invalid name or password.')).toBeTruthy());
    unmount();

    resolveOrg.mockResolvedValue({ org_id: 'o1', display_name: 'Acme' });
    unlockOrganization.mockRejectedValue({ status: 401, message: 'Wrong password' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'Acme' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('Invalid name or password.')).toBeTruthy());
  });

  it('shows the throttle message on 429', async () => {
    unlockMaster.mockRejectedValue({ status: 429, message: 'Too many attempts' });
    render(<SignIn onUnlockMaster={() => {}} onUnlockOrg={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/organisation name/i), { target: { value: 'MASTER' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/org/SignIn.test.tsx` in `web/frontend`
Expected: FAIL with "Failed to resolve import ./SignIn" (component does not exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `web/frontend/src/components/org/SignIn.tsx` (structure mirrors `OrgLogin.tsx`, single form instead of picker list + modal):

```tsx
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import * as api from '../../api';
import { OrgShell, PageHeader, OrgCard, AuthCard } from './ui';

interface Props {
  onUnlockMaster: () => void;
  onUnlockOrg: (org: { id: string; name: string; subdomain: string }) => void;
  onTelegramLost?: () => void;
}

const GENERIC_ERROR = 'Invalid name or password.';

function isTelegramLost(err: any): boolean {
  const status = err?.status;
  const msg = String(err?.message || '').toLowerCase();
  return status === 401 && (msg.includes('unauthorized') || msg.includes('authentication required') || msg.includes('telegram'));
}

export function SignIn({ onUnlockMaster, onUnlockOrg, onTelegramLost }: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim() || !password) {
      setError('Enter your organisation name and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ident = name.trim();
      if (ident.toLowerCase() === 'master') {
        await api.unlockMaster(password);
        onUnlockMaster();
        return;
      }
      let orgId: string;
      try {
        orgId = (await api.resolveOrg(ident)).org_id;
      } catch {
        setError(GENERIC_ERROR);
        return;
      }
      const res = await api.unlockOrganization(orgId, password);
      onUnlockOrg(res.org);
    } catch (err: any) {
      if (isTelegramLost(err)) {
        onTelegramLost?.();
        return;
      }
      if (err?.status === 429) {
        setError('Too many attempts — try again shortly.');
      } else {
        setError(GENERIC_ERROR);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgShell>
      <PageHeader icon={<KeyRound className="w-6 h-6 text-telegram-primary" />} title="Sign in" subtitle="Master Admin or your organization. Type master for the personal drive." />
      <div className="flex justify-center">
        <div className="w-full max-w-sm">
          <OrgCard>
            <AuthCard title="" submitLabel="Sign in" busy={busy} error={error} onSubmit={submit}>
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Organisation name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username"
                className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
                placeholder="Organisation name — or master" />
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                className="w-full mb-4 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
                placeholder="••••••••" />
            </AuthCard>
          </OrgCard>
        </div>
      </div>
    </OrgShell>
  );
}
```

(Before writing, verify `PageHeader` and `AuthCard` prop names against `web/frontend/src/components/org/ui.tsx` and `OrgPicker.tsx` lines 103-147 — the code above copies them verbatim. If `PageHeader` takes different props, match `ui.tsx`.)

- [ ] **Step 4: Delete the picker and its test, drop getMyOrgs**

```bash
git rm web/frontend/src/components/org/OrgPicker.tsx web/frontend/src/components/org/OrgPicker.test.tsx
```

Remove from `web/frontend/src/api.ts` (lines 856-857):

```ts
export const getMyOrgs = () =>
  api<{ orgs: MyOrg[] }>('GET', '/api/admin/my-orgs');
```

(Keep the `MyOrg` interface — other components may import the type. Verify with a grep for `MyOrg` before deleting anything else. The backend `list_my_organizations` endpoint stays: removing a public API route is out of scope.)

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/components/org/SignIn.test.tsx` in `web/frontend` — Expected: 5 PASS
Run: `npx tsc --noEmit` in `web/frontend` — Expected: clean (no remaining `OrgPicker`/`getMyOrgs` imports; grep to confirm zero hits first)

- [ ] **Step 6: Commit**

```bash
git add web/frontend/src/components/org/SignIn.tsx web/frontend/src/components/org/SignIn.test.tsx web/frontend/src/api.ts
git commit -m "feat: common sign-in replaces org picker"
```

(The `git rm` in Step 4 already stages the deletions; the `git add` here stages the rest.)

---

### Task 5: Boot renders SignIn, full verification

**Files:**
- Modify: `web/frontend/src/App.tsx` (import swap line 15; `BootState` kind `"org-picker"` → `"signin"` at line 67; `bootAfterTelegram` line 75; `MasterPasswordSetup` onReady line 250; picker render branch lines 252-262; `onSwitchOrganization` lines 266 and 337)

**Interfaces:**
- Consumes: `SignIn` props from Task 4 (identical to the picker's).
- Produces: working boot flow. No later tasks.

- [ ] **Step 1: Swap the import**

Line 15: `import { OrgPicker } from "./components/org/OrgPicker";` → `import { SignIn } from "./components/org/SignIn";`

- [ ] **Step 2: Rename the boot kind**

Replace every `"org-picker"` with `"signin"`: line 67 (`BootState`), line 75 (`bootAfterTelegram` return), line 250 (`MasterPasswordSetup onReady`), line 266 (`onSwitchOrganization` in master-drive), line 337 (`onSwitchOrganization` in org-dashboard).

- [ ] **Step 3: Swap the render branch**

Lines 252-262 become:

```tsx
{boot.kind === "signin" && (
  <SignIn
    onUnlockMaster={() => setBoot({ kind: "master-drive" })}
    onUnlockOrg={(org) => {
      api.setOrgContext(org.id);
      api.setOrgSlug(org.subdomain);
      setBoot({ kind: "org-dashboard", org, session: null });
    }}
    onTelegramLost={handleTelegramLost}
  />
)}
```

(AuthWizard needs no change: its `onLogin` already routes through `bootAfterTelegram`, which now returns `"signin"`. Verify by reading the `master-auth` branch at line 247 — if it calls anything picker-specific, adjust to `signin`.)

- [ ] **Step 4: Run the full gates**

Run in `web/frontend`: `npx tsc --noEmit` — Expected: clean
Run in `web/frontend`: `npx vitest run src/components/org/ src/api` — Expected: all PASS (SignIn, OrgLogin, ui, api suites)
Run in `web/backend`: `cargo test` — Expected: all PASS
Run from repo root: `graphify update .` — Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/App.tsx
git commit -m "feat: boot into common sign-in"
```

---

## Self-Review

- **Spec coverage:** SignIn form + reserved word (§1) → Tasks 4-5. Resolve endpoint (§2) → Task 3. Throttling (§2) → Tasks 1-2. Generic errors (§3) → Task 4 component + tests. Org-URL login untouched → no task (correct). AuthWizard setup-only → verified no-change in Task 5 Step 3.
- **Placeholders:** none — every step has exact code, exact line numbers, exact commands, exact expected outputs.
- **Type consistency:** `resolveOrg` returns `{ org_id, display_name }` in api.ts (Task 3), handler returns the same JSON keys (Task 3), SignIn reads `.org_id` (Task 4). `onUnlockOrg` payload `{ id, name, subdomain }` matches `unlockOrganization` response and the old picker contract. Throttle key format `"{ip}:master"` / `"{ip}:org:{id}"` consistent across Tasks 1-2.
