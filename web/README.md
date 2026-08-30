# Telegram Drive — Web App

A full-stack web application that turns Telegram channels into a cloud drive. Upload, browse, stream, and manage files stored in your Telegram channels — with automatic backup to a secondary channel.

## Architecture

```
Browser (React SPA)                    Cloudflare Pages
        │                                      │
        │ HTTPS                                │
        ▼                                      ▼
Actix-web Backend (Render)    ◄──── MTProto ────► Telegram API
        │                                      │
        │                                      ▼
        └─────────► Main Channel ──forward──► Backup Channel
```

| Layer | Tech | Deploy |
|-------|------|--------|
| **Frontend** | React 19, Vite, Tailwind CSS, TypeScript | Cloudflare Pages |
| **Backend** | Rust, Actix-web, grammers 0.10 (MTProto) | Render (Docker) |
| **Keep-alive** | GitHub Actions cron + background self-ping | Prevents Render free-tier sleep |

## Features

### File Management
- Upload files up to **5 GB** (chunked via grammers streaming, adaptive 128KB–512KB parts, 4 parallel workers)
- Download files with streaming responses
- Browse files in grid or list view with sorting and grouping
- Search files globally across all channels
- Move, copy, delete files between channels
- Rename and manage folders

### Backup System
- Configure a **main channel** (`TELEGRAM_CHANNEL_ID`) for uploads
- Configure a **backup channel** (`BACKUP_CHANNEL_ID`) for redundancy
- After upload, files are **automatically forwarded** to the backup channel in the background (non-blocking)

### Media & Preview
- Inline image and video previews
- PDF viewer
- Audio/video player with streaming
- File metadata and properties panel

### AI Assistant
- Chat interface with configurable AI proxy

### Render Keep-Alive
- `/api/health` health check endpoint
- Background self-ping every 4 minutes when `RENDER_EXTERNAL_URL` is set
- **GitHub Actions cron** (`render-keep-alive.yml`) pings every 5 minutes as backup
- Render deployment blueprint (`render.yaml`) included

## Project Structure

```
web/
├── backend/              Rust + Actix-web server
│   ├── src/
│   │   ├── main.rs       Server entry, routes, AppState
│   │   ├── auth.rs       Telegram auth (phone, code, 2FA)
│   │   ├── files.rs      File CRUD, download, search
│   │   ├── folders.rs    Folder management
│   │   ├── upload.rs     Multipart upload (5GB), backup forward
│   │   ├── streaming.rs  Media streaming with Range support
│   │   ├── preview.rs    Thumbnails and previews
│   │   ├── ai.rs         AI chat proxy
│   │   ├── settings.rs   Persistent settings (JSON + env vars)
│   │   ├── keep_alive.rs Health check + Render self-ping
│   │   ├── models.rs     Request/response types
│   │   └── utils.rs      Peer resolution, caching
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── Dockerfile        Multi-stage build for Render
│   └── .env.example
├── frontend/             React + Vite SPA
│   ├── src/
│   │   ├── App.tsx       Root with auth routing
│   │   ├── api.ts        HTTP client (all Tauri deps removed)
│   │   ├── types.ts      TypeScript interfaces
│   │   ├── utils.ts      formatBytes, file-type detection
│   │   ├── context/      Theme and confirm dialogs
│   │   └── components/   AuthWizard, Dashboard, sub-components
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── render.yaml           Render deployment blueprint
├── .gitignore
└── README.md
```

## Quick Start

### Backend

```bash
cd web/backend
cp .env.example .env    # fill in your Telegram API credentials
cargo run --release
```

The server starts at `http://localhost:8080`.

### Frontend

```bash
cd web/frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with API proxy to `localhost:8080`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_API_ID` | Telegram API ID | — |
| `TELEGRAM_API_HASH` | Telegram API Hash | — |
| `TELEGRAM_CHANNEL_ID` | Main channel ID for file storage | — |
| `BACKUP_CHANNEL_ID` | Backup channel (auto-forward after upload) | — |
| `PORT` | Server port | `8080` |
| `SESSION_PATH` | SQLite session file path | `telegram.session` |
| `FRONTEND_DIST` | Path to built frontend | `../frontend/dist` |
| `SETTINGS_PATH` | Persistent settings JSON | `settings.json` |
| `AI_PROXY_URL` | AI chat proxy URL | — |
| `KEEP_ALIVE_URL` | Override for keep-alive ping (non-Render) | — |
| `RENDER_EXTERNAL_URL` | Set automatically by Render | — |
| `RUST_LOG` | Log level | `info` |

## Deployment

### Frontend → Cloudflare Pages

```bash
cd web/frontend
VITE_API_URL=https://api.yourdomain.com npm run build
npx wrangler pages deploy dist --project-name=telegram-drive
```

### Backend → Render

1. Push to GitHub
2. In Render dashboard, create a new **Web Service**
3. Connect the repo and select `web/backend/Dockerfile`
4. Set environment variables in Render dashboard
5. Attach a persistent disk at `/app/data` for session storage

Or use the included blueprint:

```bash
# From the web/ directory
renderBlueprint deploy
```

### GitHub Actions Keep-Alive

The workflow at `.github/workflows/render-keep-alive.yml` runs every 5 minutes via `cron`. It pings `/api/health` to prevent Render's free tier from sleeping. Automatically active once the repo is pushed.

## Testing

### Backend (Rust)

```bash
cd web/backend
cargo test
```

**13 unit tests** covering:
- Model serialization roundtrips
- Settings file/env/override loading
- Utils error formatting
- Health check and URL construction

### Frontend (Vitest)

```bash
cd web/frontend
npm test
```

**36 unit tests** covering:
- `formatBytes` — all byte ranges (0 to TB), edge cases
- `formatDuration` — seconds, minutes, hours
- File type detection — images, video, audio, PDF, edge cases
- `buildFolderTree` — empty, flat, nested, orphan, deep hierarchy
- Type interface shapes and status union contracts

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check / keep-alive |
| POST | `/api/connect` | Connect with API ID |
| GET | `/api/check-connection` | Check Telegram connection |
| POST | `/api/auth/request-code` | Request login code |
| POST | `/api/auth/sign-in` | Sign in with code |
| POST | `/api/auth/check-password` | 2FA password check |
| GET | `/api/auth/user-info` | Get current user |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/files` | List files (optionally by folder) |
| POST | `/api/files/upload` | Upload file (multipart, up to 5GB) |
| GET | `/api/files/upload/status` | Upload config info |
| GET | `/api/files/{fid}/{mid}/download` | Download file |
| POST | `/api/files/delete` | Delete file |
| POST | `/api/files/move` | Move files between channels |
| POST | `/api/files/copy` | Copy files between channels |
| GET | `/api/files/search` | Search files globally |
| GET | `/api/bandwidth` | Bandwidth stats |
| GET | `/api/folders/scan` | Scan folder structure |
| POST | `/api/folders/create` | Create folder |
| PUT | `/api/folders/{id}/rename` | Rename folder |
| DELETE | `/api/folders/{id}/delete` | Delete folder |
| GET | `/api/folders/{id}/properties` | Folder properties |
| GET | `/api/stream-info` | Stream connection info |
| GET | `/api/stream/{fid}/{mid}` | Stream media |
| GET | `/api/preview/{fid}/{mid}` | Preview media |
| GET | `/api/thumbnail/{fid}/{mid}` | Get thumbnail |
| POST | `/api/ai/chat` | AI chat |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Save settings |
