import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History } from 'lucide-react';

import { TelegramFile, BandwidthStats, FileClipboard, ViewSettings, FolderMetadata, QueueItem } from '../../types';
import { formatBytes } from '../../utils';
import * as api from '../../api';
import { useOrgAlerts } from '../../hooks/useOrgAlerts';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { TagsModal } from './TagsModal';
import { FileExplorer } from './FileExplorer';
import { UploadQueue } from './UploadQueue';
import { DownloadQueue } from './DownloadQueue';
import { useLock } from '../../context/LockContext';
import { MoveToFolderModal } from './MoveToFolderModal';
import { PromptModal, PromptRequest } from './PromptModal';
import { useConfirm } from '../../context/ConfirmContext';
import { VersionsModal } from './VersionsModal';
// Heavy editors/viewers (univer, tiptap, mammoth, pdfjs) are code-split so the
// initial bundle stays lean; they load on first preview/edit.
const FrameViewer = lazy(() => import('./FrameViewer').then((m) => ({ default: m.FrameViewer })));
const MediaPlayer = lazy(() => import('./MediaPlayer').then((m) => ({ default: m.MediaPlayer })));
const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));
const SheetEditor = lazy(() => import('./SheetEditor').then((m) => ({ default: m.SheetEditor })));
const DocEditor = lazy(() => import('./DocEditor').then((m) => ({ default: m.DocEditor })));
const SlideEditor = lazy(() => import('./SlideEditor').then((m) => ({ default: m.SlideEditor })));
const CommandPalette = lazy(() => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })));
import { getEditKind, getPreviewKind, getFileTypeCategory, EditKind } from '../../utils';
import { splitRelativePath, buildFolderIndex, childFolderKey } from '../../orgUpload';
import { useUploadEngine } from '../../hooks/useUploadEngine';
// NOTE: queue list-transitions live in uploadQueue.ts via the engine;
// Dashboard keeps only staging UI, selection handlers above delegate to it.
import { DragDropOverlay } from './DragDropOverlay';
import { SettingsModal } from './SettingsModal';
import { TransferLogs } from './TransferLogs';
import { PropertiesModal } from './PropertiesModal';
import { AllVersionsModal } from './AllVersionsModal';
import { StorageInsights } from './StorageInsights';
import { DuplicateFinder } from './DuplicateFinder';
import { LockScreen } from '../LockScreen';
import { OrgMembersPanel } from '../org/OrgMembersPanel';
import { OrgActivityPanel } from '../org/OrgActivityPanel';
import { OrgSettingsPanel } from '../org/OrgSettingsPanel';

// Simple keyboard shortcuts hook
function useKeyboardShortcuts(handlers: {
    onSelectAll: () => void;
    onDelete: () => void;
    onEscape: () => void;
    onSearch: () => void;
    onEnter: () => void;
    enabled: boolean;
}) {
    useEffect(() => {
        if (!handlers.enabled) return;
        const handleKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
            if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !isInput) {
                e.preventDefault();
                handlers.onSelectAll();
            } else if (e.key === 'Delete' && !isInput) {
                e.preventDefault();
                handlers.onDelete();
            } else if (e.key === 'Escape') {
                handlers.onEscape();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isInput) {
                e.preventDefault();
                handlers.onSearch();
            } else if (e.key === 'Enter' && !isInput) {
                handlers.onEnter();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [handlers]);
}

/**
 * Bounded-parallel map for bulk ops: N sequential API calls cost N slow round
 * trips; batches of 4 cost ~N/4. Returns the success count (failures resolve
 * false so one bad file never aborts the batch).
 */
async function poolCount<T>(items: T[], limit: number, fn: (item: T) => Promise<boolean>): Promise<number> {
    let ok = 0;
    for (let i = 0; i < items.length; i += limit) {
        const rs = await Promise.all(items.slice(i, i + limit).map((it) => fn(it).catch(() => false)));
        ok += rs.filter(Boolean).length;
    }
    return ok;
}

/**
 * Fetch + normalize one folder's rows, shared by the live folder query and
 * the sidebar hover prefetcher (same cache key, same shape).
 */
async function fetchFolderFiles(folderId: number | null): Promise<any[]> {
    const cacheKey = `files_cache:${folderId ?? 'root'}`;
    const res = await api.getFiles(folderId ?? undefined);
    const mapped = res.map((f: any) => ({
        ...f, sizeStr: formatBytes(f.size), type: f.icon_type || 'file'
    }));
    // Offline cache is a fallback, not an archive: skip huge lists
    // (multi-MB synchronous localStorage writes jank every fetch).
    try {
        if (mapped.length <= 500) localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), files: mapped }));
        else localStorage.removeItem(cacheKey);
    } catch {}
    return mapped;
}

export function Dashboard({ onLogout, onSwitchOrganization, topBanner, orgMode }: {
    onLogout: () => void; onSwitchOrganization?: () => void; topBanner?: React.ReactNode;
    orgMode?: { org: { id: string; name: string; subdomain: string }; session: { username: string; role: string; member_id: string } | null };
}) {
    const queryClient = useQueryClient();
    const showAdmin = !orgMode || !orgMode.session || ['admin', 'owner'].includes(orgMode.session.role);
    const [orgAdminView, setOrgAdminView] = useState<null | 'members' | 'activity' | 'settings'>(null);
    const { isLocked, hasPin, notificationMode, queueToast, setBusy, lock } = useLock();
    const orgId = api.getOrgContext();
    const { alerts, newCount: alertCount, clearNewCount, expired: alertsExpired } = useOrgAlerts(orgId);
    const [showAlerts, setShowAlerts] = useState(false);
    const [showInsights, setShowInsights] = useState(false);
    const [showDuplicates, setShowDuplicates] = useState(false);
    const alertsExpiredToastShown = useRef(false);
    useEffect(() => {
        if (alertsExpired && !alertsExpiredToastShown.current) {
            alertsExpiredToastShown.current = true;
            toast.warning('Org alerts unavailable — your org session may have expired. Re-login if alerts stay empty.');
        }
        if (!alertsExpired) alertsExpiredToastShown.current = false;
    }, [alertsExpired]);

    const toggleLock = () => {
        if (!hasPin) {
            // No PIN yet — open Settings so the user can set one.
            setShowSettingsModal(true);
            toast.info('Set a 4-digit PIN in Settings to enable dashboard locking');
            return;
        }
        if (!isLocked) {
            lock();
        }
        // When locked, the LockScreen overlay (rendered below) handles unlock.
    };
    // Shared encryption PIN cache so the uploader never prompts per file.
    const batchPinRef = useRef<{ pin: string | null | undefined }>({ pin: undefined });
    const safeToast = useCallback((type: 'success'|'error'|'info', msg: string) => {
        if (isLocked) {
            if (notificationMode === 'suppress') { queueToast(msg, type); return; }
            if (notificationMode === 'hide') { queueToast('New notification', type); return; }
        }
        (toast as any)[type](msg);
    }, [isLocked, notificationMode, queueToast]);
    const handleAuthError = useCallback((err: any) => {
        const msg = String(err?.message || err);
        if (msg.includes('Unauthorized') || msg.includes('Not authenticated') || msg.includes('not logged')) {
            safeToast('error', 'Session expired, please re-login');
            setTimeout(() => onLogout(), 1500);
            return true;
        }
        return false;
    }, [onLogout, safeToast]);

    const [folders, setFolders] = useState<FolderMetadata[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isConnected] = useState(true);
    const [userInfo, setUserInfo] = useState<any>(null);

    // Debounced list invalidation: batch uploads used to refetch the whole
    // file list once per file (N files = N full scans). Collapse bursts into
    // one trailing refetch.
    const filesInvalidateTimer = useRef<number | null>(null);
    const invalidateFilesSoon = useCallback(() => {
        if (filesInvalidateTimer.current) window.clearTimeout(filesInvalidateTimer.current);
        filesInvalidateTimer.current = window.setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
        }, 1500);
    }, [queryClient, activeFolderId]);
    useEffect(() => () => {
        if (filesInvalidateTimer.current) window.clearTimeout(filesInvalidateTimer.current);
    }, []);

    const [previewFile, setPreviewFile] = useState<TelegramFile | null>(null);
    const [viewSettings, setViewSettings] = useState<ViewSettings>({
        viewMode: 'grid', groupBy: 'none', showPreviewPane: false, sortField: 'name', sortDirection: 'asc'
    });
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchFilters, setSearchFilters] = useState({ file_type: '', min_size_mb: '', max_size_mb: '' });
    const [searchResults, setSearchResults] = useState<TelegramFile[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showActivityLog, setShowActivityLog] = useState(false);
    const [showAllVersions, setShowAllVersions] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
    const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
    const uploadFolderByItemRef = useRef<Map<string, number | undefined>>(new Map());
    const [previewContextFiles, setPreviewContextFiles] = useState<TelegramFile[]>([]);
    const [previewContextIndex, setPreviewContextIndex] = useState(-1);
    const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
    const [propertyFile, setPropertyFile] = useState<TelegramFile | null>(null);
    const [downloadQueue, setDownloadQueue] = useState<any[]>([]);
    // Shared parallel upload engine: queue state, slots, pause/resume,
    // cancel, retry, speed/ETA. Staging UI + per-file transfer (with
    // encryption) are injected via adapters below.
    const up = useUploadEngine<QueueItem>(
      {
        uploadOne: async (item, file, ctx) => {
          const toastId = isLocked ? null : toast.loading(`Uploading ${file.name}...`);
          const targetFolder = uploadFolderByItemRef.current.has(item.id)
            ? uploadFolderByItemRef.current.get(item.id)
            : (item.folderId ?? activeFolderId ?? undefined);
          try {
            let upFile: File = file;
            let encIv: string | undefined;
            try {
              const { isEncryptionEnabled, encryptFile, encName } = await import('../../lib/crypto');
              if (isEncryptionEnabled()) {
                const batchEnc = batchPinRef.current;
                if (batchEnc.pin === undefined) {
                  batchEnc.pin = window.prompt('Encryption ON — enter your lock PIN to encrypt ' + file.name + ' (applies to this batch)');
                }
                const pin = batchEnc.pin;
                if (!pin) {
                  batchEnc.pin = null;
                  throw new Error('Encryption cancelled — PIN required');
                }
                const buf = await file.arrayBuffer();
                const { blob, ivB64 } = await encryptFile(pin, buf);
                encIv = ivB64;
                upFile = new File([blob], encName(file.name), { type: 'application/octet-stream' });
              }
            } catch (e: any) { if (e?.message?.includes('cancelled')) throw e; }
            if (upFile.size > api.CHUNKED_UPLOAD_THRESHOLD) {
              await api.uploadFileChunked(upFile, targetFolder, {
                signal: ctx.signal,
                onProgress: (done, total) => ctx.onProgress(done, total),
                onUploadId: (id) => ctx.onUploadId(id),
                waitIfPaused: ctx.waitIfPaused,
                isCancelled: ctx.isCancelled,
                // Resume a previously interrupted chunked session (e.g. after
                // a page reload) instead of restarting from chunk 0.
                resumeUploadId: (item as any).uploadId,
              });
            } else {
              await api.uploadFile(upFile, targetFolder, { signal: ctx.signal });
            }
            if (encIv) {
              const m = JSON.parse(localStorage.getItem('enc_iv') || '{}');
              m[`${targetFolder ?? 'null'}:${upFile.name}`] = encIv;
              try { localStorage.setItem('enc_iv', JSON.stringify(m)); } catch {}
            }
            api.logActivity('upload', `folder:${targetFolder ?? 'root'}`, file.name).catch(()=>{});
          } finally {
            if (toastId) toast.dismiss(toastId);
          }
        },
        notifySuccess: (name) => {
          if (isLocked) queueToast(`${name} uploaded`, 'success');
          else toast.success(`${name} uploaded`);
        },
        notifyError: (name, message) => {
          if (isLocked) queueToast(`Failed: ${name} - ${message}`, 'error');
          else toast.error(`Failed: ${name} - ${message || 'error'}`);
        },
        notifyInfo: (msg) => {
          if (isLocked) queueToast(msg, 'info');
          else toast.info(msg);
        },
        notifyCancel: (name) => toast.info(`${name} upload cancelled`),
        onAuthError: (err) => handleAuthError(err),
        // Batch uploads fired one full list refetch PER file; debounce to a
        // single trailing refetch so an N-file batch costs 1 reload, not N.
        onItemDone: () => invalidateFilesSoon(),
        onManualStart: () => { batchPinRef.current = { pin: undefined }; },
        setBusy,
      },
      { maxParallel: 4 },
    );
    const uploadQueue = up.queue;
    const internalDragRef = useRef<number | null>(null);
    const [internalDragFileId, _setInternalDragFileId] = useState<number | null>(null);
    const setInternalDragFileId = (id: number | null) => {
        internalDragRef.current = id;
        _setInternalDragFileId(id);
    };

    // Persistence
    useEffect(() => {
        const s = localStorage.getItem('viewSettings');
        if (s) { try { setViewSettings(JSON.parse(s)); } catch {} }
        // Per-folder view memory: restore this folder's saved sort/group/mode
        const perFolder = localStorage.getItem(`td_view:${activeFolderId ?? 'root'}`);
        if (perFolder) { try { setViewSettings((prev) => ({ ...prev, ...JSON.parse(perFolder) })); } catch {} }
    }, [activeFolderId]);
    useEffect(() => {
        localStorage.setItem('viewSettings', JSON.stringify(viewSettings));
        // Persist the view-specific subset per folder (excluding transient pane flag)
        const { showPreviewPane, ...viewPrefs } = viewSettings;
        try { localStorage.setItem(`td_view:${activeFolderId ?? 'root'}`, JSON.stringify(viewPrefs)); } catch {}
    }, [viewSettings, activeFolderId]);

    // Load user info
    useEffect(() => { api.getUserInfo().then(setUserInfo).catch(() => {}); }, []);

    // Sync folders
    const syncFolders = useCallback(async () => {
        setIsSyncing(true);
        try { const r = await api.scanFolders(); setFolders(r); } catch { toast.error('Failed to sync folders'); }
        finally { setIsSyncing(false); }
    }, []);
    useEffect(() => { syncFolders(); }, [syncFolders]);

    const handleRefresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
    }, [queryClient, activeFolderId]);

    const [isOffline, setIsOffline] = useState(false);
    // File query with offline cache fallback (P1-4)
    const { data: allFiles = [], isLoading, error } = useQuery({
        queryKey: ['files', activeFolderId],
        // Keep the previous folder's list visible while the next one loads —
        // no full-page skeleton flash when navigating.
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const cacheKey = `files_cache:${activeFolderId ?? 'root'}`;
            try {
                const mapped = await fetchFolderFiles(activeFolderId);
                setIsOffline(false);
                return mapped;
            } catch (e) {
                try {
                    const raw = localStorage.getItem(cacheKey);
                    if (raw) {
                        const { files } = JSON.parse(raw);
                        setIsOffline(true);
                        return files;
                    }
                } catch {}
                throw e;
            }
        },
        enabled: activeFolderId !== -1,
        // Folder contents barely change except via our own mutations (which
        // invalidate explicitly): serve cached rows between navigations
        // instead of re-scanning the channel on every focus/mount.
        staleTime: 15000,
    });

    const { data: trashItems = [], isLoading: trashLoading, refetch: refetchTrash } = useQuery({
        queryKey: ['trash'],
        queryFn: () => api.getTrash().then(res => res.map((f: any) => ({
            ...f, id: f.message_id, name: f.name, size: f.size, sizeStr: formatBytes(f.size), type: 'file' as const, icon_type: 'file', folder_id: f.folder_id, deleted_at: f.deleted_at
        }))),
        enabled: activeFolderId === -1
    });

    const { data: favRows = [], refetch: refetchFav } = useQuery({
        queryKey: ['favorites'],
        queryFn: () => api.getFavorites(),
        enabled: activeFolderId === -2,
        staleTime: 10000,
    });
    const { data: recentRows = [] } = useQuery({
        queryKey: ['recent'],
        queryFn: () => api.getRecent(),
        enabled: activeFolderId === -3,
        staleTime: 10000,
    });
    const favFiles = useMemo(() => (favRows as any[]).map((f: any) => ({
        ...f, id: f.message_id ?? f.id, name: f.name || `file-${f.message_id ?? f.id}`,
        size: f.size || 0, sizeStr: formatBytes(f.size || 0), type: 'file' as const, icon_type: 'file',
        folder_id: f.folder_id ?? null, starred: true,
    })), [favRows]);
    const recentFiles = useMemo(() => (recentRows as any[]).map((f: any) => ({
        ...f, id: f.message_id ?? f.id, name: f.name || `file-${f.message_id ?? f.id}`,
        size: f.size || 0, sizeStr: formatBytes(f.size || 0), type: 'file' as const, icon_type: 'file',
        folder_id: f.folder_id ?? null, opened_at: f.opened_at,
    })), [recentRows]);

    const isSpecial = activeFolderId === -1 || activeFolderId === -2 || activeFolderId === -3;
    const subFolders = isSpecial ? [] : folders
        .filter(f => f.parent_id === activeFolderId)
        .map(f => ({ ...f, size: 0, sizeStr: "Folder", type: 'folder' as const, created_at: '', icon_type: 'folder' }));

    const combinedFiles = activeFolderId === -1 ? trashItems : activeFolderId === -2 ? favFiles : activeFolderId === -3 ? recentFiles : [...subFolders, ...allFiles];
    const displayedFiles = useMemo(() => (activeFolderId === -1 || activeFolderId === -2 || activeFolderId === -3) ? combinedFiles : (searchTerm.length > 2
        ? searchResults
        : combinedFiles.filter((f: any) => f.name.toLowerCase().includes(searchTerm.toLowerCase()))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [combinedFiles, searchTerm, searchResults, activeFolderId]);
    const isTrash = activeFolderId === -1;
    const trashLoadingCombined = isTrash ? trashLoading : isLoading;

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => api.getBandwidth(),
        // Stats ticker: was 5s (each tick = render + RPC). 15s is plenty.
        refetchInterval: 15000
    });

    // File operations
    const handleLogout = useCallback(async () => { await api.logout(); onLogout(); }, [onLogout]);
    const handleCreateFolder = useCallback(async (name: string, parentId?: number) => {
        const clean = name.trim();
        if (!clean) { toast.error('Folder name cannot be empty'); return; }
        try {
            const created: any = await api.createFolder(clean, parentId);
            // Optimistic UI: show the folder instantly with the given name
            // instead of waiting for the (slow) full rescan.
            if (created && typeof created.id === 'number') {
                const node: FolderMetadata = {
                    id: created.id,
                    name: created.name || clean,
                    parent_id: created.parent_id ?? parentId,
                };
                setFolders(prev => (prev.some(f => f.id === node.id) ? prev : [...prev, node]));
            }
            await syncFolders();
            toast.success(`Folder "${clean}" created`);
        } catch { toast.error('Failed to create folder'); }
    }, [syncFolders]);
    const handleFolderDelete = useCallback(async (id: number, name: string) => {
        try { await api.deleteFolder(id); await syncFolders(); toast.success(`"${name}" deleted`); } catch { toast.error('Failed'); }
    }, [syncFolders]);

    const handleRestore = useCallback(async (id: number, folder_id?: number) => {
        try { await api.restoreTrash(id, folder_id); toast.success('Restored'); refetchTrash(); queryClient.invalidateQueries({ queryKey: ['files'] }); } catch { toast.error('Restore failed'); }
    }, [refetchTrash, queryClient]);

    const handleEmptyTrash = useCallback(async () => {
        if (!window.confirm('Permanently delete all trashed files?')) return;
        try { await api.emptyTrash(); toast.success('Trash emptied'); refetchTrash(); } catch { toast.error('Empty failed'); }
    }, [refetchTrash]);

    const handlePurgeTrash = useCallback(async (id: number, folder_id?: number) => {
        if (!window.confirm('Permanently delete this file? It cannot be restored.')) return;
        try { await api.purgeTrash(id, folder_id); toast.success('Permanently deleted'); refetchTrash(); } catch { toast.error('Delete failed'); }
    }, [refetchTrash]);

    const handleDelete = useCallback(async (id: number) => {
        try {
            const file = displayedFiles.find(f => f.id === id);
            if (file?.type === 'folder') {
                await api.deleteFolder(id);
                queryClient.invalidateQueries({ queryKey: ['folders'] });
            } else {
                await api.deleteFile(id, activeFolderId ?? undefined);
                api.logActivity('delete', `folder:${activeFolderId ?? 'root'}`, file?.name).catch(()=>{});
            }
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            toast.success('Moved to Trash');
        } catch { toast.error('Delete failed'); }
    }, [activeFolderId, displayedFiles, queryClient]);

    const handleBulkDelete = useCallback(async () => {
        if (selectedIds.length === 0) return;
        const targets = selectedIds
            .map((id) => ({ id, file: displayedFiles.find(f => f.id === id) }))
            .filter((t): t is { id: number; file: any } => !!t.file);
        await poolCount(targets, 4, async ({ id, file }) => {
            try {
                if (file?.type === 'folder') await api.deleteFolder(id);
                else await api.deleteFile(id, activeFolderId ?? undefined);
                return true;
            } catch { return false; }
        });
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        toast.success(`Deleted ${selectedIds.length} items`);
    }, [selectedIds, activeFolderId, displayedFiles, queryClient]);

    const downloadControllers = useRef<Map<number, AbortController>>(new Map());

    const handleCancelAllDownloads = useCallback(() => {
        downloadControllers.current.forEach(c => { try { c.abort(); } catch {} });
        downloadControllers.current.clear();
    }, []);

    const handleBulkDownload = useCallback(async () => {
        for (const id of selectedIds) {
            const file = displayedFiles.find(f => f.id === id);
            if (!file) continue;
            const ctrl = new AbortController();
            downloadControllers.current.set(id, ctrl);
            setDownloadQueue(q => [...q.filter(x => x.id !== id), { id, name: file.name, status: 'downloading' as const }]);
            try {
                const blob = await api.downloadFile(activeFolderId ?? 0, id, { signal: ctrl.signal });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = file.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                // Deferred revoke: revoking synchronously can truncate the
                // save in some browsers.
                window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
                setDownloadQueue(q => q.map(x => x.id === id ? { ...x, status: 'success' as const, progress: 100 } : x));
                api.touchRecent(file.id, file.folder_id ?? activeFolderId ?? undefined, file.name, file.size).catch(()=>{});
                api.logActivity('download', `folder:${file.folder_id ?? activeFolderId ?? 'root'}`, file.name).catch(()=>{});
            } catch (e: any) {
                if (ctrl.signal.aborted || e?.name === 'AbortError') {
                    setDownloadQueue(q => q.map(x => x.id === id ? { ...x, status: 'cancelled' as const } : x));
                } else {
                    setDownloadQueue(q => q.map(x => x.id === id ? { ...x, status: 'error' as const, error: e?.message || 'Download failed' } : x));
                    toast.error(`Failed: ${file.name}`);
                }
            } finally {
                downloadControllers.current.delete(id);
            }
        }
    }, [selectedIds, displayedFiles, activeFolderId]);

    useEffect(() => {
        const controllers = downloadControllers.current;
        return () => {
            controllers.forEach(c => { try { c.abort(); } catch {} });
            controllers.clear();
        };
    }, []);

    const [tagFile, setTagFile] = useState<any | null>(null);
    const [versionsFile, setVersionsFile] = useState<any | null>(null);
    const [promptState, setPromptState] = useState<PromptRequest | null>(null);
    const { confirm } = useConfirm();
    const promptResolve = useRef<((v: string | null) => void) | null>(null);
    const askPrompt = useCallback(
        (req: PromptRequest) =>
            new Promise<string | null>(resolve => {
                promptResolve.current = resolve;
                setPromptState(req);
            }),
        []
    );
    const handlePromptSubmit = useCallback((v: string | null) => {
        setPromptState(null);
        promptResolve.current?.(v);
        promptResolve.current = null;
    }, []);
    const [editFile, setEditFile] = useState<{ file: any; kind: Exclude<EditKind, null> } | null>(null);
    const starredIds = new Set((favRows as any[]).map((x: any) => `${x.folder_id ?? 'null'}:${x.message_id ?? x.id}`));

    // In-built editors for word / excel / ppt / text
    const handleEdit = useCallback((file: any) => {
        if (String(file.name || '').endsWith('.enc')) { toast.error('Encrypted file — download to decrypt first'); return; }
        const kind = getEditKind(file.name || '');
        if (!kind) { toast.info('Editing is supported for Word (.docx), Excel (.xlsx/.xls/.csv), PowerPoint (.pptx) and text files'); return; }
        if (file.type === 'folder') return;
        setPreviewFile(null);
        setEditFile({ file, kind });
    }, []);

    const handleEditSaved = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['favorites'] });
        queryClient.invalidateQueries({ queryKey: ['recent'] });
    }, [queryClient]);

    const handleCancelUpload = useCallback((qid: string) => {
        up.cancelItem(qid);
    }, [up]);
    const handleCancelAllUploads = useCallback(() => {
        up.cancelAll();
    }, [up]);
    const handlePauseAllUploads = useCallback(() => { up.pauseAll(); }, [up]);
    const handleResumeAllUploads = useCallback(() => {
        up.resumeAll();
    }, [up]);

    const handleBulkMove = useCallback(async (targetFolderId: number | null) => {
        try {
            await api.moveFiles(selectedIds, [], activeFolderId ?? undefined, targetFolderId ?? undefined);
            setSelectedIds([]);
            setShowMoveModal(false);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            toast.success('Moved');
        } catch { toast.error('Move failed'); }
    }, [selectedIds, activeFolderId, queryClient]);

    const handleGlobalSearch = useCallback(async (q: string) => {
        try {
            // parse inline filters: type:pdf size>10MB size<100MB
            let query = q; let file_type = searchFilters.file_type || undefined;
            let min_size: number|undefined = searchFilters.min_size_mb ? parseFloat(searchFilters.min_size_mb)*1024*1024 : undefined;
            let max_size: number|undefined = searchFilters.max_size_mb ? parseFloat(searchFilters.max_size_mb)*1024*1024 : undefined;
            const tm = q.match(/type:(\w+)/i); if (tm) { file_type = tm[1].toLowerCase(); query = query.replace(tm[0], '').trim(); }
            const smax = q.match(/size<\s*(\d+(?:\.\d+)?)\s*(MB|GB|KB)?/i); if (smax) { const v = parseFloat(smax[1]); const u = (smax[2]||'MB').toUpperCase(); max_size = v*(u==='GB'?1024*1024*1024:u==='KB'?1024:1024*1024); query = query.replace(smax[0],'').trim(); }
            const smin = q.match(/size>\s*(\d+(?:\.\d+)?)\s*(MB|GB|KB)?/i); if (smin) { const v = parseFloat(smin[1]); const u = (smin[2]||'MB').toUpperCase(); min_size = v*(u==='GB'?1024*1024*1024:u==='KB'?1024:1024*1024); query = query.replace(smin[0],'').trim(); }
            return await api.searchFilesAdvanced(query || q, { file_type, min_size, max_size });
        } catch { return []; }
    }, [searchFilters]);

    const handleRename = useCallback(async (id: number, newName: string, isFolder: boolean) => {
        if (isFolder) {
            try { await api.renameFolder(id, newName); await syncFolders(); } catch { toast.error('Rename failed'); }
        }
    }, [syncFolders]);

    // P1-2: bulk star / tag / rename (folders support rename via API; files use star+tag)
    const handleBulkStar = useCallback(async (starred: boolean) => {
        if (selectedIds.length === 0) return;
        const targets = selectedIds
            .map((id) => ({ id, f: displayedFiles.find(x => x.id === id) }))
            .filter((t): t is { id: number; f: any } => !!t.f && t.f.type !== 'folder');
        const ok = await poolCount(targets, 4, async ({ id, f }) => {
            try { await api.starFile(id, (f as any).folder_id ?? activeFolderId ?? undefined, starred); return true; }
            catch { return false; }
        });
        refetchFav(); queryClient.invalidateQueries({ queryKey: ['favorites'] });
        api.logActivity(starred ? 'bulk-star' : 'bulk-unstar', `${ok} files`, undefined).catch(()=>{});
        toast.success(starred ? `Starred ${ok} file(s)` : `Unstarred ${ok} file(s)`);
    }, [selectedIds, displayedFiles, activeFolderId, refetchFav, queryClient]);

    const handleBulkTag = useCallback(async () => {
        if (selectedIds.length === 0) return;
        const tag = await askPrompt({
            title: 'Add tag',
            message: `Tag ${selectedIds.length} selected file(s). Lowercase, no spaces.`,
            placeholder: 'my-tag',
            confirmLabel: 'Add Tag',
        });
        if (!tag) return;
        const t = tag.trim().toLowerCase().replace(/\s+/g, '-');
        if (!t) return;
        const targets = selectedIds
            .map((id) => ({ id, f: displayedFiles.find(x => x.id === id) }))
            .filter((t0): t0 is { id: number; f: any } => !!t0.f && t0.f.type !== 'folder');
        const ok = await poolCount(targets, 4, async ({ id, f }) => {
            try {
                const cur = await api.getTags(id, (f as any).folder_id ?? undefined);
                if (!cur.includes(t)) await api.setTags(id, [...cur, t], (f as any).folder_id ?? undefined);
                return true;
            } catch { return false; }
        });
        api.logActivity('bulk-tag', t, `${ok} files`).catch(()=>{});
        toast.success(`Tagged ${ok} file(s) with #${t}`);
    }, [selectedIds, displayedFiles, activeFolderId, askPrompt]);

    const handleBulkRename = useCallback(async () => {
        const folderSel = selectedIds
            .map(id => displayedFiles.find(x => x.id === id))
            .filter((f): f is any => !!f && f.type === 'folder');
        if (folderSel.length === 0) { toast.info('Select one or more folders to bulk rename (files cannot be renamed via Telegram API)'); return; }
        const pattern = await askPrompt({
            title: 'Rename folders',
            message: `Rename ${folderSel.length} folder(s). Use {n} for a counter, e.g. "project-{n}".`,
            placeholder: 'project-{n}',
            confirmLabel: 'Rename',
        });
        if (!pattern) return;
        const ok = await poolCount(folderSel.map((f, i) => ({ f, i })), 4, async ({ f, i }) => {
            const name = pattern.includes('{n}') ? pattern.replace(/\{n\}/g, String(i + 1)) : (folderSel.length === 1 ? pattern : `${pattern} ${i + 1}`);
            try { await api.renameFolder(f.id, name); return true; }
            catch { return false; }
        });
        await syncFolders();
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        api.logActivity('bulk-rename', pattern, `${ok} folders`).catch(()=>{});
        toast.success(`Renamed ${ok} folder(s)`);
    }, [selectedIds, displayedFiles, activeFolderId, syncFolders, queryClient, askPrompt]);

    const handleCut = useCallback((ids: number[]) => {
        setClipboard({ type: 'cut', messageIds: ids, folderIds: [], sourceFolderId: activeFolderId, canPaste: true });
        toast.info(`${ids.length} item(s) cut to clipboard.`);
    }, [activeFolderId]);

    const handleCopy = useCallback((ids: number[]) => {
        setClipboard({ type: 'copy', messageIds: ids, folderIds: [], sourceFolderId: activeFolderId, canPaste: true });
        toast.info(`${ids.length} item(s) copied to clipboard.`);
    }, [activeFolderId]);

    const handlePaste = useCallback(async (targetFolderId?: number | null) => {
        if (!clipboard) return;
        try {
            if (clipboard.type === 'cut') {
                await api.moveFiles(clipboard.messageIds, clipboard.folderIds, clipboard.sourceFolderId ?? undefined, targetFolderId ?? undefined);
            } else {
                await api.copyFiles(clipboard.messageIds, clipboard.folderIds, clipboard.sourceFolderId ?? undefined, targetFolderId ?? undefined);
            }
            setClipboard(null);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            toast.success('Pasted');
        } catch { toast.error('Paste failed'); }
    }, [clipboard, activeFolderId, queryClient]);

    const handleShare = useCallback(async (file: any) => {
        try {
            const password = await askPrompt({
                title: 'Share file',
                message: `Create a 7-day link for "${file.name}". Optional password below (empty = open link).`,
                placeholder: 'Link password (optional)',
                confirmLabel: 'Copy link',
            });
            // Cancelled prompt returns null — abort without creating a link.
            if (password === null) return;
            const res: any = await api.createShare(
                file.id,
                file.folder_id ?? activeFolderId ?? undefined,
                7,
                password?.trim() || undefined,
            );
            const url = res.url || `${window.location.origin}/s/${res.token}`;
            await navigator.clipboard.writeText(url);
            toast.success(`Share link copied: ${url}`);
            api.logActivity('share', url, file.name).catch(()=>{});
        } catch (e: any) { toast.error(`Share failed: ${e.message}`); }
    }, [activeFolderId, askPrompt]);

    const handleStar = useCallback(async (file: any) => {
        const isFav = (favRows as any[]).some((x: any) => (x.message_id ?? x.id) === file.id && (x.folder_id ?? null) === (file.folder_id ?? null));
        // Optimistic: flip the cached favorites list immediately so the star
        // icon and the Starred view respond instantly; roll back on failure.
        queryClient.setQueryData(['favorites'], (old: any) => {
            const rows: any[] = Array.isArray(old) ? old : [];
            if (isFav) {
                return rows.filter((x: any) => !((x.message_id ?? x.id) === file.id && (x.folder_id ?? null) === (file.folder_id ?? null)));
            }
            return [...rows, {
                message_id: file.id,
                id: file.id,
                folder_id: file.folder_id ?? activeFolderId ?? null,
                name: file.name,
                size: file.size,
            }];
        });
        toast.success(isFav ? 'Removed from Starred' : 'Starred');
        try {
            await api.starFile(file.id, file.folder_id ?? activeFolderId ?? undefined, !isFav);
            refetchFav();
            api.logActivity(isFav ? 'unstar' : 'star', undefined, file.name).catch(()=>{});
        } catch (e: any) {
            toast.error(`Star failed: ${e.message}`);
            queryClient.invalidateQueries({ queryKey: ['favorites'] });
        }
    }, [activeFolderId, favRows, refetchFav, queryClient]);

    // Per-file transfer lives in the shared engine adapter (see the
    // useUploadEngine call above); retry just re-queues through the engine.
    const handleRetryUpload = useCallback((qid: string) => {
        up.retryItem(qid);
    }, [up]);

    const handleRetryAllFailed = useCallback(() => {
        up.retryAllFailed();
    }, [up]);

    // ---- Controllable staged uploads: checkbox select + per-file pause ----
    // Files are first STAGED (no network). User ticks checkboxes, then hits
    // "Upload selected". This gives full control over which files go when.
    // Starts, parallelism, pause/resume, and retries are owned by the shared
    // upload engine (useUploadEngine) — these wrappers only stage/select.
    const stageFilesForUpload = useCallback((fileList: File[], pathFn?: (f: File) => string) => {
        if (fileList.length === 0) return [] as string[];
        // Match re-selected files against interrupted chunked sessions so the
        // engine resumes from the last uploaded chunk instead of starting over.
        let pending: api.PendingUploadSession[] = [];
        try { pending = api.listResumableUploadSessions(); } catch { pending = []; }
        const matchSession = (f: File) => pending.find((s) => s.fileName === f.name && s.fileSize === f.size);
        const ids = up.stage(
          fileList.map((f) => {
            const rel = pathFn ? pathFn(f) : ((f as any).webkitRelativePath || f.name);
            const { dirs, fileName } = splitRelativePath(rel);
            const resume = matchSession(f);
            return {
              file: f,
              meta: {
                path: rel,
                name: fileName || f.name,
                size: f.size,
                folderId: activeFolderId,
                dirs,
                selected: true,
                ...(resume ? { uploadId: resume.uploadId } : {}),
              },
            };
          }),
        );
        const resumed = fileList.filter((f) => matchSession(f)).length;
        toast.info(
          resumed > 0
            ? `${fileList.length} file(s) staged — ${resumed} will resume from where they stopped`
            : `${fileList.length} file(s) staged — tick checkboxes, then hit Upload`,
        );
        return ids;
    }, [up, activeFolderId]);

    const handleStartSelectedUploads = useCallback(async (onlyIds?: string[]) => {
        const pending = up.queue.filter((x) =>
          (x.status === 'staged' || x.status === 'pending' || x.status === 'paused' || x.status === 'error')
          && x.selected !== false
          && (!onlyIds || onlyIds.includes(x.id)),
        );
        // Conflict check: warn before uploading files whose names already exist
        // in the target folder (backend keeps both, renaming the new copies).
        let queueToStart = pending;
        try {
          const existingNames = new Set(
            (activeFolderId === null || activeFolderId === undefined || activeFolderId >= 0
              ? allFiles
              : []
            ).map((f: any) => String(f.name || '').toLowerCase()),
          );
          const conflicts = pending.filter((x) => existingNames.has(String(x.name || '').toLowerCase()) && !(x as any).uploadId);
          if (conflicts.length > 0) {
            const preview = conflicts.slice(0, 5).map((c) => `• ${c.name}`).join('\n');
            const more = conflicts.length > 5 ? `\n…and ${conflicts.length - 5} more` : '';
            const proceed = await confirm({
              title: 'Files with these names already exist',
              message: `${conflicts.length} file(s) already exist in this folder:\n\n${preview}${more}\n\nUpload anyway (both copies are kept, new ones renamed), or skip those files?`,
              confirmText: 'Upload anyway',
              cancelText: 'Skip those',
            });
            if (!proceed) {
              const conflictIds = new Set(conflicts.map((c) => c.id));
              queueToStart = pending.filter((x) => !conflictIds.has(x.id));
            }
          }
        } catch {
          // Conflict check is best-effort; never block uploads on it.
        }
        const folderIndex = new Map<string, number>();
        try {
          const fresh = await api.scanFolders();
          for (const [k, v] of buildFolderIndex(fresh)) folderIndex.set(k, v);
          setFolders(fresh);
        } catch {}
        const createdDirs = new Map<string, number>();
        const dirBase = activeFolderId ?? 0;
        const resolveUploadFolder = async (dirs: string[]): Promise<number | undefined> => {
          if (!dirs || dirs.length === 0) return activeFolderId ?? undefined;
          let parent: number | undefined = activeFolderId ?? undefined;
          let path = `${dirBase}`;
          for (const dir of dirs) {
            path = `${path}/${dir}`;
            const cached = createdDirs.get(path);
            if (cached !== undefined) { parent = cached; continue; }
            const key = childFolderKey(parent, dir);
            let id = folderIndex.get(key);
            if (id === undefined) {
              try {
                const created: any = await api.createFolder(dir, parent);
                id = created?.id;
                if (typeof id === 'number') {
                  const createdId = id;
                  folderIndex.set(key, createdId);
                  setFolders((prev) => (prev.some((f) => f.id === createdId) ? prev : [...prev, {
                    id: createdId,
                    name: created?.name || dir,
                    parent_id: created?.parent_id ?? parent,
                  }]));
                }
              } catch {
                try {
                  const fresh = await api.scanFolders();
                  for (const [k, v] of buildFolderIndex(fresh)) folderIndex.set(k, v);
                  setFolders(fresh);
                  id = folderIndex.get(key);
                } catch {}
              }
            }
            if (id === undefined) {
              toast.error(`Could not create folder "${path}" — uploading to current folder`);
              return activeFolderId ?? undefined;
            }
            createdDirs.set(path, id);
            parent = id;
          }
          return parent;
        };
        uploadFolderByItemRef.current = new Map();
        for (const item of queueToStart) {
          const dirs = (item.dirs && item.dirs.length > 0)
            ? item.dirs
            : splitRelativePath(item.path || item.name || '').dirs;
          uploadFolderByItemRef.current.set(item.id, await resolveUploadFolder(dirs));
        }
        up.start(onlyIds);
    }, [up, activeFolderId]);

    // Checkbox works LIVE: staged/pending flips selection; unchecking a
    // RUNNING upload pauses it (frees a slot); checking a paused one queues it.
    const handleToggleUploadSelect = useCallback((qid: string) => {
        up.toggleSelect(qid);
    }, [up]);

    const handleSelectAllUploads = useCallback((select: boolean) => {
        up.selectAll(select);
    }, [up]);

    const handlePauseUploadItem = useCallback((qid: string) => {
        up.pauseItem(qid);
    }, [up]);

    const handleResumeUploadItem = useCallback((qid: string) => {
        up.resumeItem(qid);
    }, [up]);

    const handleRemoveUploadItem = useCallback((qid: string) => {
        up.removeItem(qid);
    }, [up]);

    // Upload entry points — STAGE only (no auto-upload). User controls via checkboxes.
    const handleManualUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true;
        input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            let fileList = Array.from(files);
            // P1-1: duplicate detector (same name + size in current folder)
            const existing = new Map((allFiles as any[]).filter((f: any) => f.type !== 'folder').map((f: any) => [`${f.name}::${f.size}`, f]));
            const dups = fileList.filter(f => existing.has(`${f.name}::${f.size}`));
            if (dups.length > 0) {
                const names = dups.slice(0, 3).map(f => f.name).join(', ') + (dups.length > 3 ? ` +${dups.length - 3} more` : '');
                const uploadAnyway = window.window.confirm(`${dups.length} file(s) already exist with same name + size:\n${names}\n\nOK = stage anyway (duplicates)\nCancel = skip duplicates`);
                if (!uploadAnyway) {
                    fileList = fileList.filter(f => !existing.has(`${f.name}::${f.size}`));
                    if (fileList.length === 0) { toast.info('Skipped duplicates — nothing staged'); return; }
                    toast.info(`Skipped ${dups.length} duplicate(s)`);
                }
            }
            stageFilesForUpload(fileList);
        };
        input.click();
    }, [allFiles, stageFilesForUpload]);

    const handleFolderUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        (input as any).webkitdirectory = true;
        input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            const fileList = Array.from(files);
            stageFilesForUpload(fileList, (f) => (f as any).webkitRelativePath || f.name);
        };
        input.click();
    }, [stageFilesForUpload]);

    const handleCameraUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        (input as any).capture = 'environment';
        input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files || files.length === 0) return;
            const file = files[0];
            const ids = stageFilesForUpload([file]);
            if (ids.length > 0) handleStartSelectedUploads(ids);
        };
        input.click();
    }, [stageFilesForUpload, handleStartSelectedUploads]);

    const handleDroppedFiles = useCallback(async (files: File[]) => {
        if (files.length === 0) return;
        stageFilesForUpload(files);
    }, [stageFilesForUpload]);

    // View settings
    const onUpdateViewSettings = useCallback((s: Partial<ViewSettings>) => {
        setViewSettings(prev => ({ ...prev, ...s }));
    }, []);

    // Selection
    const handleSelectAll = useCallback(() => {
        setSelectedIds(displayedFiles.map(f => f.id));
    }, [displayedFiles]);
    const lastClickedId = useRef<number | null>(null);
    const handleFileClick = useCallback((e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) {
            setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
            lastClickedId.current = id;
        } else if (e.shiftKey) {
            // Shift+click: range-select between the last anchor and this file
            const anchor = lastClickedId.current ?? id;
            const a = displayedFiles.findIndex(f => f.id === anchor);
            const b = displayedFiles.findIndex(f => f.id === id);
            if (a !== -1 && b !== -1) {
                const [lo, hi] = a <= b ? [a, b] : [b, a];
                setSelectedIds(displayedFiles.slice(lo, hi + 1).map(f => f.id));
            } else {
                setSelectedIds([id]);
            }
        } else {
            setSelectedIds([id]);
            lastClickedId.current = id;
        }
    }, [displayedFiles]);
    const handleToggleSelection = useCallback((id: number) => {
        setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }, []);

    const openBuiltInPreview = useCallback((file: TelegramFile) => {
        const kind = getPreviewKind(file);
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
        if (kind === 'video' || kind === 'audio') setPlayingFile(file);
        else if (kind === 'pdf') setPdfFile(file);
        else setPreviewFile(file);
    }, []);

    const prefetchFolder = useCallback((id: number | null) => {
        if (id === activeFolderId || id === -1 || id === -2 || id === -3) return;
        queryClient.prefetchQuery({
            queryKey: ['files', id],
            queryFn: () => fetchFolderFiles(id),
            staleTime: 15000,
        }).catch(() => { /* fire-and-forget: navigation fetches for real */ });
    }, [activeFolderId, queryClient]);

    const handlePreview = useCallback((file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        const contextFiles = (orderedFiles || displayedFiles).filter(f => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex(f => f.id === file.id);
        setPreviewContextFiles(contextFiles);
        setPreviewContextIndex(contextIndex);
        api.touchRecent(file.id, (file as any).folder_id ?? activeFolderId ?? undefined, file.name, (file as any).size).catch(()=>{});
        openBuiltInPreview(file);
    }, [displayedFiles, activeFolderId, openBuiltInPreview]);

    const navigatePreview = useCallback((step: 1 | -1) => {
        if (previewContextFiles.length === 0) return;
        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) return;
        const currentIndex = previewContextFiles.findIndex(f => f.id === currentFileId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + step + previewContextFiles.length) % previewContextFiles.length;
        const nextFile = previewContextFiles[nextIndex];
        if (!nextFile) return;
        setPreviewContextIndex(nextIndex);
        openBuiltInPreview(nextFile);
    }, [previewContextFiles, previewFile, playingFile, pdfFile, openBuiltInPreview]);
    const handleNextPreview = useCallback(() => navigatePreview(1), [navigatePreview]);
    const handlePrevPreview = useCallback(() => navigatePreview(-1), [navigatePreview]);

    const previewNeighborFiles = useCallback(() => {
        if (previewContextFiles.length === 0) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        const currentFileId = previewFile?.id;
        if (!currentFileId) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        const currentIdx = previewContextFiles.findIndex(f => f.id === currentFileId);
        if (currentIdx === -1) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        return {
            nextFile: previewContextFiles[(currentIdx + 1) % previewContextFiles.length] || null,
            prevFile: previewContextFiles[(currentIdx - 1 + previewContextFiles.length) % previewContextFiles.length] || null,
        };
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    // Drag & drop onto folders
    const handleDropOnFolder = useCallback(async (e: React.DragEvent, targetFolderId: number | null) => {
        e.preventDefault(); e.stopPropagation();
        if (activeFolderId === targetFolderId) return;
        const fileId = internalDragRef.current;
        if (fileId) {
            try {
                const idsToMove = selectedIds.includes(fileId) ? selectedIds : [fileId];
                await api.moveFiles(idsToMove, [], activeFolderId ?? undefined, targetFolderId ?? undefined);
                queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
                if (selectedIds.includes(fileId)) setSelectedIds([]);
                toast.success(`Moved ${idsToMove.length} file(s)`);
            } catch { toast.error('Failed to move file(s)'); }
            setInternalDragFileId(null);
        }
    }, [activeFolderId, selectedIds, queryClient]);

    // Search
    useEffect(() => {
        if (searchTerm.length <= 2 && !searchFilters.file_type && !searchFilters.min_size_mb && !searchFilters.max_size_mb) { setSearchResults([]); return; }
        const timer = setTimeout(async () => {
            setIsSearching(true);
            const results = await handleGlobalSearch(searchTerm);
            setSearchResults(results);
            setIsSearching(false);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, searchFilters, handleGlobalSearch]);

    // Reset on folder change
    useEffect(() => {
        setSelectedIds([]); setShowMoveModal(false); setSearchTerm(""); setSearchResults([]);
        setPreviewFile(null); setPlayingFile(null); setPdfFile(null);
        setPreviewContextFiles([]); setPreviewContextIndex(-1);
    }, [activeFolderId]);

    // Keyboard shortcuts
    const handleKeyboardDelete = useCallback(() => { if (selectedIds.length > 0) handleBulkDelete(); }, [selectedIds, handleBulkDelete]);
    const handleEscape = useCallback(() => { setSelectedIds([]); setSearchTerm(""); setPreviewFile(null); setPlayingFile(null); setPdfFile(null); }, []);
    const handleFocusSearch = useCallback(() => {
        const el = document.querySelector('input[placeholder="Search files..."]') as HTMLInputElement;
        if (el) { el.focus(); el.select(); }
    }, []);
    const handleEnter = useCallback(() => {
        if (selectedIds.length === 1) {
            const selected = displayedFiles.find(f => f.id === selectedIds[0]);
            if (selected) {
                if (selected.type === 'folder') setActiveFolderId(selected.id);
                else handlePreview(selected, displayedFiles);
            }
        }
    }, [selectedIds, displayedFiles, handlePreview]);

    useKeyboardShortcuts({
        onSelectAll: handleSelectAll, onDelete: handleKeyboardDelete,
        onEscape: handleEscape, onSearch: handleFocusSearch, onEnter: handleEnter,
        enabled: !previewFile && !playingFile && !pdfFile && !showMoveModal
    });

    // Global ⌘K / Ctrl+K toggles the command palette
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setShowCommandPalette((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Auto-retry failed uploads once the connection comes back. Manual retry
    // still works; this only covers the "network blipped, user did nothing"
    // case so a long batch doesn't sit half-failed.
    useEffect(() => {
        const onOnline = () => {
            const failed = up.queue.filter((x) => x.status === 'error');
            if (failed.length > 0) {
                toast.info(`Back online — retrying ${failed.length} failed upload(s)`);
                up.retryAllFailed();
            }
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [up]);

    // Resumable upload sessions found after a reload: offer one-click resume.
    const [resumableSessions, setResumableSessions] = useState<api.PendingUploadSession[]>([]);
    useEffect(() => {
        try {
            const sessions = api.listResumableUploadSessions();
            setResumableSessions(sessions.filter((s) => s.fileSize > api.CHUNKED_UPLOAD_THRESHOLD));
        } catch {
            setResumableSessions([]);
        }
    }, []);
    const dismissResumable = useCallback((uploadId: string) => {
        api.removeUploadSession(uploadId);
        setResumableSessions((prev) => prev.filter((s) => s.uploadId !== uploadId));
    }, []);

    // Batch download selected files as one ZIP (client-side, capped)
    const handleDownloadSelectedZip = useCallback(async () => {
        const targets = displayedFiles.filter((f) => selectedIds.includes(f.id) && f.type !== 'folder');
        if (targets.length === 0) return;
        if (targets.length > 25) { toast.error('ZIP download is capped at 25 files — select fewer.'); return; }
        const totalBytes = targets.reduce((s, f) => s + (f.size || 0), 0);
        if (totalBytes > 100 * 1024 * 1024) { toast.error('ZIP download is capped at 100 MB total — select smaller files.'); return; }
        const toastId = toast.loading(`Preparing ZIP 0/${targets.length}…`);
        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            const used = new Set<string>();
            for (let i = 0; i < targets.length; i++) {
                const f = targets[i];
                toast.loading(`Preparing ZIP ${i + 1}/${targets.length} — ${f.name}`, { id: toastId });
                let blob: Blob;
                try {
                    blob = await api.downloadFile(((f as any).folder_id ?? activeFolderId ?? 0) as number, f.id);
                } catch {
                    blob = await fetch(api.getPreviewUrl(((f as any).folder_id ?? activeFolderId ?? 0), f.id)).then((r) => {
                        if (!r.ok) throw new Error('fetch failed');
                        return r.blob();
                    });
                }
                let name = f.name || `file-${f.id}`;
                if (used.has(name)) {
                    const dot = name.lastIndexOf('.');
                    const base = dot > 0 ? name.slice(0, dot) : name;
                    const ext = dot > 0 ? name.slice(dot) : '';
                    let n = 2;
                    while (used.has(`${base} (${n})${ext}`)) n++;
                    name = `${base} (${n})${ext}`;
                }
                used.add(name);
                zip.file(name, blob);
            }
            toast.loading('Compressing…', { id: toastId });
            const out = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(out);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cloudsphere-files-${new Date().toISOString().slice(0, 10)}.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 8000);
            toast.success(`ZIP downloaded (${targets.length} files, ${formatBytes(out.size)})`, { id: toastId });
        } catch (e: any) {
            toast.error(`ZIP failed: ${e?.message || e}`, { id: toastId });
        }
    }, [displayedFiles, selectedIds, activeFolderId]);

    const isDragging = false; // simplified for web
    const currentFolderName = activeFolderId === null ? "Saved Messages" : folders.find(f => f.id === activeFolderId)?.name || "Folder";
    const previewNeighbors = previewNeighborFiles();

    // P1-3: storage stats for current folder (files only). Memoized: the
    // old IIFE re-ran on every render (including upload-progress ticks).
    const folderStats = useMemo(() => {
        if (isSpecial) return null;
        const filesOnly = (allFiles as any[]).filter((f: any) => f.type !== 'folder');
        const bytes = filesOnly.reduce((s: number, f: any) => s + (f.size || 0), 0);
        const byType: Record<string, number> = {};
        for (const f of filesOnly) {
            const cat = getFileTypeCategory(f.name || '');
            byType[cat] = (byType[cat] || 0) + 1;
        }
        return { count: filesOnly.length + subFolders.length, fileCount: filesOnly.length, folderCount: subFolders.length, bytes, byType };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSpecial, allFiles, subFolders]);

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
            className="flex h-screen w-full overflow-hidden bg-dynamic-mesh relative"
            onClick={() => setSelectedIds([])}
        >
            {topBanner}
            <AnimatePresence>
                {showMoveModal && <MoveToFolderModal folders={folders} onClose={() => setShowMoveModal(false)} onSelect={handleBulkMove} activeFolderId={activeFolderId} key="move-modal" />}
                {promptState && (
                    <PromptModal
                        key="prompt-modal"
                        title={promptState.title}
                        message={promptState.message}
                        placeholder={promptState.placeholder}
                        confirmLabel={promptState.confirmLabel}
                        defaultValue={promptState.defaultValue}
                        maxLength={promptState.maxLength}
                        onSubmit={handlePromptSubmit}
                    />
                )}
                {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} key="settings-modal" />}
                <Suspense fallback={null}>
                    <CommandPalette
                        open={showCommandPalette}
                        onClose={() => setShowCommandPalette(false)}
                        folders={folders}
                        selectedCount={selectedIds.length}
                        onOpenFolder={(id) => setActiveFolderId(id)}
                        onPreviewFile={(f) => handlePreview(f, displayedFiles)}
                        onManualUpload={handleManualUpload}
                        onFolderUpload={handleFolderUpload}
                        onSettings={() => setShowSettingsModal(true)}
                        onStarred={() => setActiveFolderId(-2)}
                        onRecent={() => setActiveFolderId(-3)}
                        onTrash={() => setActiveFolderId(-1)}
                        onActivity={() => setShowActivityLog(true)}
                        onVersions={() => setShowAllVersions(true)}
                        onDownloadSelectedZip={handleDownloadSelectedZip}
                    />
                </Suspense>
                {showActivityLog && <TransferLogs onClose={() => setShowActivityLog(false)} key="activity-modal" />}
                {showAllVersions && <AllVersionsModal onClose={() => setShowAllVersions(false)} key="all-versions-modal" />}
                {propertyFile && <PropertiesModal file={propertyFile} onClose={() => setPropertyFile(null)} key="props-modal" />}
            </AnimatePresence>

<Sidebar
        folders={folders} activeFolderId={activeFolderId} setActiveFolderId={(id) => { setOrgAdminView(null); setActiveFolderId(id); }} stats={folderStats}
        onPrefetchFolder={prefetchFolder}
        onDrop={handleDropOnFolder} onDelete={handleFolderDelete} onCreate={handleCreateFolder}
        onRename={(id, name) => handleRename(id, name, true)}
        onCut={(id) => { setClipboard({ type: 'cut', messageIds: [], folderIds: [id], sourceFolderId: activeFolderId, canPaste: true }); toast.info('Folder cut to clipboard.'); }}
        onCopy={(id) => { setClipboard({ type: 'copy', messageIds: [], folderIds: [id], sourceFolderId: activeFolderId, canPaste: true }); toast.info('Folder copied to clipboard.'); }}
        onPaste={(targetId) => handlePaste(targetId)}
        canPaste={!!clipboard}
        onProperties={(id) => {
            if (id === null) setPropertyFile({ id: 0, name: "Saved Messages", type: 'folder', icon_type: 'folder' } as any);
            else { const f = folders.find(folder => folder.id === id); if (f) setPropertyFile({ ...f, type: 'folder', icon_type: 'folder' } as any); }
        }}
        isSyncing={isSyncing} isConnected={isConnected} userInfo={userInfo}
        onSync={syncFolders} onRefresh={handleRefresh} onLogout={handleLogout} onSwitchOrganization={onSwitchOrganization}
        onSettings={() => setShowSettingsModal(true)} bandwidth={bandwidth || null}
        onActivityLog={() => setShowActivityLog(!showActivityLog)}
        onAllVersions={() => setShowAllVersions(true)}
        orgHeader={orgMode ? { name: orgMode.org.name, detail: `${orgMode.org.subdomain} · ${orgMode.session ? `${orgMode.session.username} (${orgMode.session.role})` : 'master admin'}` } : undefined}
        adminViews={orgMode && showAdmin ? [{ id: 'members', label: 'Members' }, { id: 'activity', label: 'Activity' }, { id: 'settings', label: 'Settings' }] : undefined}
        activeAdminView={orgAdminView}
        onSelectAdminView={(id) => setOrgAdminView(id)}
    />

            {/* Floating buttons */}
            <button onClick={() => setShowActivityLog(true)} className="fixed bottom-6 left-72 z-40 p-3 bg-telegram-surface border border-telegram-border rounded-full shadow-lg hover:bg-telegram-hover text-telegram-secondary transition-all hover:scale-110 group" title="Activity Log">
                <History className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            </button>

            <main className="flex-1 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds([]); }}>
                <TopBar
                    selectedIds={selectedIds} onShowMoveModal={() => setShowMoveModal(true)}
                    onBulkDownload={handleBulkDownload} onBulkDelete={handleBulkDelete}
                    onBulkStar={handleBulkStar} onBulkTag={handleBulkTag} onBulkRename={handleBulkRename}
                    onManualUpload={handleManualUpload} onFolderUpload={handleFolderUpload} onCameraUpload={handleCameraUpload}
                    onCreateFolder={async () => {
                        const name = await askPrompt({
                            title: 'Create folder',
                            message: `New folder inside "${currentFolderName}".`,
                            placeholder: 'Folder name',
                            confirmLabel: 'Create',
                        });
                        // Special views (Trash/Starred/Recent = -1/-2/-3) are not
                        // real parents — fall back to root instead of a bogus id.
                        const parent = activeFolderId != null && activeFolderId >= 0
                            ? activeFolderId
                            : undefined;
                        if (name) await handleCreateFolder(name, parent);
                    }}
                    onPaste={() => handlePaste()} onCut={handleCut} onCopy={handleCopy}
                    canPaste={!!clipboard} viewSettings={viewSettings}
                    onUpdateViewSettings={onUpdateViewSettings}
                    searchTerm={searchTerm} onSearchChange={setSearchTerm}
                    searchFilters={searchFilters} onSearchFiltersChange={setSearchFilters}
                    onToggleLock={toggleLock}
                    isLocked={isLocked}
                    hasPin={hasPin}
                    alertCount={alertCount}
                    onOpenInsights={() => setShowInsights(true)}
                    onOpenDuplicates={() => setShowDuplicates(true)}
                    onOpenAlerts={orgId ? () => {
                        setShowAlerts(v => !v);
                        clearNewCount();
                    } : undefined}
                />
                {showAlerts && orgId && (
                    <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowAlerts(false)} />
                    <div className="fixed top-16 right-4 z-50 w-80 max-h-96 overflow-auto glass-strong rounded-xl shadow-2xl border border-telegram-border p-2">
                        <div className="flex items-center justify-between px-2 py-1">
                            <p className="text-xs font-bold uppercase tracking-widest text-telegram-subtext">Org alerts</p>
                            <button onClick={() => setShowAlerts(false)} className="text-xs text-telegram-subtext hover:text-telegram-text">Close</button>
                        </div>
                        {alerts.length === 0 ? (
                            <p className="text-xs text-telegram-subtext px-2 py-4 text-center">No recent org activity</p>
                        ) : alerts.slice(0, 20).map((a: any) => (
                            <div key={a.id || `${a.action}-${a.created_at}`} className="px-2 py-1.5 rounded-lg hover:bg-telegram-hover">
                                <p className="text-xs font-medium text-telegram-text">{String(a.action || '').replace('org.', '')}</p>
                                <p className="text-[11px] text-telegram-subtext truncate">
                                    {[a.target_type, a.target_id].filter(Boolean).join(': ')}
                                    {a.created_at ? ` • ${new Date(a.created_at).toLocaleString()}` : ''}
                                </p>
                            </div>
                        ))}
                    </div>
                    </>
                )}
                {showInsights && (
                    <StorageInsights
                        folderId={activeFolderId}
                        folderName={currentFolderName}
                        onClose={() => setShowInsights(false)}
                    />
                )}
                {showDuplicates && (
                    <DuplicateFinder
                        folderId={activeFolderId}
                        onClose={() => setShowDuplicates(false)}
                        onTrashChanged={() => {
                            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
                            refetchTrash();
                        }}
                    />
                )}
                {isOffline && !isSpecial && (
                    <div className="px-4 pt-2">
                        <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-300 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                            Offline — showing last cached files. Reconnect to refresh.
                        </div>
                    </div>
                )}
                {(orgMode && orgAdminView) ? (
                    <div className="flex-1 p-4 overflow-auto">
                        {orgAdminView === 'members' && <OrgMembersPanel orgId={orgMode.org.id} role={orgMode.session?.role || 'owner'} sessionMemberId={orgMode.session?.member_id || null} folders={folders} />}
                        {orgAdminView === 'activity' && <OrgActivityPanel orgId={orgMode.org.id} />}
                        {orgAdminView === 'settings' && <OrgSettingsPanel orgId={orgMode.org.id} role={orgMode.session?.role || 'owner'} />}
                    </div>
                ) : isTrash ? (
                    <div className="flex-1 p-4 overflow-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-bold text-telegram-text uppercase tracking-widest flex items-center gap-2">Trash <span className="bg-telegram-primary/20 text-telegram-primary px-2 py-0.5 rounded-full text-xs">{trashItems.length}</span></h2>
                            {trashItems.length > 0 && <button onClick={handleEmptyTrash} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-semibold border border-red-500/20">Empty Trash</button>}
                        </div>
                        {trashLoadingCombined ? <div className="flex justify-center p-8"><div className="w-6 h-6 border-2 border-telegram-primary border-t-transparent rounded-full animate-spin" /></div>
                        : trashItems.length === 0 ? <div className="text-center py-12 text-telegram-subtext"><p>Trash is empty</p><p className="text-xs mt-1">Deleted files will appear here for 30 days</p></div>
                        : <div className="space-y-1">
                            {trashItems.map((f: any) => (
                                <div key={f.id} className="flex items-center gap-3 p-3 bg-telegram-surface border border-telegram-border rounded-xl hover:bg-telegram-hover transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-telegram-text truncate">{f.name}</p>
                                        <p className="text-xs text-telegram-subtext">{f.sizeStr} • Deleted {f.deleted_at ? new Date(f.deleted_at).toLocaleDateString() : ''}</p>
                                    </div>
                                    <button onClick={() => handleRestore(f.id, f.folder_id)} className="px-3 py-1.5 bg-telegram-primary/20 hover:bg-telegram-primary/30 text-telegram-primary rounded-lg text-xs font-semibold">Restore</button>
                                    <button onClick={() => handlePurgeTrash(f.id, f.folder_id)} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-semibold">Delete forever</button>
                                </div>
                            ))}
                          </div>
                        }
                    </div>
                ) : (
                <>
                {searchTerm.length > 2 && (
                    <div className="px-6 pt-4 pb-0">
                        <h2 className="text-sm font-medium text-telegram-subtext">
                            Search Results for <span className="text-telegram-primary">"{searchTerm}"</span>
                        </h2>
                    </div>
                )}
                <FileExplorer
                    files={displayedFiles} loading={trashLoadingCombined || isSearching} error={error}
                    viewSettings={viewSettings} onUpdateViewSettings={onUpdateViewSettings}
                    selectedIds={selectedIds} activeFolderId={activeFolderId}
                    onFileClick={handleFileClick} onDelete={handleDelete}
                    onDownload={(id, name) => { handleBulkDownload(); }}
                    onPreview={handlePreview} onManualUpload={handleManualUpload} onFolderUpload={handleFolderUpload}
                    handleDroppedFiles={handleDroppedFiles} onSelectionClear={() => setSelectedIds([])}
                    onToggleSelection={handleToggleSelection} onDrop={handleDropOnFolder}
                    onDragStart={(fileId) => setInternalDragFileId(fileId)}
                    onDragEnd={() => setTimeout(() => setInternalDragFileId(null), 50)}
                    onRename={handleRename} onCut={handleCut} onCopy={handleCopy}
                    onMove={() => setShowMoveModal(true)} onShare={handleShare} onEdit={handleEdit} onVersions={(f)=>setVersionsFile(f)} onStar={handleStar} starredIds={starredIds} onTags={(f)=>setTagFile(f)} onPaste={() => handlePaste()}
                    canPaste={!!clipboard} onOpenFolder={(id) => setActiveFolderId(id)}
                    folders={folders}
                    onProperties={(file) => {
                        if (!file) setPropertyFile({ id: activeFolderId || 0, name: currentFolderName, type: 'folder', icon_type: 'folder' } as any);
                        else setPropertyFile(file);
                    }}
                />
                </>
                )}
            </main>

            {tagFile && <TagsModal file={tagFile} onClose={() => setTagFile(null)} />}

            {versionsFile && (
                <VersionsModal
                    file={versionsFile}
                    activeFolderId={activeFolderId}
                    onClose={() => setVersionsFile(null)}
                    onRestored={() => {
                        queryClient.invalidateQueries({ queryKey: ['files'] });
                        refetchTrash();
                    }}
                />
            )}

            {previewFile && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">Loading preview…</div>}>
                    <FrameViewer file={previewFile} activeFolderId={activeFolderId} onClose={() => setPreviewFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} onEdit={() => previewFile && handleEdit(previewFile)} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} />
                </Suspense>
            )}
            {playingFile && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">Loading media…</div>}>
                    <MediaPlayer file={playingFile} activeFolderId={(playingFile as any).folder_id ?? activeFolderId} onClose={() => setPlayingFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} />
                </Suspense>
            )}
            {pdfFile && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">Loading PDF…</div>}>
                    <PdfViewer file={pdfFile} activeFolderId={(pdfFile as any).folder_id ?? activeFolderId} onClose={() => setPdfFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} />
                </Suspense>
            )}

            {editFile?.kind === 'sheet' && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">Loading editor…</div>}>
                    <SheetEditor file={editFile.file} activeFolderId={activeFolderId} onClose={() => setEditFile(null)} onSaved={handleEditSaved} />
                </Suspense>
            )}
            {(editFile?.kind === 'doc' || editFile?.kind === 'text') && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">Loading editor…</div>}>
                    <DocEditor file={editFile.file} activeFolderId={activeFolderId} onClose={() => setEditFile(null)} onSaved={handleEditSaved} />
                </Suspense>
            )}
            {editFile?.kind === 'slide' && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-sm text-white">Loading editor…</div>}>
                    <SlideEditor file={editFile.file} activeFolderId={activeFolderId} onClose={() => setEditFile(null)} onSaved={handleEditSaved} />
                </Suspense>
            )}

            <UploadQueue items={uploadQueue} paused={up.pausedAll} onClearFinished={() => up.clearFinished()} onCancelAll={handleCancelAllUploads} onCancelItem={handleCancelUpload} onPauseAll={handlePauseAllUploads} onResumeAll={handleResumeAllUploads} onRetryItem={handleRetryUpload} onRetryAllFailed={handleRetryAllFailed} onToggleSelect={handleToggleUploadSelect} onSelectAll={handleSelectAllUploads} onStartSelected={() => handleStartSelectedUploads()} onPauseItem={handlePauseUploadItem} onResumeItem={handleResumeUploadItem} onRemoveItem={handleRemoveUploadItem} maxParallel={up.maxParallel} onMaxParallelChange={up.setMaxParallel} />

            {/* Interrupted chunked uploads found after a reload */}
            {resumableSessions.length > 0 && (
                <div className="fixed bottom-4 left-4 z-50 max-w-sm glass-strong rounded-xl border border-telegram-border shadow-2xl p-4">
                    <div className="flex items-start gap-3">
                        <History className="w-4 h-4 text-telegram-primary mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-telegram-text">
                                {resumableSessions.length} interrupted upload{resumableSessions.length > 1 ? 's' : ''}
                            </p>
                            <p className="text-xs text-telegram-subtext mt-0.5">
                                These files were partway through uploading. Re-select them to resume from where they stopped.
                            </p>
                            <ul className="mt-2 space-y-1">
                                {resumableSessions.slice(0, 4).map((s) => (
                                    <li key={s.uploadId} className="flex items-center gap-2 text-xs text-telegram-subtext">
                                        <span className="truncate flex-1" title={s.fileName}>{s.fileName}</span>
                                        <span className="text-telegram-muted shrink-0">
                                            {Math.round((s.uploadedChunks.length / Math.max(1, s.totalChunks)) * 100)}%
                                        </span>
                                        <button
                                            onClick={() => dismissResumable(s.uploadId)}
                                            className="text-telegram-muted hover:text-red-400 shrink-0"
                                            title="Dismiss"
                                        >
                                            ✕
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <button
                                onClick={() => {
                                    resumableSessions.forEach((s) => dismissResumable(s.uploadId));
                                    toast.info('Cleared interrupted upload records');
                                }}
                                className="mt-2 text-xs px-2.5 py-1 rounded-lg bg-telegram-hover text-telegram-subtext hover:text-telegram-text transition-colors"
                            >
                                Dismiss all
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <DownloadQueue items={downloadQueue} onClearFinished={() => setDownloadQueue(q => q.filter((i: any) => i.status !== 'success' && i.status !== 'error'))} onCancelAll={() => { handleCancelAllDownloads(); setDownloadQueue(q => q.map((i: any) => (i.status === 'downloading' || i.status === 'pending') ? { ...i, status: 'cancelled' as const } : i)); }} />
            {isLocked && <LockScreen />}
        </motion.div>
    );
}
