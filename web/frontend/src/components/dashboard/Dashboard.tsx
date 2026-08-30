import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History, Bot } from 'lucide-react';

import { TelegramFile, BandwidthStats, FileClipboard, ViewSettings, FolderMetadata } from '../../types';
import { formatBytes, isMediaFile, isPdfFile } from '../../utils';
import * as api from '../../api';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { FileExplorer } from './FileExplorer';
import { UploadQueue } from './UploadQueue';
import { DownloadQueue } from './DownloadQueue';
import { MoveToFolderModal } from './MoveToFolderModal';
import { PreviewModal } from './PreviewModal';
import { MediaPlayer } from './MediaPlayer';
import { DragDropOverlay } from './DragDropOverlay';
import { PdfViewer } from './PdfViewer';
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
    const [searchResults, setSearchResults] = useState<TelegramFile[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showAi, setShowAi] = useState(false);
    const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
    const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
    const [previewContextFiles, setPreviewContextFiles] = useState<TelegramFile[]>([]);
    const [previewContextIndex, setPreviewContextIndex] = useState(-1);
    const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
    const [propertyFile, setPropertyFile] = useState<TelegramFile | null>(null);
    const [uploadQueue, setUploadQueue] = useState<any[]>([]);
    const [downloadQueue, setDownloadQueue] = useState<any[]>([]);
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

    // File query
    const { data: allFiles = [], isLoading, error } = useQuery({
        queryKey: ['files', activeFolderId],
        queryFn: () => api.getFiles(activeFolderId ?? undefined).then(res => res.map((f: any) => ({
            ...f, sizeStr: formatBytes(f.size), type: f.icon_type || 'file'
        })))
    });

    const subFolders = folders
        .filter(f => f.parent_id === activeFolderId)
        .map(f => ({ ...f, size: 0, sizeStr: "Folder", type: 'folder' as const, created_at: '', icon_type: 'folder' }));

    const combinedFiles = [...subFolders, ...allFiles];
    const displayedFiles = searchTerm.length > 2
        ? searchResults
        : combinedFiles.filter((f: any) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => api.getBandwidth(),
        refetchInterval: 5000
    });

    // File operations
    const handleLogout = useCallback(async () => { await api.logout(); onLogout(); }, [onLogout]);
    const handleCreateFolder = useCallback(async (name: string, parentId?: number) => {
        try { await api.createFolder(name, parentId); await syncFolders(); toast.success('Folder created'); } catch { toast.error('Failed'); }
    }, [syncFolders]);
    const handleFolderDelete = useCallback(async (id: number, name: string) => {
        try { await api.deleteFolder(id); await syncFolders(); toast.success(`"${name}" deleted`); } catch { toast.error('Failed'); }
    }, [syncFolders]);

    const handleDelete = useCallback(async (id: number) => {
        try {
            const file = displayedFiles.find(f => f.id === id);
            if (file?.type === 'folder') {
                await api.deleteFolder(id);
                queryClient.invalidateQueries({ queryKey: ['folders'] });
            } else {
                await api.deleteFile(id, activeFolderId ?? undefined);
            }
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            toast.success('Deleted');
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
            } catch { toast.error(`Failed: ${file.name}`); }
        }
    }, [selectedIds, displayedFiles, activeFolderId]);

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
        try { return await api.searchFiles(q); } catch { return []; }
    }, []);

    const handleRename = useCallback(async (id: number, newName: string, isFolder: boolean) => {
        if (isFolder) {
            try { await api.renameFolder(id, newName); await syncFolders(); } catch { toast.error('Rename failed'); }
        }
    }, [syncFolders]);

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

    // Upload
    const handleManualUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true;
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            for (const file of Array.from(files)) {
                try {
                    await api.uploadFile(file, activeFolderId ?? undefined);
                    toast.success(`${file.name} uploaded`);
                } catch { toast.error(`Failed: ${file.name}`); }
            }
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        };
        input.click();
    }, [activeFolderId, queryClient]);

    const handleFolderUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        (input as any).webkitdirectory = true;
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            for (const file of Array.from(files)) {
                try { await api.uploadFile(file, activeFolderId ?? undefined); } catch { /* continue */ }
            }
            toast.success(`${files.length} files uploaded`);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        };
        input.click();
    }, [activeFolderId, queryClient]);

    const handleDroppedFiles = useCallback(async (files: File[]) => {
        for (const file of files) {
            try {
                await api.uploadFile(file, activeFolderId ?? undefined);
                toast.success(`${file.name} uploaded`);
            } catch { toast.error(`Failed: ${file.name}`); }
        }
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
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

    // Preview
    const handlePreview = useCallback((file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        const contextFiles = (orderedFiles || displayedFiles).filter(f => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex(f => f.id === file.id);
        setPreviewContextFiles(contextFiles);
        setPreviewContextIndex(contextIndex);
        const isMedia = isMediaFile(file.name);
        const isPdf = isPdfFile(file.name);
        if (isMedia) { setPlayingFile(file); setPreviewFile(null); setPdfFile(null); }
        else if (isPdf) { setPdfFile(file); setPreviewFile(null); setPlayingFile(null); }
        else { setPreviewFile(file); setPlayingFile(null); setPdfFile(null); }
    }, [displayedFiles]);

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
        const isMedia = isMediaFile(nextFile.name);
        const isPdf = isPdfFile(nextFile.name);
        if (isMedia) { setPlayingFile(nextFile); setPreviewFile(null); setPdfFile(null); }
        else if (isPdf) { setPdfFile(nextFile); setPreviewFile(null); setPlayingFile(null); }
        else { setPreviewFile(nextFile); setPlayingFile(null); setPdfFile(null); }
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);
    const handleNextPreview = useCallback(() => navigatePreview(1), [navigatePreview]);
    const handlePrevPreview = useCallback(() => navigatePreview(-1), [navigatePreview]);

    const previewNeighborFiles = useCallback(() => {
        if (previewContextFiles.length === 0) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
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
        if (searchTerm.length <= 2) { setSearchResults([]); return; }
        const timer = setTimeout(async () => {
            setIsSearching(true);
            const results = await handleGlobalSearch(searchTerm);
            setSearchResults(results);
            setIsSearching(false);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, handleGlobalSearch]);

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

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
            className="flex h-screen w-full overflow-hidden bg-dynamic-mesh relative"
            onClick={() => setSelectedIds([])}
        >
            <AnimatePresence>
                {showMoveModal && <MoveToFolderModal folders={folders} onClose={() => setShowMoveModal(false)} onSelect={handleBulkMove} activeFolderId={activeFolderId} key="move-modal" />}
                {playingFile && <MediaPlayer file={playingFile} onClose={() => setPlayingFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} activeFolderId={activeFolderId} key="media-player" />}
                {pdfFile && <PdfViewer file={pdfFile} onClose={() => setPdfFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} activeFolderId={activeFolderId} key="pdf-viewer" />}
                {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} key="settings-modal" />}
                {showHistory && <TransferLogs onClose={() => setShowHistory(false)} key="history-modal" />}
                {propertyFile && <PropertiesModal file={propertyFile} onClose={() => setPropertyFile(null)} key="props-modal" />}
                {showAi && <AiAssistant onClose={() => setShowAi(false)} currentFolderFiles={allFiles} key="ai-modal" />}
            </AnimatePresence>

            <Sidebar
                folders={folders} activeFolderId={activeFolderId} setActiveFolderId={setActiveFolderId}
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
            />

            {/* Floating buttons */}
            <button onClick={() => setShowHistory(true)} className="fixed bottom-6 left-72 z-40 p-3 bg-telegram-surface border border-telegram-border rounded-full shadow-lg hover:bg-telegram-hover text-telegram-secondary transition-all hover:scale-110 group" title="Transfer History">
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
                    onManualUpload={handleManualUpload} onFolderUpload={handleFolderUpload}
                    onCreateFolder={async () => {
                        const name = window.prompt("Enter folder name:");
                        if (name) await handleCreateFolder(name, activeFolderId || undefined);
                    }}
                    onPaste={() => handlePaste()} onCut={handleCut} onCopy={handleCopy}
                    canPaste={!!clipboard} viewSettings={viewSettings}
                    onUpdateViewSettings={onUpdateViewSettings}
                    searchTerm={searchTerm} onSearchChange={setSearchTerm}
                />
                {searchTerm.length > 2 && (
                    <div className="px-6 pt-4 pb-0">
                        <h2 className="text-sm font-medium text-telegram-subtext">
                            Search Results for <span className="text-telegram-primary">"{searchTerm}"</span>
                        </h2>
                    </div>
                )}
                <FileExplorer
                    files={displayedFiles} loading={isLoading || isSearching} error={error}
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
                    onMove={() => setShowMoveModal(true)} onPaste={() => handlePaste()}
                    canPaste={!!clipboard} onOpenFolder={(id) => setActiveFolderId(id)}
                    onProperties={(file) => {
                        if (!file) setPropertyFile({ id: activeFolderId || 0, name: currentFolderName, type: 'folder', icon_type: 'folder' } as any);
                        else setPropertyFile(file);
                    }}
                />
            </main>

            {previewFile && (
                <PreviewModal file={previewFile} activeFolderId={activeFolderId} onClose={() => setPreviewFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} nextFile={previewNeighbors.nextFile} prevFile={previewNeighbors.prevFile} />
            )}

            <UploadQueue items={uploadQueue} onClearFinished={() => setUploadQueue(q => q.filter((i: any) => i.status !== 'success' && i.status !== 'error'))} onCancelAll={() => setUploadQueue([])} />
            <DownloadQueue items={downloadQueue} onClearFinished={() => setDownloadQueue(q => q.filter((i: any) => i.status !== 'success' && i.status !== 'error'))} onCancelAll={() => setDownloadQueue([])} />
        </motion.div>
    );
}
