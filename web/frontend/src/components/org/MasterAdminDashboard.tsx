import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Building2, Plus, Trash2, Power, Database, Users, Activity, FolderOpen, Bell } from 'lucide-react';
import * as api from '../../api';
import { runParallelPool } from '../../uploadQueue';
import type { OrgOverviewEntry, OrgMember, AuditEntry } from '../../types';

interface OrgAlertRow extends AuditEntry {
  orgName: string;
}

interface Props {
  onOpenOrg: (org: { id: string; name: string; subdomain: string }) => void;
  onBack: () => void;
}

type DetailTab = 'members' | 'activity';

export function MasterAdminDashboard({ onOpenOrg, onBack }: Props) {
  const [orgs, setOrgs] = useState<OrgOverviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [entryPassword, setEntryPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrgOverviewEntry | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('members');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'admin' });
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const [backendStale, setBackendStale] = useState(false);
  const [overviewPartial, setOverviewPartial] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [alerts, setAlerts] = useState<OrgAlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const toRow = (o: any): OrgOverviewEntry => ({
    id: o.id,
    name: o.name,
    subdomain: o.subdomain,
    active: o.active !== false,
    created_at: o.created_at,
    member_count: o.member_count ?? 0,
    trash_count: o.trash_count ?? 0,
    has_audit: o.has_audit ?? false,
    provisioned: o.provisioned ?? Boolean(o.channel_id),
    channel_id: o.channel_id,
    backup_channel_id: o.backup_channel_id,
    partial: o.partial,
    errors: o.errors,
  });

  const refresh = async () => {
    // Capability probe and overview are independent: fetch concurrently
    // instead of serially (~half the wait). Fallback semantics unchanged:
    // a failed probe clears the stale flag, overview falls back to the
    // plain org list, and existing rows are kept on total failure.
    try {
      const capsP = api.getBackendCaps().then(
        (caps) => setBackendStale(caps?.org_platform !== true),
        () => setBackendStale(false),
      );
      const overviewP = (async () => {
        try {
          const res = await api.getAdminOverview();
          const list = Array.isArray(res?.orgs) ? res.orgs : Array.isArray(res) ? res : [];
          if (list.length === 0) {
            try {
              const fallback = await api.getOrganizations();
              const fb = Array.isArray(fallback) ? fallback : [];
              if (fb.length > 0) {
                setOrgs(fb.map(toRow));
                setOverviewPartial(true);
                return;
              }
            } catch { /* keep any optimistic rows */ }
            setOrgs((prev) => prev);
            setOverviewPartial(true);
            return;
          }
          setOrgs(list.map(toRow));
          setOverviewPartial(res?.partial === true);
        } catch {
          const list = await api.getOrganizations();
          const fb = Array.isArray(list) ? list : [];
          if (fb.length > 0) setOrgs(fb.map(toRow));
          else setOrgs((prev) => prev);
          setOverviewPartial(true);
        }
      })();
      await Promise.all([capsP, overviewP]);
    } catch (e: any) {
      toast.error(`Failed to load organizations: ${e.message}`);
      setOrgs((prev) => prev || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const loadDetail = async (org: OrgOverviewEntry, tab: DetailTab) => {
    setSelected(org);
    setDetailTab(tab);
    try {
      if (tab === 'members') setMembers(await api.getOrgMembers(org.id, true));
      else setActivity(await api.getOrgActivity(org.id, true));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const loadAlertsOverview = async () => {
    setShowAlerts(true);
    setAlertsLoading(true);
    try {
      // Bounded fan-out over the shared pool runner: per-org failures are
      // skipped individually, and large fleets can't stampede the backend.
      const merged: OrgAlertRow[] = [];
      let failedOrgs = 0;
      await runParallelPool(orgs, 4, async (org) => {
        try {
          const entries = await api.getOrgAlerts(org.id, true);
          for (const a of entries) merged.push({ ...a, orgName: org.name });
        } catch {
          failedOrgs += 1;
        }
      });
      merged.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setAlerts(merged.slice(0, 30));
      if (failedOrgs > 0) {
        toast.warning(`Skipped alerts for ${failedOrgs} org${failedOrgs > 1 ? 's' : ''} (request failed)`);
      }
    } catch (e: any) {
      toast.error(`Failed to load alerts: ${e.message}`);
    } finally {
      setAlertsLoading(false);
    }
  };

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !subdomain.trim()) {
      toast.error('Name and subdomain are required');
      return;
    }
    if (entryPassword.length < 4) {
      toast.error('Entry password min 4 chars');
      return;
    }
    setCreating(true);
    try {
      const created = await api.createOrganization(name.trim(), subdomain.trim().toLowerCase(), entryPassword);
      toast.success(`Organization "${name.trim()}" created`);
      setName('');
      setSubdomain('');
      setEntryPassword('');
      if (created?.id) {
        setOrgs((prev) => (prev.some((o) => o.id === created.id) ? prev : [toRow(created), ...prev]));
      }
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const provision = async (org: OrgOverviewEntry) => {
    setProvisioningId(org.id);
    try {
      toast.info('Provisioning Telegram channels — this can take up to a minute…');
      const res = await api.provisionOrgStorage(org.id);
      toast.success(`Channels provisioned: ${res.main_channel_id} / ${res.backup_channel_id}`);
      await refresh();
    } catch (e: any) {
      toast.error(`Provision failed: ${e.message}`, { duration: 8000 });
    } finally {
      setProvisioningId(null);
    }
  };

  const toggleActive = async (org: OrgOverviewEntry) => {
    try {
      await api.updateOrganization(org.id, { active: !org.active });
      toast.success(org.active ? 'Organization deactivated' : 'Organization activated');
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removeOrg = async (org: OrgOverviewEntry) => {
    if (!window.confirm(`Deactivate "${org.name}"? Its files stay in Telegram but members lose access.`)) return;
    try {
      await api.deleteOrganization(org.id);
      toast.success('Organization deactivated');
      setSelected(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const createMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!newUser.username.trim() || newUser.password.length < 4) {
      toast.error('Username required, password min 4 chars');
      return;
    }
    try {
      await api.createOrgMember(selected.id, newUser.username.trim(), newUser.password, newUser.role, true);
      toast.success(`Member "${newUser.username}" created as ${newUser.role}`);
      setNewUser({ username: '', password: '', role: 'admin' });
      setMembers(await api.getOrgMembers(selected.id, true));
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const deleteMember = async (memberId: string, username: string) => {
    if (!selected) return;
    if (!window.confirm(`Remove member "${username}"?`)) return;
    try {
      await api.deleteOrgMember(selected.id, memberId, true);
      toast.success('Member removed');
      setMembers(await api.getOrgMembers(selected.id, true));
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Back to My Drive">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Building2 className="w-6 h-6 text-telegram-primary" />
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Organizations</h1>
            <p className="text-sm text-telegram-subtext">Master admin — create orgs, provision Telegram channels, manage admins.</p>
          </div>
          <button
            onClick={() => (showAlerts ? setShowAlerts(false) : loadAlertsOverview())}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover"
            title="Recent activity across all organizations"
          >
            <Bell className="w-3.5 h-3.5" /> {showAlerts ? 'Hide alerts' : 'Alerts overview'}
          </button>
        </div>

        {showAlerts && (
          <div className="mb-4 p-3 rounded-xl bg-telegram-surface border border-telegram-border">
            <p className="text-xs font-bold uppercase tracking-widest text-telegram-subtext mb-2">Recent activity · all orgs</p>
            {alertsLoading ? (
              <p className="text-sm text-telegram-subtext">Loading alerts…</p>
            ) : alerts.length === 0 ? (
              <p className="text-sm text-telegram-subtext">No recent activity across organizations.</p>
            ) : (
              <ul className="space-y-1 max-h-72 overflow-y-auto">
                {alerts.map((a, i) => (
                  <li key={a.id || `${a.orgName}-${a.created_at}-${i}`} className="text-xs text-telegram-subtext">
                    <span className="text-telegram-primary font-medium">{a.orgName}</span>
                    {' · '}<span className="text-telegram-text font-medium">{a.action}</span>
                    {a.target_type ? ` · ${a.target_type}:${a.target_id}` : ''} · {a.created_at || ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {backendStale && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-sm text-red-500">
            Backend is outdated (no org-platform support). Redeploy the backend from the latest <span className="font-mono">main</span> and refresh —
            creating orgs and provisioning will not work until then.
          </div>
        )}

        {overviewPartial && (
          <div className="mb-4 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/40 text-sm text-yellow-600">
            Some org stats failed to load — affected rows are marked and counts may read 0. Refresh to retry.
          </div>
        )}

        <form onSubmit={createOrg} className="flex flex-wrap gap-2 mb-6 p-4 bg-telegram-surface border border-telegram-border rounded-xl">
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Org name (e.g. Acme Corp)"
            className="flex-1 min-w-40 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
          />
          <input
            value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="subdomain (e.g. acme)"
            className="flex-1 min-w-40 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
          />
          <input
            type="password"
            value={entryPassword} onChange={(e) => setEntryPassword(e.target.value)} placeholder="entry password (min 4)"
            className="flex-1 min-w-40 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
          />
          <button type="submit" disabled={creating} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-telegram-primary text-white font-medium disabled:opacity-50">
            <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create org'}
          </button>
        </form>

        {loading ? (
          <p className="text-telegram-subtext">Loading organizations…</p>
        ) : orgs.length === 0 ? (
          <p className="text-telegram-subtext">No organizations yet. Create the first one above, then provision its Telegram channels.</p>
        ) : (
          <div className="grid gap-3">
            {orgs.map((org) => (
              <div key={org.id} className={`p-4 bg-telegram-surface border border-telegram-border rounded-xl ${org.active === false ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-52">
                    <div className="font-semibold flex items-center gap-2">
                      {org.name}
                      {org.active === false && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-500">inactive</span>}
                      {!org.provisioned && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600">not provisioned</span>}
                      {org.partial && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600" title={`Failed lookups: ${(org.errors || []).join(', ')}`}>partial data</span>}
                    </div>
                    <div className="text-xs text-telegram-subtext">
                      {org.subdomain} · {org.member_count} members · {org.trash_count} trashed
                      {org.channel_id ? ` · main ${org.channel_id}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!org.provisioned && (
                      <button
                        onClick={() => provision(org)}
                        disabled={provisioningId === org.id}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-telegram-primary text-white disabled:opacity-50"
                        title="Create this org's Telegram channels"
                      >
                        <Database className="w-3.5 h-3.5" />
                        {provisioningId === org.id ? 'Provisioning…' : 'Provision'}
                      </button>
                    )}
<button onClick={() => onOpenOrg(org)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">
                       <FolderOpen className="w-3.5 h-3.5" /> Open as admin
                    </button>
                    <button onClick={() => loadDetail(org, 'members')} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">
                      <Users className="w-3.5 h-3.5" /> Members
                    </button>
                    <button onClick={() => loadDetail(org, 'activity')} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">
                      <Activity className="w-3.5 h-3.5" /> Activity
                    </button>
                    <button onClick={() => toggleActive(org)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover" title={org.active === false ? 'Activate' : 'Deactivate'}>
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeOrg(org)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10" title="Deactivate org">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {selected?.id === org.id && (
                  <div className="mt-4 pt-4 border-t border-telegram-border">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (resetPassword.length < 4) {
                          toast.error('Entry password min 4 chars');
                          return;
                        }
                        setResettingId(org.id);
                        try {
                          await api.resetOrgEntryPassword(org.id, resetPassword);
                          toast.success('Entry password updated');
                          setResetPassword('');
                        } catch (err: any) {
                          toast.error(err.message);
                        } finally {
                          setResettingId(null);
                        }
                      }}
                      className="flex flex-wrap gap-2 mb-3"
                    >
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="new entry password (min 4)"
                        className="flex-1 min-w-32 px-3 py-1.5 text-sm rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary"
                      />
                      <button type="submit" disabled={resettingId === org.id} className="text-xs px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover disabled:opacity-50">
                        {resettingId === org.id ? 'Saving…' : 'Reset entry password'}
                      </button>
                    </form>
                    {detailTab === 'members' ? (
                      <div>
                        <form onSubmit={createMember} className="flex flex-wrap gap-2 mb-3">
                          <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="username"
                            className="flex-1 min-w-32 px-3 py-1.5 text-sm rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" />
                          <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="password (min 4)"
                            className="flex-1 min-w-32 px-3 py-1.5 text-sm rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" />
                          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                            className="px-3 py-1.5 text-sm rounded-lg bg-telegram-bg border border-telegram-border">
                            <option value="admin">admin</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                            <option value="owner">owner</option>
                          </select>
                          <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-telegram-primary text-white">Add member</button>
                        </form>
                        {members.length === 0 ? (
                          <p className="text-sm text-telegram-subtext">No members yet. Add the first org admin above.</p>
                        ) : (
                          <ul className="space-y-1">
                            {members.map((m) => (
                              <li key={m.id} className="flex items-center gap-2 text-sm">
                                <span className="font-medium">{m.username}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-telegram-primary/10 text-telegram-primary">{m.role}</span>
                                <button onClick={() => deleteMember(m.id, m.username)} className="ml-auto text-xs text-red-500 hover:underline">remove</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div>
                        {activity.length === 0 ? (
                          <p className="text-sm text-telegram-subtext">No audit entries yet.</p>
                        ) : (
                          <ul className="space-y-1 max-h-64 overflow-y-auto">
                            {activity.map((a, i) => (
                              <li key={a.id || i} className="text-xs text-telegram-subtext">
                                <span className="text-telegram-text font-medium">{a.action}</span>
                                {a.target_type ? ` · ${a.target_type}:${a.target_id}` : ''} · {a.created_at || ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
