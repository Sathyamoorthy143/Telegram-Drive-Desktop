import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, LogOut, Files, Trash2, Users, Activity, Settings, RotateCcw, XCircle, FolderPlus, Upload, FolderOpen, HardDrive, X } from 'lucide-react';
import * as api from '../../api';
import type { OrgMember, AuditEntry } from '../../types';
import { stagedUploads, needsChunkedUpload, splitRelativePath, buildFolderIndex, childFolderKey, isPreviewableImage } from '../../orgUpload';

function OrgImageThumb({ orgId, folderId, messageId, name }: { orgId: string; folderId?: number; messageId: number; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const boxRef = useRef<HTMLSpanElement>(null);
  // Only fetch once scrolled into view — a page of thumbnails must not
  // stampede the backend (and the shared Telegram connection) on mount.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    api.downloadOrgFileBlob(orgId, folderId, messageId, { signal: ctrl.signal }).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((e: any) => {
      if (cancelled || e?.name === 'AbortError') return;
      setFailed(true);
    });
    return () => {
      cancelled = true;
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orgId, folderId, messageId, visible, attempt]);
  if (failed) {
    return (
      <button
        onClick={() => setAttempt((n) => n + 1)}
        title={`Preview failed — click to retry (${name})`}
        className="w-10 h-10 shrink-0 rounded-lg bg-telegram-hover hover:bg-telegram-border flex items-center justify-center text-sm"
      >
        🔁
      </button>
    );
  }
  if (!url) return <span ref={boxRef} className="w-10 h-10 shrink-0 rounded-lg bg-telegram-hover animate-pulse" />;
  return <img src={url} alt={name} loading="lazy" className="w-10 h-10 shrink-0 rounded-lg object-cover border border-telegram-border" />;
}
import type { OrgUploadItem } from '../../orgUpload';
import { useUploadEngine, type EngineStatus } from '../../hooks/useUploadEngine';

type UploadItem = Omit<OrgUploadItem, 'file' | 'status'> & { status: EngineStatus };

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
  const [orgSettings, setOrgSettings] = useState<any | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ notification_mode: '', lock_interval_ms: '' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer' });
  const [activeFolderId, setActiveFolderId] = useState<number | undefined>(undefined);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderByItemRef = useRef<Map<string, number | undefined>>(new Map());
  const engine = useUploadEngine<UploadItem>(
    {
      uploadOne: async (item, file, ctx) => {
        const folderId = folderByItemRef.current.get(item.id);
        if (needsChunkedUpload(file.size, api.CHUNKED_UPLOAD_THRESHOLD)) {
          await api.uploadOrgFileChunked(org.id, file, folderId, {
            signal: ctx.signal,
            onProgress: (done, total) => ctx.onProgress(done, total),
          });
        } else {
          await api.uploadOrgFile(org.id, file, folderId, { signal: ctx.signal });
        }
      },
      notifySuccess: (name) => toast.success(`Uploaded "${name}"`),
      notifyError: (name, message) => toast.error(`Upload failed: ${name || message}`),
      notifyInfo: (msg) => toast.info(msg),
    },
    { maxParallel: 3, autoClearSuccessMs: 0 },
  );
  const uploadQueue = engine.queue;
  const uploading = uploadQueue.some((x) =>
    x.status === 'staged' || x.status === 'pending' || x.status === 'uploading' || x.status === 'paused',
  );

  const loadFiles = async (folderId?: number) => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const [f, fl] = await Promise.all([api.getOrgFiles(org.id, folderId), api.scanOrgFolders(org.id)]);
      setFiles(f);
      setFolders(fl);
    } catch (e: any) {
      setFilesError(e.message || 'Failed to load files');
    } finally {
      setFilesLoading(false);
    }
  };

  const visibleFolders = folders.filter((f: any) => (f.parent_id ?? undefined) === activeFolderId);

  const folderTrail = (() => {
    const byId = new Map<number, any>(folders.map((f: any) => [f.id, f]));
    const trail: any[] = [];
    let cur = activeFolderId;
    let guard = 0;
    while (cur !== undefined && guard++ < 32) {
      const f = byId.get(cur);
      if (!f) break;
      trail.unshift(f);
      cur = f.parent_id ?? undefined;
    }
    return trail;
  })();

  const downloadFile = async (message_id: number, folder_id: number | undefined, name: string) => {
    setDownloadingId(message_id);
    try {
      const blob = await api.downloadOrgFileBlob(org.id, folder_id, message_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e: any) {
      toast.error(`Download failed: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const [grants, setGrants] = useState<api.OrgFolderGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState({ member_id: '', folder_id: '', level: 'view' });
  const [savingGrant, setSavingGrant] = useState(false);

  const loadGrants = async () => {
    setGrantsLoading(true);
    setGrantsError(null);
    try { setGrants(await api.getOrgGrants(org.id)); }
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
      await api.setOrgGrant(org.id, Number(grantForm.folder_id), grantForm.member_id, grantForm.level);
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
      await api.deleteOrgGrant(org.id, folder_id, member_id);
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

  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadTrash = async () => {
    setTrashLoading(true);
    setTrashError(null);
    try { setTrash(await api.getOrgTrash(org.id)); }
    catch (e: any) { setTrashError(e.message || 'Failed to load trash'); }
    finally { setTrashLoading(false); }
  };

  const loadMembers = async () => {
    setMembersLoading(true);
    setMembersError(null);
    try { setMembers(await api.getOrgMembers(org.id)); }
    catch (e: any) { setMembersError(e.message || 'Failed to load members'); }
    finally { setMembersLoading(false); }
  };

  const loadActivity = async () => {
    setActivityLoading(true);
    setActivityError(null);
    try { setActivity(await api.getOrgActivity(org.id)); }
    catch (e: any) { setActivityError(e.message || 'Failed to load activity'); }
    finally { setActivityLoading(false); }
  };

  const loadStorage = async () => {
    try { setStorage(await api.getOrgStorageStatus(org.id)); }
    catch { setStorage(null); }
    try {
      const s = await api.getOrgSettings(org.id);
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
      const s = await api.updateOrgSettings(org.id, patch);
      setOrgSettings(s);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    setActiveFolderId(undefined);
    loadStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  useEffect(() => {
    loadFiles(activeFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, activeFolderId]);

  useEffect(() => {
    if (tab === 'trash') loadTrash();
    if (tab === 'members') { loadMembers(); loadGrants(); }
    if (tab === 'activity') loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const logout = async () => {
    try { await api.orgLogout(org.id); } catch {}
    api.setOrgToken(null, org.id);
    if (!session) api.setOrgId(null);
    onLogout();
  };

  const deleteFile = async (message_id: number, folder_id?: number) => {
    if (!window.confirm('Move this file to the org trash?')) return;
    try {
      await api.deleteOrgFile(org.id, message_id, folder_id);
      toast.success('Moved to org trash');
      loadFiles(activeFolderId);
    } catch (e: any) { toast.error(e.message); }
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolder.trim()) return;
    try {
      await api.createOrgFolder(org.id, newFolder.trim(), activeFolderId);
      toast.success(`Folder "${newFolder.trim()}" created`);
      setNewFolder('');
      loadFiles(activeFolderId);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    engine.stage(
      Array.from(fileList).map((f) => ({
        file: f,
        meta: { name: f.name, dirs: [] as string[], size: f.size },
      })),
    );
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    engine.stage(
      Array.from(fileList).map((f) => {
        const rel = (f as any).webkitRelativePath || f.name;
        return {
          file: f,
          meta: { name: rel, dirs: splitRelativePath(rel).dirs, size: f.size },
        };
      }),
    );
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const removeUploadItem = (id: string) => {
    engine.removeItem(id);
  };

  const clearFinishedUploads = () => {
    engine.clearFinished();
  };

  // Refresh the file list once a run fully settles (engine is fire-and-forget).
  const settledRef = useRef(false);
  useEffect(() => {
    const busy = uploadQueue.some(
      (x) => x.status === 'staged' || x.status === 'pending' || x.status === 'uploading' || x.status === 'paused',
    );
    if (uploadQueue.length > 0 && !busy) {
      if (!settledRef.current) {
        settledRef.current = true;
        loadFiles(activeFolderId);
      }
    } else {
      settledRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadQueue]);

  const runUploads = async () => {
    const pending = stagedUploads(uploadQueue);
    if (pending.length === 0) return;
    // Folder lookup for recreating folder-upload structure server-side.
    const folderIndex = new Map<string, number>();
    try {
      const fresh = await api.scanOrgFolders(org.id);
      for (const [k, v] of buildFolderIndex(fresh)) folderIndex.set(k, v);
    } catch {}
    const createdDirs = new Map<string, number>();
    const dirBase = activeFolderId ?? 0;
    const resolveUploadFolder = async (dirs: string[]): Promise<number | undefined> => {
      if (dirs.length === 0) return activeFolderId;
      let parent: number | undefined = activeFolderId;
      let path = `${dirBase}`;
      for (const dir of dirs) {
        path = `${path}/${dir}`;
        const cached = createdDirs.get(path);
        if (cached !== undefined) { parent = cached; continue; }
        const key = childFolderKey(parent, dir);
        let id = folderIndex.get(key);
        if (id === undefined) {
          try {
            const created: any = await api.createOrgFolder(org.id, dir, parent);
            id = created?.id;
            if (id !== undefined) folderIndex.set(key, id);
          } catch {
            // Create raced or failed — re-scan once, then fall back to root.
            try {
              const fresh = await api.scanOrgFolders(org.id);
              for (const [k, v] of buildFolderIndex(fresh)) folderIndex.set(k, v);
              id = folderIndex.get(key);
            } catch {}
          }
        }
        if (id === undefined) {
          toast.error(`Could not create folder "${path}" — uploading to root`);
          return undefined;
        }
        createdDirs.set(path, id);
        parent = id;
      }
      return parent;
    };
    // Resolve target folders sequentially first so parallel workers never
    // race creating the same directory twice. The engine reads them back
    // per item inside its upload adapter.
    folderByItemRef.current = new Map<string, number | undefined>();
    for (const item of pending) {
      folderByItemRef.current.set(item.id, await resolveUploadFolder(item.dirs));
    }
    engine.start();
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
    ...(canAdmin(role)
      ? [
          { id: 'members' as Tab, label: 'Members', icon: Users },
          { id: 'settings' as Tab, label: 'Settings', icon: Settings },
        ]
      : []),
    { id: 'activity', label: 'Activity', icon: Activity },
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
        {!session && (
          <button onClick={() => { window.location.href = '/'; }} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title="Master dashboard">
            <FolderOpen className="w-4 h-4" />
          </button>
        )}
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
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect}
                    className="hidden" />
                  <input ref={folderInputRef} type="file" multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={handleFolderSelect}
                    className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white disabled:opacity-50">
                    <Upload className="w-4 h-4" /> Upload Files
                  </button>
                  <button onClick={() => folderInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg border border-telegram-border hover:bg-telegram-hover disabled:opacity-50">
                    <FolderPlus className="w-4 h-4" /> Upload Folder
                  </button>
                  {uploadQueue.length > 0 && (
                    <button onClick={runUploads} disabled={uploading}
                      className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg bg-telegram-primary text-white disabled:opacity-50">
                      <HardDrive className="w-4 h-4" /> {uploading ? 'Uploading…' : `Upload ${uploadQueue.length} item${uploadQueue.length > 1 ? 's' : ''}`}
                    </button>
                  )}
                  {uploadQueue.length > 0 && (
                    <button onClick={clearFinishedUploads}
                      className="flex items-center gap-1 text-sm px-4 py-2 rounded-lg border border-telegram-border hover:bg-telegram-hover">
                      <X className="w-4 h-4" /> Clear done
                    </button>
                  )}
                </div>
              )}
              {uploadQueue.length > 0 && (
                <div className="mb-4 space-y-1">
                  {uploadQueue.map(item => (
                    <div key={item.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                      <div className="flex-1 min-w-0">
                        <span className="truncate block">{item.name}</span>
                        {item.status === 'uploading' && (
                          <div className="w-full bg-telegram-hover rounded-full h-1 mt-1">
                            <div className="bg-telegram-primary h-1 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                          </div>
                        )}
                        {item.status === 'error' && <span className="text-xs text-red-500">{item.error}</span>}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        item.status === 'success' ? 'bg-green-500/20 text-green-500' :
                        item.status === 'uploading' ? 'bg-telegram-primary/20 text-telegram-primary' :
                        item.status === 'error' ? 'bg-red-500/20 text-red-500' :
                        item.status === 'cancelled' ? 'bg-yellow-500/20 text-yellow-500' :
                        'bg-telegram-hover text-telegram-subtext'
                      }`}>
                        {item.status === 'success' ? 'done' : item.status === 'uploading' ? `${item.progress}%` : item.status}
                      </span>
                      {item.status !== 'uploading' && (
                        <button onClick={() => removeUploadItem(item.id)} className="text-xs text-red-500 hover:underline">remove</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <nav className="flex items-center gap-1 text-sm mb-3 flex-wrap" aria-label="Folder breadcrumb">
                <button
                  onClick={() => setActiveFolderId(undefined)}
                  className={`px-2 py-1 rounded-md ${activeFolderId === undefined ? 'font-semibold text-telegram-text' : 'text-telegram-primary hover:underline'}`}
                >
                  Root
                </button>
                {folderTrail.map((f: any) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <span className="text-telegram-subtext">/</span>
                    <button
                      onClick={() => setActiveFolderId(f.id)}
                      className={`px-2 py-1 rounded-md ${f.id === activeFolderId ? 'font-semibold text-telegram-text' : 'text-telegram-primary hover:underline'}`}
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              </nav>
              {visibleFolders.length > 0 && (
                <>
                  <h2 className="text-sm font-medium text-telegram-subtext mb-2">Folders</h2>
                  <ul className="grid gap-1 mb-4">
                    {visibleFolders.map((f: any) => (
                      <li key={f.id}>
                        <button
                          onClick={() => setActiveFolderId(f.id)}
                          className="w-full text-left text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border hover:border-telegram-primary"
                        >
                          📁 {f.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h2 className="text-sm font-medium text-telegram-subtext mb-2">Files</h2>
              {filesLoading ? (
                <p className="text-sm text-telegram-subtext">Loading files…</p>
              ) : filesError ? (
                <div className="text-sm">
                  <p className="text-red-500 mb-2">Failed to load files: {filesError}</p>
                  <button onClick={() => loadFiles(activeFolderId)} className="px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">Retry</button>
                </div>
              ) : files.length === 0 ? (
                <p className="text-sm text-telegram-subtext">No files yet.</p>
              ) : (
                <ul className="grid gap-1">
                  {files.map((f: any) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
                      {isPreviewableImage(f.name, f.mime_type) && (
                        <OrgImageThumb orgId={org.id} folderId={f.folder_id} messageId={f.id} name={f.name} />
                      )}
                      <span className="flex-1 truncate">{f.name}</span>
                      <button
                        onClick={() => downloadFile(f.id, f.folder_id, f.name)}
                        disabled={downloadingId === f.id}
                        className="text-xs text-telegram-primary hover:underline disabled:opacity-50"
                      >
                        {downloadingId === f.id ? 'downloading…' : 'download'}
                      </button>
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
              {trashLoading ? (
                <p className="text-sm text-telegram-subtext">Loading trash…</p>
              ) : trashError ? (
                <div className="text-sm">
                  <p className="text-red-500 mb-2">Failed to load trash: {trashError}</p>
                  <button onClick={loadTrash} className="px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">Retry</button>
                </div>
              ) : trash.length === 0 ? (
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
                    {canAdmin(role) && session?.member_id !== m.id && (
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
            </div>
          )}

          {tab === 'activity' && (
            <div>
              <h2 className="text-sm font-medium text-telegram-subtext mb-2">Audit log — who / what / when</h2>
              {activityLoading ? (
                <p className="text-sm text-telegram-subtext">Loading activity…</p>
              ) : activityError ? (
                <div className="text-sm">
                  <p className="text-red-500 mb-2">Failed to load activity: {activityError}</p>
                  <button onClick={loadActivity} className="px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">Retry</button>
                </div>
              ) : activity.length === 0 ? (
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
