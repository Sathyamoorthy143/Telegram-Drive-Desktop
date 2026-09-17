import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, LogOut, Files, Trash2, Users, Activity, Settings, RotateCcw, XCircle, FolderPlus, Upload, FolderOpen } from 'lucide-react';
import * as api from '../../api';
import type { OrgMember, AuditEntry } from '../../types';

interface Props {
  org: { id: string; name: string; subdomain: string };
  session: { username: string; role: string; member_id: string } | null;
  onLogout: () => void;
  onBack?: () => void;
}

type Tab = 'files' | 'trash' | 'members' | 'activity' | 'settings';

const canEdit = (role: string) => ['editor', 'admin', 'owner'].includes(role);
const canAdmin = (role: string) => ['admin', 'owner'].includes(role);

export function OrgAdminDashboard({ org, session, onLogout, onBack }: Props) {
  const role = session?.role || 'owner'; // master bypass acts as owner
  const [tab, setTab] = useState<Tab>('files');
  const [files, setFiles] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [trash, setTrash] = useState<any[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [storage, setStorage] = useState<{ provisioned: boolean; main_channel_id?: number; backup_channel_id?: number } | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = async () => {
    try {
      const [f, fl] = await Promise.all([api.getOrgFiles(org.id), api.scanOrgFolders(org.id)]);
      setFiles(f);
      setFolders(fl);
    } catch (e: any) {
      toast.error(`Files: ${e.message}`);
    }
  };

  const loadTrash = async () => {
    try { setTrash(await api.getOrgTrash(org.id)); }
    catch (e: any) { toast.error(`Trash: ${e.message}`); }
  };

  const loadMembers = async () => {
    try { setMembers(await api.getOrgMembers(org.id)); }
    catch (e: any) { toast.error(`Members: ${e.message}`); }
  };

  const loadActivity = async () => {
    try { setActivity(await api.getOrgActivity(org.id)); }
    catch (e: any) { toast.error(`Activity: ${e.message}`); }
  };

  const loadStorage = async () => {
    try { setStorage(await api.getOrgStorageStatus(org.id)); }
    catch { setStorage(null); }
  };

  useEffect(() => {
    loadFiles();
    loadStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  useEffect(() => {
    if (tab === 'trash') loadTrash();
    if (tab === 'members') loadMembers();
    if (tab === 'activity') loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const logout = async () => {
    try { await api.orgLogout(org.id); } catch {}
    api.setOrgToken(null);
    if (!session) api.setOrgId(null);
    onLogout();
  };

  const deleteFile = async (message_id: number, folder_id?: number) => {
    if (!window.confirm('Move this file to the org trash?')) return;
    try {
      await api.deleteOrgFile(org.id, message_id, folder_id);
      toast.success('Moved to org trash');
      loadFiles();
    } catch (e: any) { toast.error(e.message); }
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolder.trim()) return;
    try {
      await api.createOrgFolder(org.id, newFolder.trim());
      toast.success(`Folder "${newFolder.trim()}" created`);
      setNewFolder('');
      loadFiles();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      await api.uploadOrgFile(org.id, selectedFile);
      toast.success(`Uploaded "${selectedFile.name}"`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadFiles();
    } catch (e: any) { toast.error(e.message); }
    setUploading(false);
  };

  const restoreItem = async (message_id: number, folder_id?: number) => {
    try {
      await api.restoreOrgTrash(org.id, message_id, folder_id);
      toast.success('Restored');
      loadTrash();
    } catch (e: any) { toast.error(e.message); }
  };

  const purgeItem = async (message_id: number, folder_id?: number) => {
    if (!window.confirm('Permanently delete? Cannot be restored.')) return;
    try {
      await api.purgeOrgTrash(org.id, message_id, folder_id);
      toast.success('Permanently deleted');
      loadTrash();
    } catch (e: any) { toast.error(e.message); }
  };

  const createMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username.trim() || newUser.password.length < 4) {
      toast.error('Username required, password min 4 chars');
      return;
    }
    try {
      await api.createOrgMember(org.id, newUser.username.trim(), newUser.password, newUser.role);
      toast.success(`"${newUser.username}" added as ${newUser.role}`);
      setNewUser({ username: '', password: '', role: 'viewer' });
      loadMembers();
    } catch (e: any) { toast.error(e.message); }
  };

  const deleteMember = async (memberId: string, username: string) => {
    if (!window.confirm(`Remove "${username}"?`)) return;
    try {
      await api.deleteOrgMember(org.id, memberId);
      toast.success('Member removed');
      loadMembers();
    } catch (e: any) { toast.error(e.message); }
  };

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'files', label: 'Files', icon: Files },
    { id: 'trash', label: 'Trash', icon: Trash2 },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-telegram-border bg-telegram-surface">
        {onBack && (
          <button onClick={onBack} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">{org.name}</h1>
          <p className="text-xs text-telegram-subtext">
            {org.subdomain} · {session ? `${session.username} (${session.role})` : 'master admin (acting as owner)'}
          </p>
        </div>
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${tab === t.id ? 'bg-telegram-primary text-white' : 'hover:bg-telegram-hover'}`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </nav>
<button onClick={logout} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Sign out">
            <LogOut className="w-4 h-4" />
        </button>
        <button onClick={() => { window.location.href = `/${org.subdomain}`; }} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Open full Dashboard">
            <FolderOpen className="w-4 h-4" />
        </button>
    </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto">
          {tab === 'files' && (
            <div>
              {storage && !storage.provisioned && (
                <p className="text-sm text-yellow-600 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
                  Organization not provisioned yet — ask the master admin to provision Telegram channels before files appear.
                </p>
              )}
              {canEdit(role) && (
                <form onSubmit={createFolder} className="flex gap-2 mb-4">
                  <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="New folder name"
                    className="flex-1 px-3 py-2 text-sm rounded-lg bg-telegram-surface border border-telegram-border outline-none focus:border-telegram-primary" />
                  <button type="submit" className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white">
                    <FolderPlus className="w-4 h-4" /> Create
                  </button>
                </form>
              )}
              {canEdit(role) && (
                <div className="flex items-center gap-2 mb-4">
                  <input ref={fileInputRef} type="file" onChange={handleFileSelect}
                    className="text-sm text-telegram-subtext file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border file:border-telegram-border file:bg-telegram-surface file:text-telegram-primary" />
                  <button onClick={uploadFile} disabled={!selectedFile || uploading}
                    className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white disabled:opacity-50 disabled:cursor-not-allowed">
                    <Upload className="w-4 h-4" /> {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
              )}
              {folders.length > 0 && (
                <>
                  <h2 className="text-sm font-medium text-telegram-subtext mb-2">Folders</h2>
                  <ul className="grid gap-1 mb-4">
                    {folders.map((f: any) => (
                      <li key={f.id} className="text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">📁 {f.name}</li>
                    ))}
                  </ul>
                </>
              )}
              <h2 className="text-sm font-medium text-telegram-subtext mb-2">Files</h2>
              {files.length === 0 ? (
                <p className="text-sm text-telegram-subtext">No files yet.</p>
              ) : (
                <ul className="grid gap-1">
                  {files.map((f: any) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                      <span className="flex-1 truncate">{f.name}</span>
                      {canEdit(role) && (
                        <button onClick={() => deleteFile(f.id, f.folder_id)} className="text-xs text-red-500 hover:underline">trash</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'trash' && (
            <div>
              <h2 className="text-sm font-medium text-telegram-subtext mb-2">Org trash (separate from Telegram recycle bin)</h2>
              {trash.length === 0 ? (
                <p className="text-sm text-telegram-subtext">Trash is empty.</p>
              ) : (
                <ul className="grid gap-1">
                  {trash.map((t: any, i: number) => (
                    <li key={t.id || i} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                      <span className="flex-1 truncate">{t.name || `file-${t.message_id}`}</span>
                      {canEdit(role) && (
                        <>
                          <button onClick={() => restoreItem(t.message_id, t.folder_id)} className="flex items-center gap-1 text-xs text-telegram-primary hover:underline">
                            <RotateCcw className="w-3 h-3" /> restore
                          </button>
                          <button onClick={() => purgeItem(t.message_id, t.folder_id)} className="flex items-center gap-1 text-xs text-red-500 hover:underline">
                            <XCircle className="w-3 h-3" /> purge
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'members' && (
            <div>
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
              <ul className="grid gap-1">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                    <span className="font-medium">{m.username}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-telegram-primary/10 text-telegram-primary">{m.role}</span>
                    {canAdmin(role) && session?.member_id !== m.id && (
                      <button onClick={() => deleteMember(m.id, m.username)} className="ml-auto text-xs text-red-500 hover:underline">remove</button>
                    )}
                  </li>
                ))}
              </ul>
              {members.length === 0 && <p className="text-sm text-telegram-subtext">No members yet.</p>}
              <p className="text-xs text-telegram-subtext mt-3">viewer: read/download · editor: + upload/delete/folders · admin: + members/settings · owner: + admin accounts</p>
            </div>
          )}

          {tab === 'activity' && (
            <div>
              <h2 className="text-sm font-medium text-telegram-subtext mb-2">Audit log — who / what / when</h2>
              {activity.length === 0 ? (
                <p className="text-sm text-telegram-subtext">No activity yet.</p>
              ) : (
                <ul className="grid gap-1">
                  {activity.map((a, i) => (
                    <li key={a.id || i} className="text-xs px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                      <span className="font-medium text-sm">{a.action}</span>
                      <span className="text-telegram-subtext">
                        {a.target_type ? ` · ${a.target_type}:${a.target_id}` : ''} · {a.created_at || ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div className="text-sm">
              <h2 className="text-sm font-medium text-telegram-subtext mb-2">Org settings</h2>
              <div className="p-4 rounded-xl bg-telegram-surface border border-telegram-border space-y-1">
                <p>Main channel: <span className="font-mono">{storage?.main_channel_id ?? '—'}</span></p>
                <p>Backup channel: <span className="font-mono">{storage?.backup_channel_id ?? '—'}</span></p>
                <p>Status: {storage?.provisioned ? 'provisioned' : 'not provisioned'}</p>
              </div>
              {!canAdmin(role) && <p className="text-xs text-telegram-subtext mt-2">Only org admins can change settings.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
