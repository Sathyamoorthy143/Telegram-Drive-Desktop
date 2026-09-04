import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthWizard } from "./components/AuthWizard";
import { Dashboard } from "./components/Dashboard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

import { Toaster } from "sonner";
import { ConfirmProvider } from "./context/ConfirmContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { DropZoneProvider } from "./contexts/DropZoneContext";
import * as api from "./api";

const queryClient = new QueryClient();

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const { theme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const tryAutoLogin = async () => {
      try {
        const connected = await api.checkConnection();
        if (cancelled) return;
        if (connected) {
          setIsAuthenticated(true);
          return;
        }
        const settings = await api.getSettings().catch(() => ({ auto_login: false } as any));
        if (cancelled) return;
        if (settings.auto_login) {
          const store = await api.getStore();
          const id = settings.telegram_api_id || (await store.get<string>('api_id').catch(() => ''));
          if (id) {
            const ok = await api.connect(Number(id)).catch(() => false);
            if (ok) setIsAuthenticated(true);
          }
        }
      } catch {
        // stay on auth screen
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    tryAutoLogin();
    return () => { cancelled = true; };
  }, []);

  if (checking) {
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
      {isAuthenticated ? (
        <Dashboard onLogout={() => setIsAuthenticated(false)} />
      ) : (
        <AuthWizard onLogin={() => setIsAuthenticated(true)} />
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
              <AppContent />
            </DropZoneProvider>
          </ConfirmProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
