# web-server — Telegram Drive (All-in-One)

A **self-contained, single-repo** build of Telegram Drive: a Rust [Actix-web](https://actix.rs/)
backend that talks to Telegram over MTProto, plus a React + Vite + **Tauri** frontend, served
from the same binary and deployable to **Docker / Render** and **Vercel**.

This is a consolidated variant of the project — the backend lives in `web-server/src` and the
frontend in `web-server/frontend` (rather than the split `web/backend` + `web/frontend` layout
used by the canonical web app). It is fully functional on its own.

## Layout

```
web-server/
├── src/                  # Rust backend (Actix-web, `telegram-drive-web` binary)
│   ├── main.rs           # HTTP server, /api routes, SPA catch-all
│   ├── handlers/         # request handlers
│   │   ├── auth.rs       # request-code / sign-in / user-info
│   │   ├── fs.rs         # list files, delete, bandwidth
│   │   ├── ai.rs         # Gemini chat proxy (/api/gemini-chat)
│   │   ├── preview.rs    # thumbnails + preview bytes
│   │   └── streaming.rs  # streaming info for media playback
│   ├── models.rs         # shared request/response models
│   ├── security.rs       # AES-GCM encryption, PBKDF2, HMAC helpers
│   └── utils.rs          # peer cache, helpers
├── frontend/             # React + Vite + Tauri client (builds to ./dist)
│   ├── src/
│   │   ├── components/   # AuthWizard, Dashboard, MediaPlayer, PdfViewer, ...
│   │   ├── components/dashboard/  # FileExplorer, Sidebar, TopBar, AI Assistant, ...
│   │   ├── context/      # Confirm + Theme contexts
│   │   ├── hooks/        # useTelegramConnection, useFileUpload, ...
│   │   └── services/     # apiBridge.ts (frontend ↔ backend)
│   └── src-tauri/        # Tauri desktop shell config + icons
├── Cargo.toml            # backend crate (uses grammers from Lonami/grammers @ d07f96f)
├── Dockerfile            # multi-stage: build frontend + backend, run on :8080
├── vercel.json          # vercel-rust build + static dist + rewrites
└── public/assets/        # built static assets
```

## Backend API

Base path `/api`. CORS is permissive (`Cors::permissive()`).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/request-code` | Send OTP to Telegram account |
| POST | `/api/auth/sign-in` | Complete login with code |
| GET  | `/api/auth/user-info` | Current signed-in user |
| GET  | `/api/files` | List files in the drive |
| GET  | `/api/folders/scan` | Scan folders/channels |
| POST | `/api/folders/create` | Create a folder |
| POST | `/api/files/delete` | Delete a file |
| GET  | `/api/get-bandwidth` | Bandwidth usage stats |
| POST | `/api/gemini-chat` | Relay a chat message to Gemini |
| GET  | `/api/get-stream-info` | Streaming metadata for media |
| GET  | `/api/get-preview` | File preview bytes |
| GET  | `/api/get-thumbnail` | Thumbnail bytes |

The SPA is served from `./dist`; unknown routes fall back to `index.html`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `TG_API_ID` | Telegram API ID (my.telegram.org) | — |
| `TG_API_HASH` | Telegram API Hash | — |
| `RUST_LOG` | Log level | `info` |

> Secrets are loaded via `dotenvy` (`.env`). See `web/backend/.env.example` for the shape of
> the Telegram credentials — the same `TG_API_ID` / `TG_API_HASH` pair applies here.

## Run locally

### Backend
```bash
cd web-server
cp .env.example .env        # add TG_API_ID / TG_API_HASH
cargo run --release
```

### Frontend (dev)
```bash
cd web-server/frontend
npm install
npm run dev                 # Vite dev server
```

### Desktop (Tauri)
```bash
cd web-server/frontend
npm install
npm run tauri dev           # needs Rust + Tauri OS prerequisites
```

## Build the frontend for the server

```bash
cd web-server/frontend
npm run build               # outputs ../dist (served by the Rust binary)
```

## Deploy

### Docker / Render
```bash
cd web-server
docker build -t telegram-drive-web .
docker run -p 8080:8080 -e TG_API_ID=xxx -e TG_API_HASH=xxx telegram-drive-web
```
The `Dockerfile` builds the frontend, the backend, then ships a slim `debian:bookworm-slim`
image exposing `8080`.

### Vercel
`vercel.json` builds the Rust binary with `vercel-rust`, serves `frontend/dist` as static, and
rewrites `/api/*` → the Rust function and everything else → `index.html`.

## Notes
- The frontend `README.md` is the stock Tauri template; the real client docs are this file and
  the component tree above.
- Encryption helpers (`security.rs`) support at-rest protection of stored secrets/sessions.
