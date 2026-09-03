import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthWizard } from "./components/AuthWizard";
import { Dashboard } from "./components/dashboard/Dashboard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "sonner";
import { ConfirmProvider } from "./context/ConfirmContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { LockProvider, useLock } from "./context/LockContext";
import { LockScreen } from "./components/LockScreen";
import { toast } from "sonner";

const queryClient = new QueryClient();

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('isAuthenticated'));
  const [checking, setChecking] = useState(true);
  const { theme } = useTheme();
  const { isLocked, notificationMode, flushQueue, hasPin } = useLock();

  useEffect(() => {
    const API = import.meta.env.VITE_API_URL || '';
    const autoLogin = localStorage.getItem('auto_login');
    if (autoLogin === 'false') { setChecking(false); return; }
    fetch(`${API}/api/check-connection`).then(r => r.json()).then(ok => {
      if (ok) {
        setIsAuthenticated(true);
        localStorage.setItem('isAuthenticated', '1');
        fetch(`${API}/api/auth/user-info`).catch(()=>{});
      } else {
        setIsAuthenticated(false);
        localStorage.removeItem('isAuthenticated');
      }
    }).catch(() => {
      setIsAuthenticated(!!localStorage.getItem('isAuthenticated'));
    }).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!isLocked) {
      const q = flushQueue();
      if (q.length > 0) {
        if (notificationMode === 'suppress') {
          toast.info(`${q.length} notifications while locked`);
        } else if (notificationMode === 'hide') {
          q.forEach(item => toast(item.msg));
        } else {
          q.forEach(item => {
            if (item.type === 'success') toast.success(item.msg);
            else if (item.type === 'error') toast.error(item.msg);
            else toast.info(item.msg);
          });
        }
      }
    }
  }, [isLocked, flushQueue, notificationMode]);

  if (checking) {
    return (
      <main className="h-screen w-screen flex items-center justify-center bg-telegram-bg">
        <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="h-screen w-screen text-telegram-text overflow-hidden selection:bg-telegram-primary/30 relative">
      <Toaster theme={theme} position="bottom-center" />
      {hasPin && isLocked && <LockScreen />}
      {isAuthenticated ? (
        <Dashboard onLogout={() => { localStorage.removeItem('isAuthenticated'); setIsAuthenticated(false); }} />
      ) : (
        <AuthWizard onLogin={() => { localStorage.setItem('isAuthenticated','1'); setIsAuthenticated(true); }} />
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
            <LockProvider>
              <AppContent />
            </LockProvider>
          </ConfirmProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
