import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// One-time cleanup: no code in this repo registers a service worker, but
// older deploys shipped public/sw.js, so existing browsers may still run a
// stale worker that intercepts fetches (and crashes on failures). Unregister
// every worker for this origin plus its caches on boot. Idempotent.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) r.unregister().catch(() => {});
  }).catch(() => {});
  if (typeof caches !== "undefined") {
    caches.keys().then((keys) => {
      for (const k of keys) {
        if (k.startsWith("tg-drive-")) caches.delete(k).catch(() => {});
      }
    }).catch(() => {});
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
