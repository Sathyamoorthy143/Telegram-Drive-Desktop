# Telegram Drive — Web Version

A self-hosted web application that turns your Telegram account into unlimited cloud storage.

## Architecture

```
Frontend (Cloudflare Pages)  ←→  Backend (VPS / Railway / Fly.io)
         React + Vite                    Rust + Actix-web
         yourdomain.com                  :8080
                                              ↕
                                         Telegram MTProto
                                              ↕
                                         Telegram Servers
```

## Prerequisites

- **Rust** (latest stable) — https://rustup.rs
- **Node.js** (v18+) — https://nodejs.org
- A **Telegram account** with API credentials from https://my.telegram.org

## Quick Start

### 1. Backend

```bash
cd web/backend
cp .env.example .env
# Edit .env with your TG_API_ID and TG_API_HASH

cargo run --release
```

The backend starts on `http://localhost:8080`.

### 2. Frontend

```bash
cd web/frontend
npm install
npm run dev
```

The dev server starts on `http://localhost:5173` with API proxy to `localhost:8080`.

## Deployment

### Frontend → Cloudflare Pages

1. Build the frontend:
   ```bash
   cd web/frontend
   npm run build
   ```

2. Deploy:
   ```bash
   npx wrangler pages deploy dist --project-name=telegram-drive
   ```

3. Add your custom domain in the Cloudflare Pages dashboard.

4. Set environment variable `VITE_API_URL` to your backend URL:
   ```
   VITE_API_URL=https://api.yourdomain.com
   ```

### Backend → VPS / Railway / Fly.io

1. Build:
   ```bash
   cd web/backend
   cargo build --release
   ```

2. Deploy the binary with environment variables:
   ```bash
   TG_API_ID=your_id
   TG_API_HASH=your_hash
   PORT=8080
   RUST_LOG=info
   DOMAIN=api.yourdomain.com
   FRONTEND_DIST=/path/to/frontend/dist
   ```

3. Or use Docker:
   ```bash
   cd web/backend
   docker build -t telegram-drive-backend .
   docker run -p 8080:8080 -e TG_API_ID=xxx -e TG_API_HASH=xxx telegram-drive-backend
   ```

### Domain Setup

1. Add an A record pointing to your backend server
2. Configure CORS in the backend (already set to allow any origin)
3. Set `DOMAIN` env var on the backend to your domain

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TG_API_ID` | Telegram API ID | — |
| `TG_API_HASH` | Telegram API Hash | — |
| `PORT` | Server port | `8080` |
| `SESSION_PATH` | SQLite session file path | `telegram.session` |
| `SETTINGS_PATH` | Settings JSON file path | `settings.json` |
| `FRONTEND_DIST` | Path to built frontend | `../frontend/dist` |
| `AI_PROXY_URL` | Gemini AI proxy URL | — |
| `DOMAIN` | Public domain for streaming URLs | `localhost:8080` |
| `RUST_LOG` | Log level | `info` |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/connect` | Initialize Telegram client |
| GET | `/api/check-connection` | Check/reconnect |
| POST | `/api/auth/request-code` | Send OTP |
| POST | `/api/auth/sign-in` | Sign in with code |
| POST | `/api/auth/check-password` | 2FA password |
| GET | `/api/auth/user-info` | Current user info |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/files` | List files in folder |
| POST | `/api/files/upload` | Upload file (multipart) |
| GET | `/api/files/:fid/:mid/download` | Download file |
| POST | `/api/files/delete` | Delete file |
| POST | `/api/files/move` | Move files |
| POST | `/api/files/copy` | Copy files |
| GET | `/api/files/search` | Search files |
| GET | `/api/bandwidth` | Bandwidth stats |
| GET | `/api/folders/scan` | Scan folders |
| POST | `/api/folders/create` | Create folder |
| PUT | `/api/folders/:id/rename` | Rename folder |
| DELETE | `/api/folders/:id/delete` | Delete folder |
| GET | `/api/folders/:id/properties` | Folder properties |
| GET | `/api/stream/:fid/:mid` | Stream media |
| GET | `/api/preview/:fid/:mid` | Preview file |
| GET | `/api/thumbnail/:fid/:mid` | Thumbnail |
| POST | `/api/ai/chat` | Gemini AI chat |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Save settings |
