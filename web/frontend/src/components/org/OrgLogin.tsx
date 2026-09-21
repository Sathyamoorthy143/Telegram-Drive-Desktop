import { useState, lazy, Suspense } from 'react';
import { Building2, LogIn } from 'lucide-react';
import * as api from '../../api';
import { TiltCard } from '../three/TiltCard';

// Lazy WebGL backdrop — keeps three.js out of the main bundle.
const Scene3D = lazy(() => import('../three/Scene3D').then((m) => ({ default: m.Scene3D })));

interface Props {
  orgId: string;
  orgName: string;
  inactive?: boolean;
  onLogin: (session: { username: string; role: string; member_id: string }) => void;
}

function friendlyOrgLoginError(raw?: string): string {
  const m = String(raw || '');
  if (/invalid username or password/i.test(m)) return 'Wrong username or password. Ask your org admin to verify your account.';
  if (/inactive/i.test(m)) return 'This organization is inactive — contact your admin.';
  if (/not configured|unavailable|service/i.test(m)) return 'Organization sign-in is temporarily unavailable. Try again shortly.';
  return m;
}

export function OrgLogin({ orgId, orgName, inactive, onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inactive) {
      setError('This organization is inactive — contact your admin.');
      return;
    }
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sess = await api.orgLogin(orgId, username.trim(), password);
      if (sess.org_id !== orgId) {
        setError('Signed into the wrong organization — please use this org’s own login page.');
        return;
      }
      api.setOrgToken(sess.token, sess.org_id);
      api.setOrgId(sess.org_id);
      onLogin({ username: sess.username, role: sess.role, member_id: sess.member_id });
    } catch (err: any) {
      setError(friendlyOrgLoginError(err?.message) || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-6 bg-zinc-200 relative overflow-hidden">
      {/* Interactive 3D backdrop — floats behind the org login card */}
      <Suspense fallback={null}>
        <Scene3D variant="light" className="absolute inset-0 z-0" />
      </Suspense>
      <TiltCard className="relative z-10 w-full max-w-sm" intensity={5}>
      <form onSubmit={submit} className="w-full bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl p-6 shadow-xl text-zinc-900">
        <div className="flex items-center gap-3 mb-1">
          <span className="p-2 rounded-xl bg-blue-900 text-amber-50">
            <Building2 className="w-5 h-5" />
          </span>
          <h1 className="text-lg font-black uppercase">{orgName}</h1>
        </div>
        <p className="text-sm text-telegram-subtext mb-5">Sign in with your organization account.</p>
        {inactive && (
          <p className="text-sm text-yellow-600 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
            This organization is deactivated. Contact your admin to reactivate it.
          </p>
        )}
        <label className="block text-xs font-medium text-telegram-subtext mb-1">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
          placeholder="e.g. alice"
        />
        <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full mb-4 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
          placeholder="••••••••"
        />
        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={busy || inactive}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-900 text-amber-50 font-bold disabled:opacity-50 hover:bg-blue-950"
        >
          <LogIn className="w-4 h-4" />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={() => { window.location.href = '/'; }}
          className="w-full mt-3 text-xs text-telegram-primary hover:underline"
        >
          ← Back to master dashboard
        </button>
        <p className="text-xs text-telegram-subtext mt-3 text-center">
          Organization accounts are created by your org admin. No Telegram login needed. Signing in here ends any other session for this account.
        </p>
      </form>
      </TiltCard>
    </div>
  );
}
