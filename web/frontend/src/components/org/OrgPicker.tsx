import { useEffect, useState } from 'react';
import { Building2, HardDrive, X } from 'lucide-react';
import * as api from '../../api';
import type { MyOrg } from '../../api';

interface Props {
  onUnlockMaster: () => void;
  onUnlockOrg: (org: { id: string; name: string; subdomain: string }) => void;
  onTelegramLost?: () => void;
}

type Modal =
  | { kind: 'master' }
  | { kind: 'org'; org: MyOrg };

export function OrgPicker({ onUnlockMaster, onUnlockOrg, onTelegramLost }: Props) {
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMyOrgs();
        if (!cancelled) setOrgs(Array.isArray(res?.orgs) ? res.orgs : []);
      } catch (err: any) {
        const status = err?.status;
        const msg = String(err?.message || '').toLowerCase();
        if (status === 401 || msg.includes('unauthorized') || msg.includes('authentication required')) {
          onTelegramLost?.();
          return;
        }
        if (!cancelled) setOrgs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [onTelegramLost]);

  const openMaster = () => {
    setError(null);
    setPassword('');
    setModal({ kind: 'master' });
  };

  const openOrg = (org: MyOrg) => {
    if (org.active === false) return;
    setError(null);
    setPassword('');
    setModal({ kind: 'org', org });
  };

  const closeModal = () => {
    if (busy) return;
    setModal(null);
    setPassword('');
    setError(null);
  };

  const orgNeedsPassword = modal?.kind === 'org' && !modal.org.has_entry_password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    if (orgNeedsPassword) return;
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (modal.kind === 'master') {
        await api.unlockMaster(password);
        onUnlockMaster();
      } else {
        const res = await api.unlockOrganization(modal.org.id, password);
        onUnlockOrg(res.org || { id: modal.org.id, name: modal.org.name, subdomain: modal.org.subdomain });
      }
    } catch (err: any) {
      const status = err?.status;
      const msg = String(err?.message || '');
      if (status === 409 || /set an entry password/i.test(msg)) {
        setError('Set an entry password in Organizations first');
      } else if (status === 401 || /wrong password/i.test(msg)) {
        setError('Wrong password');
      } else if (status === 403) {
        setError(msg || 'Cannot unlock this organization');
      } else {
        setError(msg || 'Unlock failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 bg-zinc-200" style={{ fontFamily: 'Poppins, ui-sans-serif, system-ui, sans-serif' }}>
      <div className="max-w-3xl mx-auto pt-8">
        <h1 className="text-2xl font-black uppercase text-blue-900 mb-1">Choose a workspace</h1>
        <p className="text-sm text-zinc-600 mb-6">Unlock Master Admin or an organization you created.</p>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading organizations…</p>
        ) : (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={openMaster}
              className="text-left p-4 bg-white border border-slate-200 rounded-xl hover:border-amber-400 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-blue-900 text-amber-50">
                  <HardDrive className="w-5 h-5" />
                </span>
                <div>
                  <div className="font-semibold text-zinc-900">Master Admin</div>
                  <div className="text-xs text-zinc-500">Personal drive</div>
                </div>
              </div>
            </button>
            {orgs.length === 0 && (
              <p className="text-sm text-zinc-500">No organizations yet. Create one from Master Admin → Organizations.</p>
            )}
            {orgs.map((org) => {
              const inactive = org.active === false;
              return (
                <button
                  key={org.id}
                  type="button"
                  disabled={inactive}
                  onClick={() => openOrg(org)}
                  className={`text-left p-4 bg-white border border-slate-200 rounded-xl transition-colors ${inactive ? 'opacity-60 cursor-not-allowed' : 'hover:border-amber-400'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-xl bg-blue-900 text-amber-50">
                      <Building2 className="w-5 h-5" />
                    </span>
                    <div>
                      <div className="font-semibold text-zinc-900 flex items-center gap-2">
                        {org.name}
                        {inactive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-600">inactive</span>}
                      </div>
                      <div className="text-xs text-zinc-500">{org.subdomain}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <form onSubmit={submit} className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-xl text-zinc-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold">
                {modal.kind === 'master' ? 'Master Admin password' : `Unlock ${modal.org.name}`}
              </h2>
              <button type="button" onClick={closeModal} className="p-1 rounded hover:bg-amber-400" title="Cancel">
                <X className="w-4 h-4" />
              </button>
            </div>
            {orgNeedsPassword ? (
              <p className="text-sm text-zinc-600 mb-4">Set an entry password in Organizations first</p>
            ) : (
              <>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full mb-3 px-3 py-2 rounded-lg bg-zinc-100 border border-slate-200 outline-none focus:border-blue-900"
                />
              </>
            )}
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={closeModal} className="cs-btn-ghost flex-1 py-2 rounded">Cancel</button>
              <button type="submit" disabled={busy || orgNeedsPassword} className="cs-btn-navy flex-1 py-2 rounded disabled:opacity-50">
                {busy ? 'Unlocking…' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
