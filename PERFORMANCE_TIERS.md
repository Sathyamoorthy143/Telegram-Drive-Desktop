# Tier 1 — Performance

- [x] #1 Bundle diet — export libs already dynamic (`docx`, `pptxgenjs`); lazy-load 3D scenes; expanded manualChunks (react/motion/query/three/pdf/office/editor/icons)
- [x] #2 Thumbnails — backend immutable cache headers already set; added frontend LRU thumbnail cache + `loading="lazy"`/`decoding="async"` on images
- [x] #3 Backend response compression — actix `Compression` middleware (gzip + brotli); skips media/206 automatically
- [x] #4 HTTP Range for previews — backend Range/206 already existed; text preview now fetches only first 256KB via Range
- [x] #5 React Query tuning — 30s staleTime, 5min gcTime, `keepPreviousData` on folder list, sidebar hover prefetch, optimistic star toggle
- [x] #6 Grid virtualization — flattened grouped rows into one `useVirtualizer` (headers + card rows), deterministic heights, only the visible slice mounts
- [x] #7 Fast-transfer — already implemented (`forward_and_delete`, `worker_count_for`); verified in use

# Tier 2 — Experience

- [ ] #8 ⌘K command palette (search + actions)
- [ ] #9 Upload manager superpowers (resume after reload, conflict dialog, folder structure, auto-retry)
- [ ] #10 Download experience (folder ZIP, resume, batch)
- [ ] #11 Selection & bulk actions (marquee, shift-range, status bar)
- [ ] #12 Preview polish (PDF dark mode, image zoom/pan, neighbor preload)
- [ ] #13 Accessibility & mobile (focus traps, aria, drawer, long-press)
- [ ] #14 Per-folder view memory (sort/mode/density/columns)
- [ ] #15 Offline-first shell (service worker + cached view)

# Tier 3 — Reliability & Operations

- [ ] #16 Schema self-check endpoint + dashboard banner
- [ ] #17 Rate limiting + structured logging + /metrics
- [ ] #18 CI test gate (cargo test + tsc + vitest on PR)
- [ ] #19 E2E smoke test (login → upload → preview → share → delete)
- [ ] #20 Error monitoring (Sentry + uptime ping)

# Tier 4 — Differentiating Features

- [ ] Storage insights dashboard
- [ ] Duplicate finder
- [ ] Auto-purge trash + retention policy
- [ ] Share upgrades (QR, custom slug, download limits)
- [ ] Folder shares with role grants
- [ ] Telegram bot commands
- [ ] WebDAV gateway
