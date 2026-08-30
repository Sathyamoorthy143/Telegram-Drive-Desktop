# Telegram Drive — Web Version

## Architecture
Frontend (Cloudflare Pages) ↔ Backend (VPS / Railway / Fly.io)
React + Vite                  Rust + Actix-web + grammers MTProto

## Quick Start

### Backend
```bash
cd web/backend
cp .env.example .env   # edit with your TG_API_ID and TG_API_HASH
cargo run --release
```

### Frontend
```bash
cd web/frontend
npm install
npm run dev
```

## Deployment

### Frontend → Cloudflare Pages
```bash
cd web/frontend
VITE_API_URL=https://api.yourdomain.com npm run build
npx wrangler pages deploy dist --project-name=telegram-drive
```

### Backend → VPS
```bash
cd web/backend
cargo build --release
TG_API_ID=xxx TG_API_HASH=xxx DOMAIN=api.yourdomain.com PORT=8080 ./target/release/main
```

## Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| TG_API_ID | Telegram API ID | — |
| TG_API_HASH | Telegram API Hash | — |
| PORT | Server port | 8080 |
| SESSION_PATH | SQLite session file | telegram.session |
| FRONTEND_DIST | Built frontend path | ../frontend/dist |
| DOMAIN | Public domain | localhost:8080 |
| RUST_LOG | Log level | info |
