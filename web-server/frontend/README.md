# web-server/frontend — Telegram Drive Client

React 19 + Vite 7 + TypeScript client for the consolidated **web-server** build, with an
optional **Tauri** desktop shell (`src-tauri/`). It talks to the Rust backend via the API bridge
in `src/services/apiBridge.ts` and is bundled into `../dist`, which the backend serves directly.

## Stack
- React 19, React-DOM 19
- Vite 7 + `@vitejs/plugin-react`
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- `@tanstack/react-query` (server state), `@tanstack/react-virtual` (virtualized lists)
- `framer-motion` (animations), `lucide-react` (icons), `sonner` (toasts)
- `pdfjs-dist` (in-app PDF viewer)
- Tauri 2 (`@tauri-apps/*` plugins) — only used by the desktop/tauri build

## Scripts
```bash
npm install
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # tsc + vite build → ../dist
npm run preview   # preview the production build
npm run tauri     # Tauri CLI (dev / build / icon)
```

## Structure
```
src/
├── main.tsx                 # entry point
├── App.tsx                  # root, routes AuthWizard ⇄ Dashboard
├── components/
│   ├── AuthWizard.tsx       # Telegram login flow (phone → OTP → 2FA)
│   ├── Dashboard.tsx        # top-level file manager
│   ├── FileTypeIcon.tsx     # icon by mime/type
│   ├── ThemeToggle.tsx      # light/dark switch
│   ├── UpdateBanner.tsx     # Tauri updater prompt
│   ├── ErrorBoundary.tsx    # crash guard
│   └── dashboard/           # feature components
│       ├── FileExplorer.tsx, FileCard.tsx, FileListItem.tsx
│       ├── Sidebar.tsx, SidebarItem.tsx, TopBar.tsx
│       ├── MediaPlayer.tsx, PdfViewer.tsx, PreviewModal.tsx, PreviewPane.tsx
│       ├── MoveToFolderModal.tsx, PropertiesModal.tsx, SettingsModal.tsx
│       ├── ContextMenu.tsx, DragDropOverlay.tsx, ExternalDropBlocker.tsx
│       ├── UploadQueue.tsx, DownloadQueue.tsx, TransferLogs.tsx
│       ├── BandwidthWidget.tsx, EmptyState.tsx
├── context/                 # ConfirmContext, ThemeContext
├── contexts/                # DropZoneContext
├── hooks/                   # useTelegramConnection, useFileUpload/Download/Operations, ...
├── services/apiBridge.ts    # REST bridge to the backend
├── types.ts, utils.ts, utils/treeUtils.ts
└── vite-env.d.ts
```

## Environment
The dev server proxies `/api` to the backend (see `vite.config.ts`). For a deployed build, point
the client at the backend URL via `VITE_API_URL` (or the equivalent used by `apiBridge.ts`).
