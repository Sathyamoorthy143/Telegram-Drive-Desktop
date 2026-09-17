import { useState } from 'react';
import { Building2, LogIn } from 'lucide-react';
import * as api from '../../api';

interface Props {
  orgId: string;
  orgName: string;
  inactive?: boolean;
  onLogin: (session: { username: string; role: string; member_id: string }) => void;
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
      api.setOrgToken(sess.token);
      api.setOrgId(sess.org_id);
      onLogin({ username: sess.username, role: sess.role, member_id: sess.member_id });
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-telegram-surface border border-telegram-border rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-1">
          <span className="p-2 rounded-xl bg-telegram-primary/15 text-telegram-primary">
            <Building2 className="w-5 h-5" />
          </span>
          <h1 className="text-lg font-semibold">{orgName}</h1>
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-telegram-primary text-white font-medium disabled:opacity-50 hover:opacity-90"
        >
          <LogIn className="w-4 h-4" />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-telegram-subtext mt-4 text-center">
          Organization accounts are created by your org admin. No Telegram login needed.
        </p>
      </form>
    </div>
  );
}
