# Telegram Drive

Turn your Telegram account into an unlimited, secure cloud storage drive. Available as both a **desktop app** and a **web app**.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20MacOS%20%7C%20Linux%20%7C%20Web-blue)

---

## What's Included

| | Desktop App (`app/`) | Web App (`web/`) |
|---|---|---|
| **Stack** | Tauri + Rust + React | React + Vite + Rust (Actix-web) |
| **Deploy** | Native installers (.msi, .dmg, .deb) | Cloudflare Pages + Render |
| **Upload limit** | System RAM | Up to 5 GB (chunked streaming) |
| **Backup** | — | Auto-forward to backup channel |
| **Keep-alive** | — | Self-ping + GitHub Actions cron |
| **Tests** | — | 13 backend + 36 frontend unit tests |

---

## 🌐 Web App

A full-stack web version that can be deployed to the cloud. Files upload directly to your Telegram channel with automatic backup.

**Quick Start:**
```bash
# Backend
cd web/backend
cp .env.example .env    # fill in Telegram API credentials
cargo run --release

# Frontend
cd web/frontend
npm install
npm run dev
```

**Features:**
- Upload files up to **5 GB** with chunked streaming
- **Auto-backup**: files are forwarded to a backup channel after upload
- Grid/list view, search, folders, media preview, AI chat
- Render keep-alive (health endpoint + GitHub Actions cron)
- Full REST API (25+ endpoints)

See **[web/README.md](web/README.md)** for full documentation, deployment guide, and API reference.

---

## 🖥️ Desktop App

A cross-platform desktop application built with **Tauri**, **Rust**, and **React**.

### Key Features
- **User Profile Card**: View your Telegram account details directly in the sidebar
- **Live Upload Stats**: Monitor real-time Network Speed (MB/s) and ETA for every file
- **Recursive Folder Upload**: Select an entire folder; the app queues all files
- **Stability Fixes**: Improved large file transfers and network reconnects

### Prerequisites
- Node.js (v18+)
- Rust (latest stable)
- OS-Specific Build Tools (See [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/))

### Installation

```bash
git clone https://github.com/Sathyamoorthy143/Telegram-Drive-Desktop.git
cd Telegram-Drive-Desktop/app
npm install
npm run tauri dev
```

> [!TIP]
> **Fast Login Tip:** For faster access during initial setup, you may want to temporarily disable **Two-Step Verification (Cloud Password)**. You can re-enable it once logged in.

> [!NOTE]
> **Open Source & Contributions:** This project is fully open source. Fork it, add features, and contribute back!

---

## Credits

This project is based on the original work by [caamer20](https://github.com/caamer20/Telegram-Drive). We thank the community for the inspiration and the core framework.

## License

Licensed under the **MIT License**.
