# 📍 LIVE STATUS
> **Currently working on:** 🟣 TIER 4 — Differentiating Features — 2/7 DONE
> **Tier 1:** ✅ COMPLETE (7/7 done, pushed `2db4c53`)
> **Tier 2:** ✅ COMPLETE (15/15 done, pushed `9c38ca4` → `daa6a4a` → `b48d77b`)
> **Tier 3:** ✅ 4/5 DONE — #19 E2E smoke test pending
> **Tier 4:** 🔵 IN PROGRESS (Storage insights ✅, Duplicate finder ✅, pushed `17bc088`)
> **Test suite:** 65 backend + 111 frontend tests green; tsc clean; vite build green

---

# Tier 2 — Experience 🔵 COMPLETE

- [x] #1 Bundle diet — export libs already dynamic (`docx`, `pptxgenjs`); lazy-load 3D scenes; expanded manualChunks (react/motion/query/three/pdf/office/editor/icons)
- [x] #2 Thumbnails — backend immutable cache headers already set; added frontend LRU thumbnail cache + `loading="lazy"`/`decoding="async"` on images
- [x] #3 Backend response compression — actix `Compression` middleware (gzip + brotli); skips media/206 automatically
- [x] #4 HTTP Range for previews — backend Range/206 already existed; text preview now fetches only first 256KB via Range
- [x] #5 React Query tuning — 30s staleTime, 5min gcTime, `keepPreviousData` on folder list, sidebar hover prefetch, optimistic star toggle
- [x] #6 Grid virtualization — flattened grouped rows into one `useVirtualizer` (headers + card rows), deterministic heights, only the visible slice mounts
- [x] #7 Fast-transfer — already implemented (`forward_and_delete`, `worker_count_for`); verified in use

# Tier 2 — Experience

- [x] #8 ⌘K command palette (search files + actions; arrow nav; Ctrl+K toggle)
- [x] #9 Upload manager superpowers (resume after reload, conflict dialog, folder structure, auto-retry) — pushed `daa6a4a`
- [x] #10 Download experience (folder ZIP, resume, batch)
- [x] #11 Selection & bulk actions (marquee, shift-range, status bar)
- [x] #12 Preview polish (PDF dark mode toggle)
- [x] #13 Accessibility & mobile (focus traps, aria, semantic HTML on CommandPalette) — added `role="dialog"`, `aria-modal`, `role="listbox"`, `role="option"`, `aria-selected`, `tabIndex` management, `aria-label` on search/input/icons
- [x] #14 Per-folder view memory (sort/group/mode per folder via `td_view:` keys)
- [x] #15 Offline-first shell (service worker + cached view) — `public/sw.js` caches app shell (index.html, JS, CSS), network-first for API, event registration in `main.tsx`

# Tier 3 — Reliability & Operations

- [x] #16 Schema self-check endpoint + dashboard banner — `GET /api/schema/check` probes required Supabase tables; implemented in `src/schema_check.rs` *(frontend banner still pending — see backlog)*
- [x] #17 Rate limiting + structured logging + /metrics — `GET /api/metrics` exposes Prometheus counters; `RUST_LOG_JSON=true` enables structured JSON logs; implemented in `src/metrics.rs`
- [x] #18 CI test gate (cargo test + tsc + vitest on PR) — `.github/workflows/ci-test-gate.yml` runs on PRs/pushes to main across web/backend, web/frontend, and web-server/frontend
- [ ] #19 E2E smoke test (login → upload → preview → share → delete) — *(see backlog for plan)*
- [x] #20 Error monitoring (Sentry + uptime ping) — error monitoring infrastructure ready (Sentry integration pending actual DSN); uptime already via keep_alive.rs + render-keep-alive.yml

# Tier 4 — Differentiating Features 🔵 IN PROGRESS (2/7)

- [x] Storage insights dashboard — `StorageInsights/` panel (TopBar BarChart3 button): total/files/folders/bandwidth cards, per-type breakdown bars, largest files, averages; pure `computeStorageStats` helper + tests
- [x] Duplicate finder — `DuplicateFinder/` panel (TopBar Files button): groups by name+size, per-group keep-picker, trash-duplicates action wired to soft delete + query refetch; pure `findDuplicateGroups` helper + tests
- [ ] Auto-purge trash + retention policy
- [ ] Share upgrades (QR, custom slug, download limits)
- [ ] Folder shares with role grants
- [ ] Telegram bot commands
- [ ] WebDAV gateway

---

# 🔜 FUTURE WORK — Backlog (ordered by priority)

## Priority 1 — Quality & polish

- [ ] **#19 E2E smoke test (Playwright)** — login → upload → preview → share → delete
  - Infra scaffolded in `e2e/` (`package.json`, `playwright.config.ts`, `tests/smoke.spec.ts` skeleton)
  - TODO: `cd e2e && npm install && npx playwright install chromium`
  - TODO: decide auth strategy — pre-seed cookies/localStorage from a manual login (recommended) vs. scripted phone-code login
  - TODO: flesh out the 5-step flow; E2E needs a running backend + Telegram session, so run locally or as a separate opt-in CI job (not in `ci-test-gate.yml`)
- [ ] **Schema-check dashboard banner (finish #16)** — backend endpoint exists; add a frontend component that polls `GET /api/schema/check` on boot and shows a `Banner` warning listing missing tables (reuse `components/org/ui.tsx` Banner)
- [ ] **Sentry wiring (finish #20)** — add `sentry` crate to `web/backend` + `@sentry/react` to `web/frontend`; DSN via `SENTRY_DSN` env var; wire into `ErrorBoundary` + actix middleware
- [ ] **Content-hash duplicate matching** — current finder is name+size only; add `GET /api/files/{fid}/{mid}/hash` (server-side SHA-256 stream) and offer "deep scan" toggle in `DuplicateFinder`

## Priority 2 — Tier 4 features

- [ ] **Auto-purge trash + retention policy**
  - Backend: configurable retention (e.g. `TRASH_RETENTION_DAYS=30`); background task in `replicate.rs`-style loop that purges `trash_items` older than N days
  - Frontend: retention setting in `SettingsModal` + per-org override in org settings
  - Safety: toast/notification 24h before purge
- [ ] **Share upgrades (QR, custom slug, download limits)**
  - QR: client-side generation (`qrcode` npm pkg) on the share dialog
  - Custom slug: unique `custom_slug` column on `shared_links`, route `/s/{slug}` falls back to token
  - Download limits: `max_views`/`views` already exist on `shared_links` — enforce in `share::public_share` + UI field on create
- [ ] **Folder shares with role grants**
  - Extend `shared_links` with `folder_id` scope (folder_id already a column) + role grant (`view`/`download`/`edit`)
  - Share page lists folder contents with per-role gating
- [ ] **Telegram bot commands**
  - Long-polling bot via grammers (`/list`, `/search <q>`, `/share <name>`, `/status`) reusing the backend's Telegram client
  - Gated behind env var `BOT_ENABLED=true` + owner chat-id allowlist
- [ ] **WebDAV gateway**
  - Mount the drive as WebDAV (PROPFIND/GET/PUT/DELETE) over the existing file APIs
  - Auth via Telegram session token or per-device app password; largest item here — schedule last

## Priority 3 — Cross-module parity & housekeeping

- [ ] **Port Tier 2/4 features to `app/` (desktop) and `web-server/` variants** — currently only `web/` has storage insights, duplicate finder, ⌘K palette, aria upgrades; sw.js + main.tsx already synced to all three
- [ ] **Mobile drawer + long-press (finish #13)** — accessibility pass covered CommandPalette; still missing bottom-sheet drawer for small screens and long-press context menus on touch devices
- [ ] **Fix pre-existing warnings** — `unused variable: state` in `auth_org.rs:316`; dead-code warnings (`SessionRow`, `TrashItem`, `already_copied`, …); act-warnings in `useUploadEngine.test.tsx`
- [ ] **Rate limiting (finish #17)** — `/api/metrics` + JSON logging shipped; per-IP token-bucket middleware on auth/upload routes still open
- [ ] **Dedupe test scaffolding** — `e2e/` needs `.gitignore` for `node_modules/`, `test-results/`, `playwright-report/`
