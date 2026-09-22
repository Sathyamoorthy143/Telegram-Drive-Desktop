import { useState, useEffect, useCallback } from "react";
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
import { OrgPicker } from "./components/org/OrgPicker";
import { OrgShell, OrgCard } from "./components/org/ui";
import { MasterPasswordSetup } from "./components/org/MasterPasswordSetup";
import { Landing } from "./components/landing/Landing";
import * as api from "./api";
import { orgSlugFromPath } from './orgRouting';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Drive listings change rarely minute-to-minute: 30s of freshness kills
      // redundant refetches when navigating folders, and caching is retained
      // for 5 minutes so back-and-forth navigation is instant.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
  | { kind: "org-picker" }
  | { kind: "master-password-setup" }
  | { kind: "org-not-found"; slug: string }
  | { kind: "org-login"; org: OrgInfo }
  | { kind: "org-dashboard"; org: OrgInfo; session: OrgSessionInfo | null };

async function bootAfterTelegram(): Promise<BootState> {
  const st = await api.getMasterUnlockStatus().catch(() => ({ has_master_password: false }));
  return { kind: st.has_master_password ? "org-picker" : "master-password-setup" };
}

export function AppContent() {
  const [boot, setBoot] = useState<BootState>({ kind: "checking" });
  const [showLanding, setShowLanding] = useState(true);
  const { theme } = useTheme();
  const handleTelegramLost = useCallback(() => {
    setShowLanding(true);
    setBoot({ kind: "master-auth" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootApp = async () => {
      // One-time ?org= override: consume then strip so later navigations
      // and refreshes can't get stuck in org context.
      let orgOverride: string | null = null;
      try {
        const params = new URLSearchParams(window.location.search);
        orgOverride = params.get("org")?.trim().toLowerCase() || null;
        if (orgOverride) {
          params.delete("org");
          const q = params.toString();
          window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
        }
      } catch {}
      // 1. Org context from URL path (path-based routing, canonical).
      const pathSlug = orgSlugFromPath(window.location.pathname);
      // 2. Org context from subdomain (backward compat).
      const sub = orgOverride || subdomainFromHostname();
      // checkConnection is independent of org resolution: resolve both in
      // parallel instead of paying the round trips back-to-back before
      // first paint (master auto-login path drops from ~5 serial hops).
      const resolveOrg = (async (): Promise<{ org: OrgInfo; source: 'path' | 'subdomain' } | { notFound: string } | null> => {
        if (pathSlug) {
          try {
            const res = await api.getCurrentOrg(pathSlug);
            if (res.org) return { org: res.org, source: 'path' as const };
          } catch {
            // Explicit slug that fails to resolve -> not-found below.
          }
          // Explicit path slug that resolves to nothing: show not-found
          // instead of silently falling back to subdomain/master.
          return { notFound: pathSlug };
        }
        if (sub) {
          try {
            const res = await api.getCurrentOrg(sub);
            if (res.org) return { org: res.org, source: 'subdomain' as const };
          } catch {
            // Unknown subdomain is normal (e.g. apex label): fall through.
          }
        }
        return null;
      })();
      // Boot must never hang: a wedged backend (hung Telegram RPCs, stalled
      // workers) holds HTTP connections open forever, and plain awaits would
      // trap the app on the splash. Time out into the unreachable path.
      const BOOT_TIMEOUT_MS = 25000;
      const [orgOutcome, masterConnected] = await Promise.all([
        api.withTimeout(resolveOrg, BOOT_TIMEOUT_MS, null),
        api.withTimeout(api.checkConnection().catch(() => false as boolean), BOOT_TIMEOUT_MS, false),
      ]);
      if (cancelled) return;
      if (orgOutcome && 'notFound' in orgOutcome) {
        setBoot({ kind: "org-not-found", slug: orgOutcome.notFound });
        return;
      }
      const org: OrgInfo | null = orgOutcome && 'org' in orgOutcome ? orgOutcome.org : null;
      const orgSource: 'path' | 'subdomain' | null = orgOutcome && 'org' in orgOutcome ? orgOutcome.source : null;
      if (cancelled) return;

      if (org && org.active === false) {
        setBoot({ kind: "org-login", org });
        return;
      }
      if (cancelled) return;

      // Set org context for API auto-routing (+ slug hint header).
      if (org && orgSource) {
        api.setOrgContext(org.id);
        api.setOrgSlug(orgSource === 'path' ? pathSlug : sub);
      }

      if (org) {
        // 2. Org mode: prefer this org's stored member token (other orgs'
        // tokens stay in their own slots), else master bypass, else login.
        const storedToken = api.getOrgToken(org.id);
        if (storedToken) {
          try {
            const me = await api.orgMe(org.id);
            if (cancelled) return;
            setBoot({ kind: "org-dashboard", org, session: { username: me.username, role: me.role, member_id: me.member_id } });
            return;
          } catch {
            // Drop this org's slot only — and tell the server, so no
            // orphaned session lingers until TTL.
            api.setOrgToken(null, org.id);
            api.orgLogout(org.id).catch(() => {});
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

      // 3. No org context: picker / first-login master password, never drive.
      if (masterConnected) {
        const next = await bootAfterTelegram();
        if (!cancelled) setBoot(next);
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
              if (connected) {
                const next = await bootAfterTelegram();
                if (!cancelled) setBoot(next);
                return;
              }
              setBoot({ kind: "master-auth" });
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
          <p className="text-sm text-telegram-subtext font-medium">Restoring session...</p>
        </div>
      </main>
    );
  }

  if (boot.kind === "master-auth" && showLanding) {
    return (
      <main className="h-screen w-screen overflow-hidden relative">
        <Toaster theme={theme} position="bottom-center" />
        <Landing onSignIn={() => setShowLanding(false)} />
      </main>
    );
  }

  return (
    <main className="h-screen w-screen text-telegram-text overflow-hidden selection:bg-telegram-primary/30 relative">
      <Toaster theme={theme} position="bottom-center" />
      {boot.kind === "master-auth" && (
        <AuthWizard onLogin={async () => setBoot(await bootAfterTelegram())} onBack={() => setShowLanding(true)} />
      )}
      {boot.kind === "master-password-setup" && (
        <MasterPasswordSetup onReady={() => setBoot({ kind: "org-picker" })} />
      )}
      {boot.kind === "org-picker" && (
        <OrgPicker
          onUnlockMaster={() => setBoot({ kind: "master-drive" })}
          onUnlockOrg={(org) => {
            api.setOrgContext(org.id);
            api.setOrgSlug(org.subdomain);
            setBoot({ kind: "org-dashboard", org, session: null });
          }}
          onTelegramLost={handleTelegramLost}
        />
      )}
      {boot.kind === "master-drive" && (
        <Dashboard
          onLogout={() => { setShowLanding(true); setBoot({ kind: "master-auth" }); }}
          onSwitchOrganization={() => { api.setOrgContext(null); setBoot({ kind: "org-picker" }); }}
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
      {boot.kind === "org-not-found" && (
        <OrgShell>
          <div className="flex justify-center pt-8">
            <div className="w-full max-w-sm">
              <OrgCard>
                <div className="text-center px-2 py-2">
                  <p className="text-lg font-semibold mb-1">Organization not found</p>
                  <p className="text-sm text-telegram-subtext mb-4">
                    No organization matches “{boot.slug}”. Check the URL or ask your admin for the right link.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => window.location.reload()}
                      className="text-sm px-4 py-2 rounded-lg border border-telegram-border hover:bg-telegram-hover"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => { api.setOrgContext(null); window.location.href = '/'; }}
                      className="text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white"
                    >
                      Back to master
                    </button>
                  </div>
                </div>
              </OrgCard>
            </div>
          </div>
        </OrgShell>
      )}
      {boot.kind === "org-login" && (
        <OrgLogin
          orgId={boot.org.id}
          orgName={boot.org.name}
          inactive={boot.org.active === false}
          onLogin={(session) => setBoot({ kind: "org-dashboard", org: boot.org, session })}
        />
      )}
      {boot.kind === "org-dashboard" && (
        <Dashboard
          onLogout={() => {
            api.setOrgToken(null, boot.org.id);
            api.setOrgContext(null);
            if (boot.session) {
              window.location.href = `/${boot.org.subdomain}`;
            } else {
              api.logout().catch(() => {});
              setShowLanding(true);
              setBoot({ kind: "master-auth" });
            }
          }}
          onSwitchOrganization={boot.session ? undefined : () => { api.setOrgContext(null); setBoot({ kind: "org-picker" }); }}
          orgMode={{ org: boot.org, session: boot.session }}
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
