import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { OrgCard } from './ui';
import * as api from '../../api';

const canAdmin = (r: string) => ['admin', 'owner'].includes(r);

export function OrgSettingsPanel({ orgId, role }: { orgId: string; role: string }) {
  const [storage, setStorage] = useState<{ provisioned: boolean; main_channel_id?: number; backup_channel_id?: number } | null>(null);
  const [orgSettings, setOrgSettings] = useState<any | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ notification_mode: '', lock_interval_ms: '' });
  const [savingSettings, setSavingSettings] = useState(false);

  const loadStorage = async () => {
    try { setStorage(await api.getOrgStorageStatus(orgId)); }
    catch { setStorage(null); }
    try {
      const s = await api.getOrgSettings(orgId);
      setOrgSettings(s);
      setSettingsDraft({
        notification_mode: s?.notification_mode ?? '',
        lock_interval_ms: s?.lock_interval_ms != null ? String(s.lock_interval_ms) : '',
      });
    } catch { setOrgSettings(null); }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const patch: any = {};
      if (settingsDraft.notification_mode) patch.notification_mode = settingsDraft.notification_mode;
      patch.lock_interval_ms = settingsDraft.lock_interval_ms === '' ? null : Number(settingsDraft.lock_interval_ms);
      if (patch.lock_interval_ms !== null && (!Number.isFinite(patch.lock_interval_ms) || patch.lock_interval_ms < 0)) {
        toast.error('Lock interval must be a non-negative number of ms');
        return;
      }
      const s = await api.updateOrgSettings(orgId, patch);
      setOrgSettings(s);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    loadStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  void orgSettings;

  return (
    <div className="text-sm">
      <OrgCard>
      <h2 className="text-sm font-medium text-telegram-subtext mb-2">Org settings</h2>
      <div className="p-4 rounded-xl bg-telegram-surface border border-telegram-border space-y-1 mb-4">
        <p>Main channel: <span className="font-mono">{storage?.main_channel_id ?? '—'}</span></p>
        <p>Backup channel: <span className="font-mono">{storage?.backup_channel_id ?? '—'}</span></p>
        <p>Status: {storage?.provisioned ? 'provisioned' : 'not provisioned'}</p>
      </div>
      {canAdmin(role) ? (
        <form onSubmit={saveSettings} className="p-4 rounded-xl bg-telegram-surface border border-telegram-border space-y-3">
          <div>
            <label className="block text-xs font-medium text-telegram-subtext mb-1">Notification mode</label>
            <select
              value={settingsDraft.notification_mode}
              onChange={(e) => setSettingsDraft({ ...settingsDraft, notification_mode: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
            >
              <option value="">Default</option>
              <option value="all">All activity</option>
              <option value="important">Important only</option>
              <option value="muted">Muted</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telegram-subtext mb-1">Lock interval (ms, empty = default)</label>
            <input
              value={settingsDraft.lock_interval_ms}
              onChange={(e) => setSettingsDraft({ ...settingsDraft, lock_interval_ms: e.target.value })}
              placeholder="e.g. 300000"
              inputMode="numeric"
              className="w-full px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
            />
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-2 rounded-lg bg-telegram-primary text-white text-sm font-medium disabled:opacity-50"
          >
            {savingSettings ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      ) : (
        <p className="text-xs text-telegram-subtext mt-2">Only org admins can change settings.</p>
      )}
      </OrgCard>
    </div>
  );
}
