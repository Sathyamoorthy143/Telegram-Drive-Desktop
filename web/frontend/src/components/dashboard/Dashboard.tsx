import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History, Bot } from 'lucide-react';

import { TelegramFile, BandwidthStats, FileClipboard, ViewSettings, FolderMetadata } from '../../types';
import { formatBytes } from '../../utils';
import * as api from '../../api';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { TagsModal } from './TagsModal';
import { FileExplorer } from './FileExplorer';
import { UploadQueue } from './UploadQueue';
import { DownloadQueue } from './DownloadQueue';
import { useLock } from '../../context/LockContext';
import { MoveToFolderModal } from './MoveToFolderModal';
import { PromptModal, PromptRequest } from './PromptModal';
import { VersionsModal } from './VersionsModal';
import { FrameViewer } from './FrameViewer';
import { SheetEditor } from './SheetEditor';
import { DocEditor } from './DocEditor';
import { SlideEditor } from './SlideEditor';
import { getEditKind, EditKind } from '../../utils';
import { DragDropOverlay } from './DragDropOverlay';
import { SettingsModal } from './SettingsModal';
import { TransferLogs } from './TransferLogs';
import { PropertiesModal } from './PropertiesModal';
import { AiAssistant } from './AiAssistant';

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

export function Dashboard({ onLogout }: { onLogout: () => void }) {
    const queryClient = useQueryClient();
    const { isLocked, notificationMode, queueToast, setBusy } = useLock();
    const [uploadsPaused, setUploadsPaused] = useState(false);
    const uploadsPausedRef = useRef(false);
    const uploadControllers = useRef<Map<string, AbortController>>(new Map());
    // per-file speedometer: {last sample time, bytes done, smoothed B/s}
    const speedRef = useRef<Map<string, { t: number; done: number; speed: number }>>(new Map());

    // Compulsory speed + ETA readout: called on every progress event (XHR for
    // single POST, chunk completions for resumable). Speed is EMA-smoothed and
    // re-sampled at most every 250ms so the numbers don't jitter.
    const reportProgress = useCallback((qid: string, done: number, total: number) => {
        const now = Date.now();
        const prev = speedRef.current.get(qid);
        let speed = prev?.speed ?? 0;
        if (prev && now - prev.t >= 250 && done > prev.done) {
            const inst = ((done - prev.done) / (now - prev.t)) * 1000;
            speed = prev.speed > 0 ? prev.speed * 0.6 + inst * 0.4 : inst;
            speedRef.current.set(qid, { t: now, done, speed });
        } else if (!prev) {
            speedRef.current.set(qid, { t: now, done, speed: 0 });
        }
        const remaining = Math.max(0, total - done);
        const eta = speed > 0 && done < total ? Math.round(remaining / speed) : undefined;
        setUploadQueue(q => q.map(x => {
            if (x.id !== qid) return x;
            const next: any = { ...x, progress: total ? Math.round((done / total) * 100) : 5 };
            if (speed > 0) {
                next.speed = Math.max(0, Math.round(speed));
                if (eta !== undefined) next.eta = eta;
            }
            return next;
        }));
    }, []);
    const setPausedAll = (p: boolean) => { uploadsPausedRef.current = p; setUploadsPaused(p); };
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
    const [showAi, setShowAi] = useState(false);
    const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
    const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
    const [previewContextFiles, setPreviewContextFiles] = useState<TelegramFile[]>([]);
    const [previewContextIndex, setPreviewContextIndex] = useState(-1);
    const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
    const [propertyFile, setPropertyFile] = useState<TelegramFile | null>(null);
    const [uploadQueue, setUploadQueue] = useState<any[]>([]);
    const [downloadQueue, setDownloadQueue] = useState<any[]>([]);
    const uploadFilesRef = useRef<Map<string, File>>(new Map());
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
    }, []);
    useEffect(() => { localStorage.setItem('viewSettings', JSON.stringify(viewSettings)); }, [viewSettings]);

    // Load user info
    useEffect(() => { api.getUserInfo().then(setUserInfo).catch(() => {}); }, []);

    // Sync folders
    const syncFolders = useCallback(async () => {
        setIsSyncing(true);
        try { const r = await api.scanFolders(); setFolders(r); } catch { toast.error('Failed to sync folders'); }
        finally { setIsSyncing(false); }
    }, []);
    useEffect(() => { syncFolders(); }, [syncFolders]);

    const [isOffline, setIsOffline] = useState(false);
    // File query with offline cache fallback (P1-4)
    const { data: allFiles = [], isLoading, error } = useQuery({
        queryKey: ['files', activeFolderId],
        queryFn: async () => {
            const cacheKey = `files_cache:${activeFolderId ?? 'root'}`;
            try {
                const res = await api.getFiles(activeFolderId ?? undefined);
                const mapped = res.map((f: any) => ({
                    ...f, sizeStr: formatBytes(f.size), type: f.icon_type || 'file'
                }));
                try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), files: mapped })); } catch {}
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
        enabled: activeFolderId !== -1
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
    const favFiles = (favRows as any[]).map((f: any) => ({
        ...f, id: f.message_id ?? f.id, name: f.name || `file-${f.message_id ?? f.id}`,
        size: f.size || 0, sizeStr: formatBytes(f.size || 0), type: 'file' as const, icon_type: 'file',
        folder_id: f.folder_id ?? null, starred: true,
    }));
    const recentFiles = (recentRows as any[]).map((f: any) => ({
        ...f, id: f.message_id ?? f.id, name: f.name || `file-${f.message_id ?? f.id}`,
        size: f.size || 0, sizeStr: formatBytes(f.size || 0), type: 'file' as const, icon_type: 'file',
        folder_id: f.folder_id ?? null, opened_at: f.opened_at,
    }));

    const isSpecial = activeFolderId === -1 || activeFolderId === -2 || activeFolderId === -3;
    const subFolders = isSpecial ? [] : folders
        .filter(f => f.parent_id === activeFolderId)
        .map(f => ({ ...f, size: 0, sizeStr: "Folder", type: 'folder' as const, created_at: '', icon_type: 'folder' }));

    const combinedFiles = activeFolderId === -1 ? trashItems : activeFolderId === -2 ? favFiles : activeFolderId === -3 ? recentFiles : [...subFolders, ...allFiles];
    const displayedFiles = (activeFolderId === -1 || activeFolderId === -2 || activeFolderId === -3) ? combinedFiles : (searchTerm.length > 2
        ? searchResults
        : combinedFiles.filter((f: any) => f.name.toLowerCase().includes(searchTerm.toLowerCase())));
    const isTrash = activeFolderId === -1;
    const trashLoadingCombined = isTrash ? trashLoading : isLoading;

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => api.getBandwidth(),
        refetchInterval: 5000
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
        if (!confirm('Permanently delete all trashed files?')) return;
        try { await api.emptyTrash(); toast.success('Trash emptied'); refetchTrash(); } catch { toast.error('Empty failed'); }
    }, [refetchTrash]);

    const handlePurgeTrash = useCallback(async (id: number, folder_id?: number) => {
        if (!confirm('Permanently delete this file? It cannot be restored.')) return;
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
        for (const id of selectedIds) {
            const file = displayedFiles.find(f => f.id === id);
            try {
                if (file?.type === 'folder') await api.deleteFolder(id);
                else await api.deleteFile(id, activeFolderId ?? undefined);
            } catch { /* continue */ }
        }
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        toast.success(`Deleted ${selectedIds.length} items`);
    }, [selectedIds, activeFolderId, displayedFiles, queryClient]);

    const handleBulkDownload = useCallback(async () => {
        for (const id of selectedIds) {
            const file = displayedFiles.find(f => f.id === id);
            if (!file) continue;
            try {
                const blob = await api.downloadFile(activeFolderId ?? 0, id);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = file.name; a.click();
                URL.revokeObjectURL(url);
                api.touchRecent(file.id, file.folder_id ?? activeFolderId ?? undefined, file.name, file.size).catch(()=>{});
                api.logActivity('download', `folder:${file.folder_id ?? activeFolderId ?? 'root'}`, file.name).catch(()=>{});
            } catch { toast.error(`Failed: ${file.name}`); }
        }
    }, [selectedIds, displayedFiles, activeFolderId]);

    const [tagFile, setTagFile] = useState<any | null>(null);
    const [versionsFile, setVersionsFile] = useState<any | null>(null);
    const [promptState, setPromptState] = useState<PromptRequest | null>(null);
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
        uploadControllers.current.get(qid)?.abort();
        uploadControllers.current.delete(qid);
        setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'cancelled' as const } : x));
    }, []);
    const handleCancelAllUploads = useCallback(() => {
        uploadControllers.current.forEach(c => { try { c.abort(); } catch {} });
        uploadControllers.current.clear();
        setPausedAll(false);
        setUploadQueue(q => q.map(x => (x.status === 'pending' || x.status === 'uploading' || x.status === 'paused') ? { ...x, status: 'cancelled' as const } : x));
        setBusy(false);
    }, [setBusy]);
    const handlePauseAllUploads = useCallback(() => { setPausedAll(true); }, []);
    const handleResumeAllUploads = useCallback(() => {
        setPausedAll(false);
        setUploadQueue(q => q.map(x => x.status === 'paused' ? { ...x, status: 'pending' as const } : x));
    }, []);

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
        let ok = 0;
        for (const id of selectedIds) {
            const f = displayedFiles.find(x => x.id === id);
            if (!f || f.type === 'folder') continue;
            try { await api.starFile(id, (f as any).folder_id ?? activeFolderId ?? undefined, f.name, starred); ok++; } catch {}
        }
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
        let ok = 0;
        for (const id of selectedIds) {
            const f = displayedFiles.find(x => x.id === id);
            if (!f || f.type === 'folder') continue;
            try {
                const cur = await api.getTags(id, (f as any).folder_id ?? undefined);
                if (!cur.includes(t)) await api.setTags(id, (f as any).folder_id ?? undefined, [...cur, t]);
                ok++;
            } catch {}
        }
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
        let ok = 0;
        for (let i = 0; i < folderSel.length; i++) {
            const name = pattern.includes('{n}') ? pattern.replace(/\{n\}/g, String(i + 1)) : (folderSel.length === 1 ? pattern : `${pattern} ${i + 1}`);
            try { await api.renameFolder(folderSel[i].id, name); ok++; } catch {}
        }
        await syncFolders();
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        api.logActivity('bulk-rename', pattern, `${ok} folders`).catch(()=>{});
        toast.success(`Renamed ${ok} folder(s)`);
    }, [selectedIds, displayedFiles, activeFolderId, syncFolders, queryClient, askPrompt]);

    const handleCut = useCallback((ids: number[]) => {
        setClipboard({ type: 'cut', messageIds: ids, folderIds: [], sourceFolderId: activeFolderId });
        toast.info(`${ids.length} item(s) cut to clipboard.`);
    }, [activeFolderId]);

    const handleCopy = useCallback((ids: number[]) => {
        setClipboard({ type: 'copy', messageIds: ids, folderIds: [], sourceFolderId: activeFolderId });
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
            const res: any = await api.createShare(file.id, file.folder_id ?? activeFolderId ?? undefined, 7);
            const url = res.url || `${window.location.origin}/s/${res.token}`;
            await navigator.clipboard.writeText(url);
            toast.success(`Share link copied: ${url}`);
            api.logActivity('share', url, file.name).catch(()=>{});
        } catch (e: any) { toast.error(`Share failed: ${e.message}`); }
    }, [activeFolderId]);

    const handleStar = useCallback(async (file: any) => {
        try {
            const isFav = (favRows as any[]).some((x: any) => (x.message_id ?? x.id) === file.id && (x.folder_id ?? null) === (file.folder_id ?? null));
            await api.starFile(file.id, file.folder_id ?? activeFolderId ?? undefined, file.name, !isFav);
            toast.success(isFav ? 'Removed from Starred' : 'Starred');
            refetchFav(); queryClient.invalidateQueries({ queryKey: ['favorites'] });
            api.logActivity(isFav ? 'unstar' : 'star', undefined, file.name).catch(()=>{});
        } catch (e: any) { toast.error(`Star failed: ${e.message}`); }
    }, [activeFolderId, favRows, refetchFav, queryClient]);

    // Single-file upload: pause/cancel/queue feedback + encryption.
    // Files bigger than one chunk use the parallel chunked resumable path.
    const runOneFileUpload = useCallback(async (file: File, qid: string) => {
        uploadFilesRef.current.set(qid, file);
        // honour per-item cancel before starting
        let curStatus: string | undefined;
        setUploadQueue(q => { const it = q.find(x => x.id === qid); curStatus = it?.status; return q; });
        if (curStatus === 'cancelled') return;
        // honour pause: wait here until resumed (pending items show Paused)
        while (uploadsPausedRef.current) {
            setUploadQueue(q => q.map(x => (x.id === qid && x.status === 'pending') ? { ...x, status: 'paused' as const } : x));
            await new Promise(r => setTimeout(r, 300));
            setUploadQueue(q => { const it = q.find(x => x.id === qid); curStatus = it?.status; return q; });
            if (curStatus === 'cancelled') return;
        }
        setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'uploading' as const, progress: 5 } : x));
        const toastId = isLocked ? null : toast.loading(`Uploading ${file.name}...`);
        const ctrl = new AbortController();
        uploadControllers.current.set(qid, ctrl);
        const readStatus = () => {
            let s: string | undefined;
            setUploadQueue(q => { s = q.find(x => x.id === qid)?.status; return q; });
            return s;
        };
        try {
            let upFile: File = file;
            let encIv: string | undefined;
            try {
                const { isEncryptionEnabled, encryptFile, encName } = await import('../../lib/crypto');
                if (isEncryptionEnabled()) {
                    const pin = window.prompt('Encryption ON — enter your lock PIN to encrypt ' + file.name);
                    if (!pin) throw new Error('Encryption cancelled — PIN required');
                    const buf = await file.arrayBuffer();
                    const { blob, ivB64 } = await encryptFile(pin, buf);
                    encIv = ivB64;
                    upFile = new File([blob], encName(file.name), { type: 'application/octet-stream' });
                }
            } catch (e: any) { if (e?.message?.includes('cancelled')) throw e; }
            if (upFile.size > api.CHUNK_SIZE) {
                // P3: parallel chunked resumable upload (8MB chunks x4)
                let resumeId: string | undefined;
                setUploadQueue(q => { resumeId = q.find(x => x.id === qid)?.uploadId; return q; });
                await api.uploadFileResumable(upFile, activeFolderId ?? undefined, {
                    signal: ctrl.signal,
                    resumeUploadId: resumeId,
                    onProgress: (done, total) => reportProgress(qid, done, total),
                    onUploadId: (id) => setUploadQueue(q =>
                        q.map(x => x.id === qid ? { ...x, uploadId: id } : x)),
                    waitIfPaused: async () => {
                        while (uploadsPausedRef.current) {
                            if (readStatus() === 'cancelled') throw new DOMException('cancelled', 'AbortError');
                            setUploadQueue(q => q.map(x => (x.id === qid && (x.status === 'pending' || x.status === 'uploading')) ? { ...x, status: 'paused' as const } : x));
                            await new Promise(r => setTimeout(r, 300));
                        }
                        if (readStatus() === 'cancelled') throw new DOMException('cancelled', 'AbortError');
                        setUploadQueue(q => q.map(x => x.id === qid && x.status === 'paused' ? { ...x, status: 'uploading' as const } : x));
                    },
                    isCancelled: () => readStatus() === 'cancelled',
                });
            } else {
                await api.uploadFileWithProgress(upFile, activeFolderId ?? undefined, {
                    signal: ctrl.signal,
                    onProgress: (done, total) => reportProgress(qid, done, total || upFile.size),
                });
            }
            if (encIv) {
                try { await api.setTags(Date.now() % 2147483647, activeFolderId ?? undefined, []); } catch {}
                const m = JSON.parse(localStorage.getItem('enc_iv') || '{}');
                m[`${activeFolderId ?? 'null'}:${upFile.name}`] = encIv;
                try { localStorage.setItem('enc_iv', JSON.stringify(m)); } catch {}
            }
            api.logActivity('upload', `folder:${activeFolderId ?? 'root'}`, file.name).catch(()=>{});
            setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'success' as const, progress: 100 } : x));
            if (isLocked) { queueToast(`${file.name} uploaded`, 'success'); if (toastId) toast.dismiss(toastId); }
            else toast.success(`${file.name} uploaded`, { id: toastId as any });
        } catch (err: any) {
            const cancelled = ctrl.signal.aborted || String(err?.name).includes('Abort') || String(err?.message).includes('aborted') || String(err?.message).includes('cancelled');
            if (cancelled && String(err?.message).includes('Encryption cancelled')) {
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'cancelled' as const } : x));
                if (toastId) toast.dismiss(toastId);
            } else if (cancelled) {
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'cancelled' as const } : x));
                if (toastId) toast.dismiss(toastId);
                toast.info(`${file.name} upload cancelled`);
            } else {
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'error' as const, error: err.message } : x));
                if (!handleAuthError(err)) {
                    if (isLocked) { queueToast(`Failed: ${file.name} - ${err.message}`, 'error'); if (toastId) toast.dismiss(toastId); }
                    else toast.error(`Failed: ${file.name} - ${err.message || 'error'}`, { id: toastId as any });
                } else if (toastId) toast.dismiss(toastId);
            }
        } finally {
            uploadControllers.current.delete(qid);
            speedRef.current.delete(qid);
        }
    }, [activeFolderId, isLocked, queueToast, handleAuthError, reportProgress]);

    const handleRetryUpload = useCallback(async (qid: string) => {
        const file = uploadFilesRef.current.get(qid);
        if (!file) { toast.error('Original file unavailable — please re-select it'); return; }
        setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'pending' as const, progress: 0, error: undefined } : x));
        setBusy(true);
        try {
            await runOneFileUpload(file, qid);
        } finally {
            setBusy(false);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        }
    }, [runOneFileUpload, activeFolderId, queryClient, setBusy]);

    // Upload - with queue feedback for phone/desktop + duplicate detector (P1-1)
    const handleManualUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true;
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            let fileList = Array.from(files);
            // P1-1: duplicate detector (same name + size in current folder)
            const existing = new Map((allFiles as any[]).filter((f: any) => f.type !== 'folder').map((f: any) => [`${f.name}::${f.size}`, f]));
            const dups = fileList.filter(f => existing.has(`${f.name}::${f.size}`));
            if (dups.length > 0) {
                const names = dups.slice(0, 3).map(f => f.name).join(', ') + (dups.length > 3 ? ` +${dups.length - 3} more` : '');
                const uploadAnyway = window.confirm(`${dups.length} file(s) already exist with same name + size:\n${names}\n\nOK = upload anyway (duplicates)\nCancel = skip duplicates`);
                if (!uploadAnyway) {
                    fileList = fileList.filter(f => !existing.has(`${f.name}::${f.size}`));
                    if (fileList.length === 0) { toast.info('Skipped duplicates — nothing to upload'); return; }
                    toast.info(`Skipped ${dups.length} duplicate(s)`);
                } else {
                    toast.info(`Uploading ${dups.length} duplicate(s) anyway`);
                }
            }
            // init queue
            const now = Date.now();
            setUploadQueue(prev => [...prev, ...fileList.map((f, i) => ({ id: `${now}-${i}`, name: f.name, size: f.size, status: 'pending' as const, progress: 0 }))]);
            setBusy(true);
            for (let i = 0; i < fileList.length; i++) {
                await runOneFileUpload(fileList[i], `${now}-${i}`);
            }
            setBusy(false);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            setTimeout(() => setUploadQueue(q => q.filter(x => x.status === 'pending' || x.status === 'uploading' || x.status === 'paused')), 4000);
        };
        input.click();
    }, [activeFolderId, queryClient, setBusy, allFiles, runOneFileUpload]);

    const handleFolderUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        (input as any).webkitdirectory = true;
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            const fileList = Array.from(files);
            const now = Date.now();
            setUploadQueue(prev => [...prev, ...fileList.map((f, i) => ({ id: `${now}-${i}`, name: f.name, size: f.size, status: 'pending' as const, progress: 0 }))]);
            toast.loading(`Uploading ${fileList.length} files...`);
            let ok = 0;
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                const qid = `${now}-${i}`;
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'uploading' as const, progress: 10 } : x));
                try { await api.uploadFile(file, activeFolderId ?? undefined); setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'success' as const, progress: 100 } : x)); ok++; } catch { setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'error' as const } : x)); }
            }
            toast.dismiss();
            toast.success(`${ok}/${fileList.length} files uploaded`);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            setTimeout(() => setUploadQueue(q => q.filter(x => x.status === 'pending' || x.status === 'uploading')), 4000);
        };
        input.click();
    }, [activeFolderId, queryClient]);

    const handleCameraUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        (input as any).capture = 'environment';
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files || files.length === 0) return;
            const file = files[0];
            const qid = `${Date.now()}-cam`;
            setUploadQueue(prev => [...prev, { id: qid, name: file.name, size: file.size, status: 'pending' as const, progress: 0 }]);
            setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'uploading' as const, progress: 5 } : x));
            const tid = toast.loading(`Uploading ${file.name}...`);
            try {
                await api.uploadFile(file, activeFolderId ?? undefined);
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'success' as const, progress: 100 } : x));
                toast.success(`${file.name} uploaded`, { id: tid });
            } catch (err: any) {
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'error' as const } : x));
                if (!handleAuthError(err)) toast.error(`Failed: ${err.message}`, { id: tid });
                else toast.dismiss(tid);
            }
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            setTimeout(() => setUploadQueue(q => q.filter(x => x.status === 'pending' || x.status === 'uploading')), 4000);
        };
        input.click();
    }, [activeFolderId, queryClient, handleAuthError]);

    const handleDroppedFiles = useCallback(async (files: File[]) => {
        if (files.length === 0) return;
        const now = Date.now();
        setUploadQueue(prev => [...prev, ...files.map((f, i) => ({ id: `${now}-${i}`, name: f.name, size: f.size, status: 'pending' as const, progress: 0 }))]);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const qid = `${now}-${i}`;
            setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'uploading' as const, progress: 5 } : x));
            const toastId = toast.loading(`Uploading ${file.name}...`);
            try {
                await api.uploadFile(file, activeFolderId ?? undefined);
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'success' as const, progress: 100 } : x));
                toast.success(`${file.name} uploaded`, { id: toastId });
            } catch (err: any) {
                setUploadQueue(q => q.map(x => x.id === qid ? { ...x, status: 'error' as const } : x));
                toast.error(`Failed: ${file.name}`, { id: toastId });
            }
        }
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        setTimeout(() => setUploadQueue(q => q.filter(x => x.status === 'pending' || x.status === 'uploading')), 4000);
    }, [activeFolderId, queryClient]);

    // View settings
    const onUpdateViewSettings = useCallback((s: Partial<ViewSettings>) => {
        setViewSettings(prev => ({ ...prev, ...s }));
    }, []);

    // Selection
    const handleSelectAll = useCallback(() => {
        setSelectedIds(displayedFiles.map(f => f.id));
    }, [displayedFiles]);
    const handleFileClick = useCallback((e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) {
            setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
        } else {
            setSelectedIds([id]);
        }
    }, []);
    const handleToggleSelection = useCallback((id: number) => {
        setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }, []);

    // Preview — everything goes through the unified iframe FrameViewer
    const handlePreview = useCallback((file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        const contextFiles = (orderedFiles || displayedFiles).filter(f => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex(f => f.id === file.id);
        setPreviewContextFiles(contextFiles);
        setPreviewContextIndex(contextIndex);
        api.touchRecent(file.id, (file as any).folder_id ?? activeFolderId ?? undefined, file.name, (file as any).size).catch(()=>{});
        setPreviewFile(file); setPlayingFile(null); setPdfFile(null);
    }, [displayedFiles, activeFolderId]);

    const navigatePreview = useCallback((step: 1 | -1) => {
        if (previewContextFiles.length === 0) return;
        const currentFileId = previewFile?.id;
        if (!currentFileId) return;
        const currentIndex = previewContextFiles.findIndex(f => f.id === currentFileId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + step + previewContextFiles.length) % previewContextFiles.length;
        const nextFile = previewContextFiles[nextIndex];
        if (!nextFile) return;
        setPreviewContextIndex(nextIndex);
        setPreviewFile(nextFile); setPlayingFile(null); setPdfFile(null);
    }, [previewContextFiles, previewFile]);
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

    const isDragging = false; // simplified for web
    const currentFolderName = activeFolderId === null ? "Saved Messages" : folders.find(f => f.id === activeFolderId)?.name || "Folder";
    const previewNeighbors = previewNeighborFiles();

    // P1-3: storage stats for current folder (files only)
    const folderStats = (() => {
        if (isSpecial) return null;
        const filesOnly = (allFiles as any[]).filter((f: any) => f.type !== 'folder');
        const bytes = filesOnly.reduce((s: number, f: any) => s + (f.size || 0), 0);
        return { count: filesOnly.length + subFolders.length, fileCount: filesOnly.length, folderCount: subFolders.length, bytes };
    })();

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
            className="flex h-screen w-full overflow-hidden bg-dynamic-mesh relative"
            onClick={() => setSelectedIds([])}
        >
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
                {showActivityLog && <TransferLogs onClose={() => setShowActivityLog(false)} key="activity-modal" />}
                {propertyFile && <PropertiesModal file={propertyFile} onClose={() => setPropertyFile(null)} key="props-modal" />}
                {showAi && <AiAssistant onClose={() => setShowAi(false)} currentFolderFiles={allFiles} key="ai-modal" />}
            </AnimatePresence>

<Sidebar
        folders={folders} activeFolderId={activeFolderId} setActiveFolderId={setActiveFolderId} stats={folderStats}
        onDrop={handleDropOnFolder} onDelete={handleFolderDelete} onCreate={handleCreateFolder}
        onRename={(id, name) => handleRename(id, name, true)}
        onCut={(id) => { setClipboard({ type: 'cut', messageIds: [], folderIds: [id], sourceFolderId: activeFolderId }); toast.info('Folder cut to clipboard.'); }}
        onCopy={(id) => { setClipboard({ type: 'copy', messageIds: [], folderIds: [id], sourceFolderId: activeFolderId }); toast.info('Folder copied to clipboard.'); }}
        onPaste={(targetId) => handlePaste(targetId)}
        canPaste={!!clipboard}
        onProperties={(id) => {
            if (id === null) setPropertyFile({ id: 0, name: "Saved Messages", type: 'folder', icon_type: 'folder' } as any);
            else { const f = folders.find(folder => folder.id === id); if (f) setPropertyFile({ ...f, type: 'folder', icon_type: 'folder' } as any); }
        }}
        isSyncing={isSyncing} isConnected={isConnected} userInfo={userInfo}
        onSync={syncFolders} onLogout={handleLogout}
        onSettings={() => setShowSettingsModal(true)} bandwidth={bandwidth || null}
        onActivityLog={() => setShowActivityLog(!showActivityLog)}
    />

            {/* Floating buttons */}
            <button onClick={() => setShowActivityLog(true)} className="fixed bottom-6 left-72 z-40 p-3 bg-telegram-surface border border-telegram-border rounded-full shadow-lg hover:bg-telegram-hover text-telegram-secondary transition-all hover:scale-110 group" title="Activity Log">
                <History className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            </button>
            <button onClick={() => setShowAi(prev => !prev)} className={`fixed bottom-6 right-8 z-40 p-4 rounded-2xl shadow-2xl transition-all hover:scale-110 active:scale-95 group flex items-center gap-2 border ${showAi ? 'bg-purple-600 border-purple-400 text-white' : 'bg-telegram-surface border-telegram-border text-purple-400 hover:bg-white/5'}`} title="AI Assistant">
                <Bot className={`w-6 h-6 ${showAi ? 'animate-bounce' : 'group-hover:rotate-12 transition-transform'}`} />
                {!showAi && <span className="text-xs font-bold uppercase tracking-wider pr-1">Ask AI</span>}
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
                />
                {isOffline && !isSpecial && (
                    <div className="px-4 pt-2">
                        <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-300 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                            Offline — showing last cached files. Reconnect to refresh.
                        </div>
                    </div>
                )}
                {isTrash ? (
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
                <FrameViewer file={previewFile} activeFolderId={activeFolderId} onClose={() => setPreviewFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} onEdit={() => previewFile && handleEdit(previewFile)} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} />
            )}

            {editFile?.kind === 'sheet' && (
                <SheetEditor file={editFile.file} activeFolderId={activeFolderId} onClose={() => setEditFile(null)} onSaved={handleEditSaved} />
            )}
            {(editFile?.kind === 'doc' || editFile?.kind === 'text') && (
                <DocEditor file={editFile.file} activeFolderId={activeFolderId} onClose={() => setEditFile(null)} onSaved={handleEditSaved} />
            )}
            {editFile?.kind === 'slide' && (
                <SlideEditor file={editFile.file} activeFolderId={activeFolderId} onClose={() => setEditFile(null)} onSaved={handleEditSaved} />
            )}

            <UploadQueue items={uploadQueue} paused={uploadsPaused} onClearFinished={() => setUploadQueue(q => q.filter((i: any) => i.status !== 'success' && i.status !== 'error' && i.status !== 'cancelled'))} onCancelAll={handleCancelAllUploads} onCancelItem={handleCancelUpload} onPauseAll={handlePauseAllUploads} onResumeAll={handleResumeAllUploads} onRetryItem={handleRetryUpload} />
            <DownloadQueue items={downloadQueue} onClearFinished={() => setDownloadQueue(q => q.filter((i: any) => i.status !== 'success' && i.status !== 'error'))} onCancelAll={() => setDownloadQueue([])} />
        </motion.div>
    );
}
