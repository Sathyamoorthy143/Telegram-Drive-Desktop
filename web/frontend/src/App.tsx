import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthWizard } from "./components/AuthWizard";
import { Dashboard } from "./components/dashboard/Dashboard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

import { Toaster } from "sonner";
import { ConfirmProvider } from "./context/ConfirmContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { DropZoneProvider } from "./contexts/DropZoneContext";
import { LockProvider } from "./context/LockContext";
import { OrgLogin } from "./components/org/OrgLogin";
import { MasterAdminDashboard } from "./components/org/MasterAdminDashboard";
import { OrgAdminDashboard } from "./components/org/OrgAdminDashboard";
import * as api from "./api";
import { orgSlugFromPath } from './orgRouting';

const queryClient = new QueryClient();

interface OrgInfo {
  id: string;
  name: string;
  subdomain: string;
  active?: boolean;
}

interface OrgSessionInfo {
  username: string;
  role: string;
  member_id: string;
}

function subdomainFromHostname(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const override = params.get("org")?.trim().toLowerCase();
    if (override) return override;
  } catch {}
  const host = window.location.hostname.toLowerCase();
  if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length >= 3 && parts[0] && parts[0] !== "www") return parts[0];
  return null;
}

type BootState =
  | { kind: "checking" }
  | { kind: "master-auth" }
  | { kind: "master-drive" }
  | { kind: "master-orgs" }
  | { kind: "master-open-org"; org: OrgInfo }
  | { kind: "org-login"; org: OrgInfo }
  | { kind: "org-dashboard"; org: OrgInfo; session: OrgSessionInfo | null };

export function AppContent() {
  const [boot, setBoot] = useState<BootState>({ kind: "checking" });
  const { theme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const bootApp = async () => {
      // 1. Org context from URL path (path-based routing, canonical).
      const pathSlug = orgSlugFromPath(window.location.pathname);
      // 2. Org context from subdomain (backward compat).
      const sub = subdomainFromHostname();
      let org: OrgInfo | null = null;
      let orgSource: 'path' | 'subdomain' | null = null;
      if (pathSlug) {
        try {
          const res = await api.getCurrentOrg(pathSlug);
          if (cancelled) return;
          if (res.org) {
            org = res.org;
            orgSource = 'path';
          }
        } catch {
          org = null;
        }
      }
      if (!org && sub) {
        try {
          const res = await api.getCurrentOrg(sub);
          if (cancelled) return;
          if (res.org) {
            org = res.org;
            orgSource = 'subdomain';
          }
        } catch {
          org = null;
        }
        if (cancelled) return;
      }
      if (cancelled) return;

      if (org && org.active === false) {
        setBoot({ kind: "org-login", org });
        return;
      }
      if (cancelled) return;

      // Set org context for API auto-routing.
      if (org && orgSource) {
        api.setOrgContext(org.id);
      }

      const masterConnected = await api.checkConnection().catch(() => false);
      if (cancelled) return;

      if (org) {
        // 2. Org mode: prefer stored member token, else master bypass, else login.
        const storedToken = api.getOrgToken();
        const storedOrg = api.getOrgId();
        if (storedToken && storedOrg === org.id) {
          try {
            const me = await api.orgMe(org.id);
            if (cancelled) return;
            setBoot({ kind: "org-dashboard", org, session: { username: me.username, role: me.role, member_id: me.member_id } });
            return;
          } catch {
            api.setOrgToken(null);
          }
        }
        if (cancelled) return;
        if (masterConnected) {
          setBoot({ kind: "org-dashboard", org, session: null });
          return;
        }
        setBoot({ kind: "org-login", org });
        return;
      }

      // 3. No org context: legacy single-user / master flow.
      if (masterConnected) {
        // Auto-login attempt for legacy settings (unchanged behavior).
        setBoot({ kind: "master-drive" });
        return;
      }
      try {
        const settings = await api.getSettings().catch(() => ({ auto_login: false } as any));
        if (cancelled) return;
        if (settings.auto_login) {
          const store = await api.getStore();
          const id = settings.telegram_api_id || (await store.get<string>("api_id").catch(() => ""));
          if (id) {
            const ok = await api.connect(Number(id)).catch(() => false);
            if (cancelled) return;
            if (ok) {
              const connected = await api.checkConnection().catch(() => false);
              setBoot({ kind: connected ? "master-drive" : "master-auth" });
              return;
            }
          }
        }
      } catch {
        // stay on auth screen
      }
      if (!cancelled) setBoot({ kind: "master-auth" });
    };
    bootApp();
    return () => { cancelled = true; };
  }, []);

  if (boot.kind === "checking") {
    return (
      <main className="h-screen w-screen text-telegram-text overflow-hidden selection:bg-telegram-primary/30 relative flex items-center justify-center">
        <Toaster theme={theme} position="bottom-center" />
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-telegram-subtext">Restoring session...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen text-telegram-text overflow-hidden selection:bg-telegram-primary/30 relative">
      <Toaster theme={theme} position="bottom-center" />
      {boot.kind === "master-auth" && (
        <AuthWizard onLogin={() => setBoot({ kind: "master-drive" })} />
      )}
      {boot.kind === "master-drive" && (
        <Dashboard
          onLogout={() => setBoot({ kind: "master-auth" })}
          topBanner={
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50">
              <button
                onClick={() => setBoot({ kind: "master-orgs" })}
                className="text-xs px-3 py-1.5 rounded-full bg-telegram-surface/90 backdrop-blur border border-telegram-border shadow hover:border-telegram-primary"
                title="Manage organizations"
              >
                Master admin · Organizations →
              </button>
            </div>
          }
        />
      )}
      {boot.kind === "master-orgs" && (
        <MasterAdminDashboard
          onBack={() => setBoot({ kind: "master-drive" })}
          onOpenOrg={(org) => { window.location.href = `/${org.subdomain}`; }}
        />
      )}
      {boot.kind === "org-login" && (
        <OrgLogin
          orgId={boot.org.id}
          orgName={boot.org.active === false ? `${boot.org.name} (inactive — contact admin)` : boot.org.name}
          onLogin={(session) => setBoot({ kind: "org-dashboard", org: boot.org, session })}
        />
      )}
      {boot.kind === "org-dashboard" && (
        <Dashboard
          onLogout={() => {
            api.setOrgToken(null);
            api.setOrgContext(null);
            window.location.href = '/';
          }}
          topBanner={
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50">
              <button
                onClick={() => { api.setOrgContext(null); window.location.href = '/'; }}
                className="text-xs px-3 py-1.5 rounded-full bg-telegram-surface/90 backdrop-blur border border-telegram-border shadow hover:border-telegram-primary"
                title="Back to master dashboard"
              >
                ← Master Dashboard
              </button>
            </div>
          }
        />
      )}
    </main>
  );
}


function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <DropZoneProvider>
              <LockProvider>
                <AppContent />
              </LockProvider>
            </DropZoneProvider>
          </ConfirmProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
