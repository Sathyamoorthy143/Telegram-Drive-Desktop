import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import * as api from '../../api';
import { OrgShell, PageHeader, OrgCard, AuthCard } from './ui';

interface Props {
  onUnlockMaster: () => void;
  onUnlockOrg: (org: { id: string; name: string; subdomain: string }) => void;
  onTelegramLost?: () => void;
}

const GENERIC_ERROR = 'Invalid name or password.';

function isTelegramLost(err: any): boolean {
  const status = err?.status;
  const msg = String(err?.message || '').toLowerCase();
  return status === 401 && (msg.includes('unauthorized') || msg.includes('authentication required') || msg.includes('telegram'));
}

export function SignIn({ onUnlockMaster, onUnlockOrg, onTelegramLost }: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim() || !password) {
      setError('Enter your organisation name and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ident = name.trim();
      if (ident.toLowerCase() === 'master') {
        await api.unlockMaster(password);
        onUnlockMaster();
        return;
      }
      let orgId: string;
      try {
        orgId = (await api.resolveOrg(ident)).org_id;
      } catch {
        setError(GENERIC_ERROR);
        return;
      }
      const res = await api.unlockOrganization(orgId, password);
      onUnlockOrg(res.org);
    } catch (err: any) {
      if (isTelegramLost(err)) {
        onTelegramLost?.();
        return;
      }
      if (err?.status === 429) {
        setError('Too many attempts — try again shortly.');
      } else {
        setError(GENERIC_ERROR);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgShell>
      <PageHeader icon={<KeyRound className="w-6 h-6 text-telegram-primary" />} title="Sign in" subtitle="Master Admin or your organization. Type master for the personal drive." />
      <div className="flex justify-center">
        <div className="w-full max-w-sm">
          <OrgCard>
            <AuthCard title="" submitLabel="Sign in" busy={busy} error={error} onSubmit={submit}>
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Organisation name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username"
                className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
                placeholder="Organisation name — or master" />
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                className="w-full mb-4 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
                placeholder="••••••••" />
            </AuthCard>
          </OrgCard>
        </div>
      </div>
    </OrgShell>
  );
}
