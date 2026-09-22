import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { OrgCard } from './ui';
import * as api from '../../api';
import type { OrgMember } from '../../types';

const canAdmin = (r: string) => ['admin', 'owner'].includes(r);

export function OrgMembersPanel({ orgId, role, sessionMemberId, folders }: {
  orgId: string; role: string; sessionMemberId: string | null; folders: any[];
}) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [grants, setGrants] = useState<api.OrgFolderGrant[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer' });
  const [grantForm, setGrantForm] = useState({ member_id: '', folder_id: '', level: 'view' });
  const [savingGrant, setSavingGrant] = useState(false);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const loadMembers = async () => {
    setMembersLoading(true);
    setMembersError(null);
    try { setMembers(await api.getOrgMembers(orgId)); }
    catch (e: any) { setMembersError(e.message || 'Failed to load members'); }
    finally { setMembersLoading(false); }
  };

  const loadGrants = async () => {
    setGrantsLoading(true);
    setGrantsError(null);
    try { setGrants(await api.getOrgGrants(orgId)); }
    catch (e: any) { setGrantsError(e.message || 'Failed to load grants'); }
    finally { setGrantsLoading(false); }
  };

  const saveGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantForm.member_id || grantForm.folder_id === '') {
      toast.error('Pick a member and a folder');
      return;
    }
    setSavingGrant(true);
    try {
      await api.setOrgGrant(orgId, Number(grantForm.folder_id), grantForm.member_id, grantForm.level);
      toast.success('Folder access saved');
      setGrantForm({ member_id: '', folder_id: '', level: 'view' });
      loadGrants();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save grant');
    } finally {
      setSavingGrant(false);
    }
  };

  const removeGrant = async (folder_id: number, member_id: string) => {
    try {
      await api.deleteOrgGrant(orgId, folder_id, member_id);
      toast.success('Grant removed — org role applies again');
      loadGrants();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove grant');
    }
  };

  const folderName = (fid: number) => {
    if (fid === 0) return 'Drive root';
    return folders.find((f: any) => f.id === fid)?.name ?? `Folder ${fid}`;
  };

  const memberName = (mid: string) => members.find((m) => m.id === mid)?.username ?? mid.slice(0, 8);

  const createMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username.trim() || newUser.password.length < 4) {
      toast.error('Username required, password min 4 chars');
      return;
    }
    try {
      await api.createOrgMember(orgId, newUser.username.trim(), newUser.password, newUser.role);
      toast.success(`"${newUser.username}" added as ${newUser.role}`);
      setNewUser({ username: '', password: '', role: 'viewer' });
      loadMembers();
    } catch (e: any) { toast.error(e.message); }
  };

  const deleteMember = async (memberId: string, username: string) => {
    if (!window.confirm(`Remove "${username}"?`)) return;
    try {
      await api.deleteOrgMember(orgId, memberId);
      toast.success('Member removed');
      loadMembers();
    } catch (e: any) { toast.error(e.message); }
  };

  useEffect(() => {
    loadMembers();
    loadGrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return (
    <div>
      <OrgCard>
      {canAdmin(role) && (
        <form onSubmit={createMember} className="flex flex-wrap gap-2 mb-4">
          <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="username"
            className="flex-1 min-w-32 px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border outline-none focus:border-telegram-primary" />
          <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="password (min 4)"
            className="flex-1 min-w-32 px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border outline-none focus:border-telegram-primary" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            className="px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border">
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            {canAdmin(role) && <option value="admin">admin</option>}
            {role === 'owner' && <option value="owner">owner</option>}
          </select>
          <button type="submit" className="text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white">Add</button>
        </form>
      )}
      {membersLoading ? (
        <p className="text-sm text-telegram-subtext">Loading members…</p>
      ) : membersError ? (
        <div className="text-sm">
          <p className="text-red-500 mb-2">Failed to load members: {membersError}</p>
          <button onClick={loadMembers} className="px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">Retry</button>
        </div>
      ) : (
      <ul className="grid gap-1">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
            <span className="font-medium">{m.username}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-telegram-primary/10 text-telegram-primary">{m.role}</span>
            {canAdmin(role) && sessionMemberId !== m.id && (
              <button onClick={() => deleteMember(m.id, m.username)} className="ml-auto text-xs text-red-500 hover:underline">remove</button>
            )}
          </li>
        ))}
      </ul>
      )}
      {!membersLoading && !membersError && members.length === 0 && <p className="text-sm text-telegram-subtext">No members yet.</p>}
      <p className="text-xs text-telegram-subtext mt-3">viewer: read/download · editor: + upload/delete/folders · admin: + members/settings · owner: + admin accounts</p>
      {canAdmin(role) && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-telegram-subtext mb-2">Folder access overrides</h3>
          <p className="text-xs text-telegram-subtext mb-3">
            A grant replaces the member's org role for that folder only (view → list, read → + download, write → + upload/delete, full → everything). No grant = org role applies.
          </p>
          <form onSubmit={saveGrant} className="flex flex-wrap gap-2 mb-3">
            <select
              value={grantForm.member_id}
              onChange={(e) => setGrantForm({ ...grantForm, member_id: e.target.value })}
              className="flex-1 min-w-32 px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border"
            >
              <option value="">Member…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.username} ({m.role})</option>
              ))}
            </select>
            <select
              value={grantForm.folder_id}
              onChange={(e) => setGrantForm({ ...grantForm, folder_id: e.target.value })}
              className="flex-1 min-w-32 px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border"
            >
              <option value="">Folder…</option>
              <option value="0">Drive root</option>
              {folders.map((f: any) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select
              value={grantForm.level}
              onChange={(e) => setGrantForm({ ...grantForm, level: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border"
            >
              <option value="view">view</option>
              <option value="read">read</option>
              <option value="write">write</option>
              <option value="full">full</option>
            </select>
            <button type="submit" disabled={savingGrant} className="text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white disabled:opacity-50">
              {savingGrant ? 'Saving…' : 'Set access'}
            </button>
          </form>
          {grantsLoading ? (
            <p className="text-sm text-telegram-subtext">Loading grants…</p>
          ) : grantsError ? (
            <div className="text-sm">
              <p className="text-red-500 mb-2">Failed to load grants: {grantsError}</p>
              <button onClick={loadGrants} className="px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">Retry</button>
            </div>
          ) : grants.length === 0 ? (
            <p className="text-sm text-telegram-subtext">No overrides — every member uses their org role everywhere.</p>
          ) : (
            <ul className="grid gap-1">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                  <span className="font-medium">{memberName(g.member_id)}</span>
                  <span className="text-telegram-subtext">→ {folderName(g.folder_id)}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-telegram-primary/10 text-telegram-primary">{g.level}</span>
                  <button onClick={() => removeGrant(g.folder_id, g.member_id)} className="ml-auto text-xs text-red-500 hover:underline">remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </OrgCard>
    </div>
  );
}
