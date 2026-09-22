import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Tier 2 #15 (partial): register a service worker for the cached shell.
// Registers on first load after a short delay to avoid blocking initial render.
// The worker caches the app shell (index.html + JS/CSS) so subsequent loads
// work offline. API calls are network-first (fall back to stale on failure).
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

  // Register the new service worker that caches the app shell for offline use.
  window.addEventListener("load", () => {
    // Small delay to ensure the page is fully painted before installing the worker.
    setTimeout(() => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
          console.log("[SW] Service worker registered:", reg.scope);
        }).catch((err) => {
          console.warn("[SW] Service worker registration failed:", err);
        });
      }
    }, 1000);
  }, { once: true });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
