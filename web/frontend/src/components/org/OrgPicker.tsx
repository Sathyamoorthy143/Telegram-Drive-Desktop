import { useEffect, useState } from 'react';
import { Building2, HardDrive } from 'lucide-react';
import * as api from '../../api';
import { OrgShell, PageHeader, OrgCard, OrgModal, AuthCard, EmptyState } from './ui';
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
    <OrgShell>
      <PageHeader icon={<Building2 className="w-6 h-6 text-telegram-primary" />} title="Choose a workspace" subtitle="Unlock Master Admin or an organization you created." />
      {loading ? (
        <EmptyState>Loading organizations…</EmptyState>
      ) : (
        <div className="grid gap-3">
          <OrgCard>
            <button type="button" onClick={openMaster} className="w-full text-left flex items-center gap-3">
              <span className="p-2 rounded-xl bg-telegram-primary text-white"><HardDrive className="w-5 h-5" /></span>
              <div><div className="font-semibold">Master Admin</div><div className="text-xs text-telegram-subtext">Personal drive</div></div>
            </button>
          </OrgCard>
          {orgs.length === 0 && <EmptyState>No organizations yet. Create one from Master Admin → Organizations.</EmptyState>}
          {orgs.map((org) => {
            const inactive = org.active === false;
            return (
              <OrgCard key={org.id} dimmed={inactive}>
                <button type="button" disabled={inactive} onClick={() => openOrg(org)} className="w-full text-left flex items-center gap-3 disabled:cursor-not-allowed">
                  <span className="p-2 rounded-xl bg-telegram-primary text-white"><Building2 className="w-5 h-5" /></span>
                  <div>
                    <div className="font-semibold flex items-center gap-2">{org.name}
                      {inactive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-500">inactive</span>}
                    </div>
                    <div className="text-xs text-telegram-subtext">{org.subdomain}</div>
                  </div>
                </button>
              </OrgCard>
            );
          })}
        </div>
      )}
      {modal && (
        <OrgModal title={modal.kind === 'master' ? 'Master Admin password' : `Unlock ${modal.org.name}`} onClose={closeModal}>
          {orgNeedsPassword ? (
            <EmptyState>Set an entry password in Organizations first</EmptyState>
          ) : (
            <AuthCard title="" submitLabel="Submit" busy={busy} error={error} onSubmit={submit}>
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" />
            </AuthCard>
          )}
        </OrgModal>
      )}
    </OrgShell>
  );
}
