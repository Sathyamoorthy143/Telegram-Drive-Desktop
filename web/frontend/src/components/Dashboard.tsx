import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { TelegramFile, BandwidthStats, FileClipboard, ViewSettings, FolderMetadata } from '../types';
import { formatBytes, isMediaFile, isPdfFile } from '../utils';
import * as api from '../api';

import { Sidebar } from './dashboard/Sidebar';
import { History, Bot } from 'lucide-react';
import { TopBar } from './dashboard/TopBar';
import { FileExplorer } from './dashboard/FileExplorer';
import { UploadQueue } from './dashboard/UploadQueue';
import { DownloadQueue } from './dashboard/DownloadQueue';
import { MoveToFolderModal } from './dashboard/MoveToFolderModal';
import { PreviewModal } from './dashboard/PreviewModal';
import { MediaPlayer } from './dashboard/MediaPlayer';
import { DragDropOverlay } from './dashboard/DragDropOverlay';
import { PdfViewer } from './dashboard/PdfViewer';
import { SettingsModal } from './dashboard/SettingsModal';
import { TransferLogs } from './dashboard/TransferLogs';
import { PropertiesModal } from './dashboard/PropertiesModal';
import { AiAssistant } from './dashboard/AiAssistant';

export function Dashboard({ onLogout }: { onLogout: () => void }) {
    const queryClient = useQueryClient();
    const [folders, setFolders] = useState<FolderMetadata[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isConnected, setIsConnected] = useState(true);
    const [userInfo, setUserInfo] = useState<any>(null);

    const [previewFile, setPreviewFile] = useState<TelegramFile | null>(null);
    const [viewSettings, setViewSettings] = useState<ViewSettings>({
        viewMode: 'grid', groupBy: 'none', showPreviewPane: false,
        sortField: 'name', sortDirection: 'asc'
    });
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<TelegramFile[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showAi, setShowAi] = useState(false);
    const [internalDragFileId, _setInternalDragFileId] = useState<number | null>(null);
    const internalDragRef = useRef<number | null>(null);

    const setInternalDragFileId = (id: number | null) => {
        internalDragRef.current = id;
        _setInternalDragFileId(id);
    };
    const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
    const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
    const [previewContextFiles, setPreviewContextFiles] = useState<TelegramFile[]>([]);
    const [previewContextIndex, setPreviewContextIndex] = useState(-1);
    const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
    const [propertyFile, setPropertyFile] = useState<TelegramFile | null>(null);

    // Load view settings from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('viewSettings');
        if (saved) setViewSettings(JSON.parse(saved));
    }, []);

    useEffect(() => {
        localStorage.setItem('viewSettings', JSON.stringify(viewSettings));
    }, [viewSettings]);

    // Load user info on mount
    useEffect(() => {
        api.getUserInfo().then(setUserInfo).catch(() => {});
    }, []);

    const syncFolders = useCallback(async () => {
        setIsSyncing(true);
        try {
            const result = await api.scanFolders();
            setFolders(result);
        } catch (e) {
            toast.error('Failed to sync folders');
        } finally {
            setIsSyncing(false);
        }
    }, []);

    useEffect(() => { syncFolders(); }, [syncFolders]);

    const handleLogout = useCallback(async () => {
        await api.logout();
        onLogout();
    }, [onLogout]);

    const handleCreateFolder = useCallback(async (name: string, parentId?: number) => {
        try {
            await api.createFolder(name, parentId);
            await syncFolders();
            toast.success('Folder created');
        } catch {
            toast.error('Failed to create folder');
        }
    }, [syncFolders]);

    const handleFolderDelete = useCallback(async (id: number) => {
        try {
            await api.deleteFolder(id);
            await syncFolders();
            toast.success('Folder deleted');
        } catch {
            toast.error('Failed to delete folder');
        }
    }, [syncFolders]);

    const { data: allFiles = [], isLoading, error } = useQuery({
        queryKey: ['files', activeFolderId],
        queryFn: () => api.getFiles(activeFolderId ?? undefined).then(res => res.map((f: any) => ({
            ...f, sizeStr: formatBytes(f.size),
            type: f.icon_type || (f.name.endsWith('/') ? 'folder' : 'file')
        }))),
    });

    const subFolders = folders
        .filter(f => f.parent_id === activeFolderId)
        .map(f => ({ ...f, size: 0, sizeStr: "Folder", type: 'folder' as const, created_at: '', icon_type: 'folder' }));

    const combinedFiles = [...subFolders, ...allFiles];
    const displayedFiles = searchTerm.length > 2 ? searchResults : combinedFiles.filter((f: any) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => api.getBandwidth(),
        refetchInterval: 5000,
    });

    const handleDelete = useCallback(async (id: number) => {
        try { await api.deleteFile(id, activeFolderId ?? undefined); queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] }); toast.success('Deleted'); }
        catch { toast.error('Delete failed'); }
    }, [activeFolderId, queryClient]);

    const handleBulkDelete = useCallback(async () => {
        for (const id of selectedIds) { await api.deleteFile(id, activeFolderId ?? undefined); }
        setSelectedIds([]); queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] }); toast.success(`Deleted ${selectedIds.length} files`);
    }, [selectedIds, activeFolderId, queryClient]);

    const handleBulkDownload = useCallback(async () => {
        for (const id of selectedIds) {
            const file = displayedFiles.find(f => f.id === id);
            if (file) { try { const blob = await api.downloadFile(activeFolderId ?? 0, id); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url); } catch { toast.error(`Failed to download ${file.name}`); } }
        }
    }, [selectedIds, displayedFiles, activeFolderId]);

    const handleBulkMove = useCallback(async (targetFolderId: number | null) => {
        try { await api.moveFiles(selectedIds, [], activeFolderId ?? undefined, targetFolderId ?? undefined); setSelectedIds([]); setShowMoveModal(false); queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] }); toast.success('Moved'); }
        catch { toast.error('Move failed'); }
    }, [selectedIds, activeFolderId, queryClient]);

    const handleGlobalSearch = useCallback(async (query: string) => {
        try { return await api.searchFiles(query); } catch { return []; }
    }, []);

    const handleRename = useCallback(async (id: number, newName: string, isFolder: boolean) => {
        if (isFolder) { try { await api.renameFolder(id, newName); await syncFolders(); } catch { toast.error('Rename failed'); } }
    }, [syncFolders]);

    const handleManualUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true;
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            for (const file of Array.from(files)) {
                try { await api.uploadFile(file, activeFolderId ?? undefined); toast.success(`${file.name} uploaded`); }
                catch { toast.error(`Failed to upload ${file.name}`); }
            }
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        };
        input.click();
    }, [activeFolderId, queryClient]);

    const handleFolderUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; (input as any).webkitdirectory = true;
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            for (const file of Array.from(files)) {
                try { await api.uploadFile(file, activeFolderId ?? undefined); }
                catch { /* skip */ }
            }
            toast.success(`${files.length} files uploaded`);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
        };
        input.click();
    }, [activeFolderId, queryClient]);

    const handleDroppedFiles = useCallback(async (files: File[]) => {
        for (const file of files) {
            try { await api.uploadFile(file, activeFolderId ?? undefined); toast.success(`${file.name} uploaded`); }
            catch { toast.error(`Failed to upload ${file.name}`); }
        }
        queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
    }, [activeFolderId, queryClient]);

    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const handleDragEnter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) setIsDragging(true); };
        const handleDragLeave = (e: DragEvent) => { if (e.relatedTarget === null) setIsDragging(false); };
        const handleDrop = (e: DragEvent) => { setIsDragging(false); if (e.dataTransfer?.files.length) handleDroppedFiles(Array.from(e.dataTransfer.files)); };
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);
        return () => { window.removeEventListener('dragenter', handleDragEnter); window.removeEventListener('dragleave', handleDragLeave); window.removeEventListener('drop', handleDrop); };
    }, [handleDroppedFiles]);

    const onUpdateViewSettings = (s: Partial<ViewSettings>) => setViewSettings(p => ({ ...p, ...s }));
    const handleSelectAll = useCallback(() => setSelectedIds(displayedFiles.map(f => f.id)), [displayedFiles]);
    const handleEscape = useCallback(() => { setSelectedIds([]); setSearchTerm(""); setPreviewFile(null); setPlayingFile(null); setPdfFile(null); }, []);

    const handleFileClick = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) { setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]); }
        else { setSelectedIds([id]); }
    };

    const handleToggleSelection = useCallback((id: number) => { setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]); }, []);

    const handlePreview = (file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        const contextFiles = (orderedFiles || displayedFiles).filter((f) => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex((f) => f.id === file.id);
        setPreviewContextFiles(contextFiles); setPreviewContextIndex(contextIndex);
        if (isMediaFile(file.name)) { setPlayingFile(file); setPreviewFile(null); setPdfFile(null); }
        else if (isPdfFile(file.name)) { setPdfFile(file); setPreviewFile(null); setPlayingFile(null); }
        else { setPreviewFile(file); setPlayingFile(null); setPdfFile(null); }
    };

    const navigatePreview = useCallback((step: 1 | -1) => {
        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId || previewContextFiles.length === 0) return;
        const currentIndex = previewContextFiles.findIndex((f) => f.id === currentFileId);
        const nextIndex = (currentIndex + step + previewContextFiles.length) % previewContextFiles.length;
        const nextFile = previewContextFiles[nextIndex];
        setPreviewContextIndex(nextIndex);
        if (isMediaFile(nextFile.name)) { setPlayingFile(nextFile); setPreviewFile(null); setPdfFile(null); }
        else if (isPdfFile(nextFile.name)) { setPdfFile(nextFile); setPreviewFile(null); setPlayingFile(null); }
        else { setPreviewFile(nextFile); setPlayingFile(null); setPdfFile(null); }
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    const handleNextPreview = useCallback(() => navigatePreview(1), [navigatePreview]);
    const handlePrevPreview = useCallback(() => navigatePreview(-1), [navigatePreview]);

    const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: number | null) => {
        e.preventDefault(); e.stopPropagation();
        const fileId = internalDragRef.current;
        if (fileId && activeFolderId !== targetFolderId) {
            const idsToMove = selectedIds.includes(fileId) ? selectedIds : [fileId];
            try { await api.moveFiles(idsToMove, [], activeFolderId ?? undefined, targetFolderId ?? undefined); queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] }); toast.success(`Moved ${idsToMove.length} file(s)`); }
            catch { toast.error('Move failed'); }
        }
    };

    const currentFolderName = activeFolderId === null ? "Saved Messages" : folders.find(f => f.id === activeFolderId)?.name || "Folder";

    const previewNeighbors = (() => {
        if (previewContextFiles.length === 0) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        const currentIdx = previewContextFiles.findIndex((f) => f.id === currentFileId);
        if (currentIdx === -1) return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        return { nextFile: previewContextFiles[(currentIdx + 1) % previewContextFiles.length], prevFile: previewContextFiles[(currentIdx - 1 + previewContextFiles.length) % previewContextFiles.length] };
    })();

    useEffect(() => { setSelectedIds([]); setShowMoveModal(false); setSearchTerm(""); setSearchResults([]); setPreviewFile(null); setPlayingFile(null); setPdfFile(null); }, [activeFolderId]);
    useEffect(() => { if (searchTerm.length <= 2) { setSearchResults([]); return; } const timer = setTimeout(async () => { setIsSearching(true); setSearchResults(await handleGlobalSearch(searchTerm)); setIsSearching(false); }, 500); return () => clearTimeout(timer); }, [searchTerm]);

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="flex h-screen w-full overflow-hidden bg-dynamic-mesh relative" onClick={() => setSelectedIds([])}>
            <AnimatePresence>
                {showMoveModal && <MoveToFolderModal folders={folders} onClose={() => setShowMoveModal(false)} onSelect={handleBulkMove} activeFolderId={activeFolderId} key="move-modal" />}
                {playingFile && <MediaPlayer file={playingFile} onClose={() => setPlayingFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} activeFolderId={activeFolderId} key="media-player" />}
                {pdfFile && <PdfViewer file={pdfFile} onClose={() => setPdfFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} activeFolderId={activeFolderId} key="pdf-viewer" />}
                {isDragging && internalDragFileId === null && <DragDropOverlay key="drag-drop-overlay" />}
                {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} key="settings-modal" />}
                {showHistory && <TransferLogs onClose={() => setShowHistory(false)} key="history-modal" />}
                {propertyFile && <PropertiesModal file={propertyFile} onClose={() => setPropertyFile(null)} key="props-modal" />}
                {showAi && <AiAssistant onClose={() => setShowAi(false)} currentFolderFiles={allFiles} key="ai-modal" />}
            </AnimatePresence>

            <Sidebar folders={folders} activeFolderId={activeFolderId} setActiveFolderId={setActiveFolderId} onDrop={handleDropOnFolder} onDelete={handleFolderDelete} onCreate={handleCreateFolder} onRename={handleRename} isSyncing={isSyncing} isConnected={isConnected} userInfo={userInfo} onSync={syncFolders} onLogout={handleLogout} onSettings={() => setShowSettingsModal(true)} bandwidth={bandwidth || null} />

            <button onClick={() => setShowHistory(true)} className="fixed bottom-6 left-72 z-40 p-3 bg-telegram-surface border border-telegram-border rounded-full shadow-lg hover:bg-telegram-hover text-telegram-secondary transition-all hover:scale-110 group" title="Transfer History">
                <History className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            </button>
            <button onClick={() => setShowAi(prev => !prev)} className={`fixed bottom-6 right-8 z-40 p-4 rounded-2xl shadow-2xl transition-all hover:scale-110 active:scale-95 group flex items-center gap-2 border ${showAi ? 'bg-purple-600 border-purple-400 text-white' : 'bg-telegram-surface border-telegram-border text-purple-400 hover:bg-white/5'}`} title="AI Assistant">
                <Bot className={`w-6 h-6 ${showAi ? 'animate-bounce' : 'group-hover:rotate-12 transition-transform'}`} />
                {!showAi && <span className="text-xs font-bold uppercase tracking-wider pr-1">Ask AI</span>}
            </button>

            <main className="flex-1 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds([]); }}>
                <TopBar selectedIds={selectedIds} onShowMoveModal={() => setShowMoveModal(true)} onBulkDownload={handleBulkDownload} onBulkDelete={handleBulkDelete} onManualUpload={handleManualUpload} onFolderUpload={handleFolderUpload} onCreateFolder={async () => { const name = window.prompt("Enter folder name:"); if (name) await handleCreateFolder(name, activeFolderId || undefined); }} viewSettings={viewSettings} onUpdateViewSettings={onUpdateViewSettings} searchTerm={searchTerm} onSearchChange={setSearchTerm} />
                {searchTerm.length > 2 && <div className="px-6 pt-4 pb-0"><h2 className="text-sm font-medium text-telegram-subtext">Search Results for <span className="text-telegram-primary">"{searchTerm}"</span></h2></div>}
                <FileExplorer files={displayedFiles} loading={isLoading || isSearching} error={error} viewSettings={viewSettings} onUpdateViewSettings={onUpdateViewSettings} selectedIds={selectedIds} activeFolderId={activeFolderId} onFileClick={handleFileClick} onDelete={handleDelete} onDownload={(id, name) => { api.downloadFile(activeFolderId ?? 0, id).then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }).catch(() => toast.error('Download failed')); }} onPreview={handlePreview} onManualUpload={handleManualUpload} onFolderUpload={handleFolderUpload} handleDroppedFiles={handleDroppedFiles} onSelectionClear={() => setSelectedIds([])} onToggleSelection={handleToggleSelection} onDrop={(e, targetId) => handleDropOnFolder(e, targetId)} onDragStart={(fileId) => setInternalDragFileId(fileId)} onDragEnd={() => setTimeout(() => setInternalDragFileId(null), 50)} onRename={handleRename} onMove={() => setShowMoveModal(true)} onOpenFolder={(id) => setActiveFolderId(id)} onProperties={(file) => { if (!file) setPropertyFile({ id: activeFolderId || 0, name: currentFolderName, type: 'folder', icon_type: 'folder' } as any); else setPropertyFile(file); }} />
            </main>

            {previewFile && <PreviewModal file={previewFile} activeFolderId={activeFolderId} onClose={() => setPreviewFile(null)} onNext={handleNextPreview} onPrev={handlePrevPreview} currentIndex={previewContextIndex} totalItems={previewContextFiles.length} nextFile={previewNeighbors.nextFile} prevFile={previewNeighbors.prevFile} />}

            <UploadQueue items={[]} onClearFinished={() => {}} onCancelAll={() => {}} />
            <DownloadQueue items={[]} onClearFinished={() => {}} onCancelAll={() => {}} />
        </motion.div>
    );
}
