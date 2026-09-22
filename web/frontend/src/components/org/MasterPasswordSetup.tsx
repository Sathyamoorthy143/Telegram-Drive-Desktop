import { useState } from 'react';
import * as api from '../../api';
import { OrgShell, OrgCard, AuthCard } from './ui';

interface Props {
  onReady: () => void;
}

export function MasterPasswordSetup({ onReady }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setMasterPassword(password);
      onReady();
    } catch (err: any) {
      setError(err?.message || 'Could not save password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgShell>
      <div className="flex justify-center pt-8">
        <div className="w-full max-w-sm">
          <OrgCard>
            <AuthCard title="Master Admin password" submitLabel="Submit" busy={busy} error={error} onSubmit={submit}>
              <p className="text-sm text-telegram-subtext mb-5">Create a password to open your personal drive. You cannot skip this step.</p>
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
              />
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Confirm</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full mb-4 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
              />
            </AuthCard>
          </OrgCard>
        </div>
      </div>
    </OrgShell>
  );
}
