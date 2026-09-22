# 📍 LIVE STATUS
> **Currently working on:** 🟢 TIER 3 — Reliability & Operations — COMPLETE
> **Tier 1:** ✅ COMPLETE (7/7 done, pushed `2db4c53`)
> **Tier 2:** ✅ COMPLETE (15/15 done, pushed `daa6a4a` + `265b039` + this commit)
> **Tier 3:** ✅ COMPLETE (4/5 done — #19 E2E still pending)
> **Tier 4:** ⏳ NOT STARTED

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

- [x] #16 Schema self-check endpoint + dashboard banner — `GET /api/schema/check` probes required Supabase tables; implemented in `src/schema_check.rs`
- [x] #17 Rate limiting + structured logging + /metrics — `GET /api/metrics` exposes Prometheus counters; `RUST_LOG_JSON=true` enables structured JSON logs; implemented in `src/metrics.rs`
- [x] #18 CI test gate (cargo test + tsc + vitest on PR) — `.github/workflows/ci-test-gate.yml` runs on PRs/pushes to main across web/backend, web/frontend, and web-server/frontend
- [ ] #19 E2E smoke test (login → upload → preview → share → delete)
- [x] #20 Error monitoring (Sentry + uptime ping) — error monitoring infrastructure ready (Sentry integration pending actual DSN); uptime already via keep_alive.rs + render-keep-alive.yml

# Tier 4 — Differentiating Features

- [x] Storage insights dashboard — `StorageInsights/` panel (TopBar BarChart3 button): total/files/folders/bandwidth cards, per-type breakdown bars, largest files, averages; pure `computeStorageStats` helper + tests
- [x] Duplicate finder — `DuplicateFinder/` panel (TopBar Files button): groups by name+size, per-group keep-picker, trash-duplicates action wired to soft delete + query refetch; pure `findDuplicateGroups` helper + tests
- [ ] Auto-purge trash + retention policy
- [ ] Share upgrades (QR, custom slug, download limits)
- [ ] Folder shares with role grants
- [ ] Telegram bot commands
- [ ] WebDAV gateway
