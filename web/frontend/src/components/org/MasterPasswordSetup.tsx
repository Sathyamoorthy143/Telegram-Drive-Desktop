import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import * as api from '../../api';

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
    <div className="h-full w-full flex items-center justify-center p-6 bg-zinc-200" style={{ fontFamily: 'Poppins, ui-sans-serif, system-ui, sans-serif' }}>
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-xl text-zinc-900">
        <div className="flex items-center gap-3 mb-1">
          <span className="p-2 rounded-xl bg-blue-900 text-amber-50">
            <ShieldCheck className="w-5 h-5" />
          </span>
          <h1 className="text-lg font-black uppercase">Master Admin password</h1>
        </div>
        <p className="text-sm text-zinc-600 mb-5">Create a password to open your personal drive. You cannot skip this step.</p>
        <label className="block text-xs font-medium text-zinc-500 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-zinc-100 border border-slate-200 outline-none focus:border-blue-900"
        />
        <label className="block text-xs font-medium text-zinc-500 mb-1">Confirm</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-zinc-100 border border-slate-200 outline-none focus:border-blue-900"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button type="submit" disabled={busy} className="cs-btn-navy w-full py-2 rounded disabled:opacity-50">
          {busy ? 'Saving…' : 'Submit'}
        </button>
      </form>
    </div>
  );
}
