import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import { TelegramFile, BandwidthStats, FileClipboard, ViewSettings } from '../types';
import { formatBytes, isMediaFile, isPdfFile } from '../utils';

// Components
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
import { ExternalDropBlocker } from './dashboard/ExternalDropBlocker';
import { PdfViewer } from './dashboard/PdfViewer';
import { SettingsModal } from './dashboard/SettingsModal';
import { TransferLogs } from './dashboard/TransferLogs';
import { PropertiesModal } from './dashboard/PropertiesModal';
import { AiAssistant } from './dashboard/AiAssistant';

// Hooks
import { useTelegramConnection } from '../hooks/useTelegramConnection';
import { useFileOperations } from '../hooks/useFileOperations';
import { useFileUpload } from '../hooks/useFileUpload';
import { useFileDownload } from '../hooks/useFileDownload';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

export function Dashboard({ onLogout }: { onLogout: () => void }) {
    const queryClient = useQueryClient();


    const {
        store, folders, activeFolderId, setActiveFolderId, isSyncing, isConnected,
        userInfo, handleLogout, handleSyncFolders, handleCreateFolder, handleFolderDelete
    } = useTelegramConnection(onLogout);


    const [previewFile, setPreviewFile] = useState<TelegramFile | null>(null);
    const [viewSettings, setViewSettings] = useState<ViewSettings>({
        viewMode: 'grid',
        groupBy: 'none',
        showPreviewPane: false,
        sortField: 'name',
        sortDirection: 'asc'
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

    useEffect(() => {
        if (store) {
            store.get<ViewSettings>('viewSettings').then((saved) => {
                if (saved) setViewSettings(saved);
                else {
                    store.get<'grid' | 'list'>('viewMode').then((oldMode) => {
                        if (oldMode) setViewSettings((v: ViewSettings) => ({ ...v, viewMode: oldMode }));
                    });
                }
            });
        }
    }, [store]);

    useEffect(() => {
        if (store) {
            store.set('viewSettings', viewSettings).then(() => store.save());
        }
    }, [store, viewSettings]);

    const { data: allFiles = [], isLoading, error } = useQuery({
        queryKey: ['files', activeFolderId],
        queryFn: () => invoke<any[]>('cmd_get_files', { folderId: activeFolderId }).then(res => res.map(f => ({
            ...f,
            sizeStr: formatBytes(f.size),
            type: f.icon_type || (f.name.endsWith('/') ? 'folder' : 'file')
        }))),
        enabled: !!store,
    });

    const subFolders = folders
        .filter(f => f.parent_id === activeFolderId)
        .map(f => ({
            ...f,
            size: 0, // Properties modal will load this
            sizeStr: "Folder",
            type: 'folder' as const,
            created_at: '',
            icon_type: 'folder'
        }));

    const combinedFiles = [...subFolders, ...allFiles];

    const displayedFiles = searchTerm.length > 2
        ? searchResults
        : combinedFiles.filter((f: any) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => invoke<BandwidthStats>('cmd_get_bandwidth'),
        refetchInterval: 5000,
        enabled: !!store
    });


    const {
        handleDelete, handleBulkDelete, handleBulkDownload,
        handleBulkMove, handleDownloadFolder, handleGlobalSearch,
        handleRename, handleCut, handleCopy, handlePaste

    } = useFileOperations(activeFolderId, selectedIds, setSelectedIds, displayedFiles, clipboard, setClipboard);

    const {
        uploadQueue, setUploadQueue, handleManualUpload, handleFolderUpload, handleDroppedFiles, cancelAll: cancelUploads, isDragging
    } = useFileUpload(activeFolderId, store);
    const { downloadQueue, queueDownload, clearFinished: clearDownloads, cancelAll: cancelDownloads } = useFileDownload(store);

    const onUpdateViewSettings = (settings: Partial<ViewSettings>) => {
        setViewSettings((prev: ViewSettings) => ({ ...prev, ...settings }));
    };


    const handleSelectAll = useCallback(() => {
        setSelectedIds(displayedFiles.map(f => f.id));
    }, [displayedFiles]);

    const handleKeyboardDelete = useCallback(() => {
        if (selectedIds.length > 0) {
            handleBulkDelete();
        }
    }, [selectedIds, handleBulkDelete]);

    const handleEscape = useCallback(() => {
        setSelectedIds([]);
        setSearchTerm("");
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
    }, []);

    const handleFocusSearch = useCallback(() => {
        const searchInput = document.querySelector('input[placeholder="Search files..."]') as HTMLInputElement;
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }, []);

    const handleEnter = useCallback(() => {
        if (selectedIds.length === 1) {
            const selected = displayedFiles.find(f => f.id === selectedIds[0]);
            if (selected) {
                if (selected.type === 'folder') {
                    setActiveFolderId(selected.id);
                } else {
                    handlePreview(selected, displayedFiles);
                }
            }
        }
    }, [selectedIds, displayedFiles, setActiveFolderId]);

    useKeyboardShortcuts({
        onSelectAll: handleSelectAll,
        onDelete: handleKeyboardDelete,
        onEscape: handleEscape,
        onSearch: handleFocusSearch,
        onEnter: handleEnter,
        enabled: !previewFile && !playingFile && !pdfFile && !showMoveModal // Disable when modals are open
    });


    useEffect(() => {
        setSelectedIds([]);
        setShowMoveModal(false);
        setSearchTerm("");
        setSearchResults([]);
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
        setPreviewContextFiles([]);
        setPreviewContextIndex(-1);
    }, [activeFolderId]);


    useEffect(() => {
        if (searchTerm.length <= 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            const results = await handleGlobalSearch(searchTerm);
            setSearchResults(results);
            setIsSearching(false);
        }, 500);

        return () => clearTimeout(timer);
    }, [searchTerm]);




    const handleFileClick = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) {
            setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
        } else {
            setSelectedIds([id]);
        }
    }

    const handleToggleSelection = useCallback((id: number) => {
        setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }, []);

    const handlePreview = (file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        const contextFiles = (orderedFiles || displayedFiles).filter((f) => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex((f) => f.id === file.id);

        setPreviewContextFiles(contextFiles);
        setPreviewContextIndex(contextIndex);

        const isMedia = isMediaFile(file.name);
        const isPdf = isPdfFile(file.name);

        if (isMedia) {
            setPlayingFile(file);
            setPreviewFile(null);
            setPdfFile(null);
        } else if (isPdf) {
            setPdfFile(file);
            setPreviewFile(null);
            setPlayingFile(null);
        } else {
            setPreviewFile(file);
            setPlayingFile(null);
            setPdfFile(null);
        }
    };

    const navigatePreview = useCallback((step: 1 | -1) => {
        if (previewContextFiles.length === 0) return;

        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) return;

        const currentIndex = previewContextFiles.findIndex((f) => f.id === currentFileId);
        if (currentIndex === -1) return;

        const nextIndex = (currentIndex + step + previewContextFiles.length) % previewContextFiles.length;
        const nextFile = previewContextFiles[nextIndex];
        if (!nextFile) return;

        setPreviewContextIndex(nextIndex);

        const isMedia = isMediaFile(nextFile.name);
        const isPdf = isPdfFile(nextFile.name);

        if (isMedia) {
            setPlayingFile(nextFile);
            setPreviewFile(null);
            setPdfFile(null);
        } else if (isPdf) {
            setPdfFile(nextFile);
            setPreviewFile(null);
            setPlayingFile(null);
        } else {
            setPreviewFile(nextFile);
            setPlayingFile(null);
            setPdfFile(null);
        }
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    const handleNextPreview = useCallback(() => {
        navigatePreview(1);
    }, [navigatePreview]);

    const handlePrevPreview = useCallback(() => {
        navigatePreview(-1);
    }, [navigatePreview]);

    const previewNeighborFiles = useCallback(() => {
        if (previewContextFiles.length === 0) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const currentIdx = previewContextFiles.findIndex((f) => f.id === currentFileId);
        if (currentIdx === -1) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const nextIdx = (currentIdx + 1) % previewContextFiles.length;
        const prevIdx = (currentIdx - 1 + previewContextFiles.length) % previewContextFiles.length;

        return {
            nextFile: previewContextFiles[nextIdx] || null,
            prevFile: previewContextFiles[prevIdx] || null,
        };
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: number | null) => {
        e.preventDefault();
        e.stopPropagation();

        const dataTransferFileId = e.dataTransfer.getData("application/x-telegram-file-id");

        if (activeFolderId === targetFolderId) return;

        const fileId = internalDragRef.current || (dataTransferFileId ? parseInt(dataTransferFileId) : null);

        if (fileId) {
            try {
                const idsToMove = selectedIds.includes(fileId) ? selectedIds : [fileId];

                await invoke('cmd_move_files', {
                    messageIds: idsToMove,
                    sourceFolderId: activeFolderId,
                    targetFolderId: targetFolderId
                });

                queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });

                if (selectedIds.includes(fileId)) setSelectedIds([]);

                toast.success(`Moved ${idsToMove.length} file(s).`);

                setInternalDragFileId(null);
            } catch {
                toast.error(`Failed to move file(s).`);
            }
        }
    }

    const currentFolderName = activeFolderId === null
        ? "Saved Messages"
        : folders.find(f => f.id === activeFolderId)?.name || "Folder";


    const handleRootDragOver = (e: React.DragEvent) => {
        if (internalDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    };

    const handleRootDragEnter = (e: React.DragEvent) => {
        if (internalDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    };

    const previewNeighbors = previewNeighborFiles();

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="flex h-screen w-full overflow-hidden bg-dynamic-mesh relative"
            onClick={() => setSelectedIds([])}
            onDragOver={handleRootDragOver}
            onDragEnter={handleRootDragEnter}
        >

            <ExternalDropBlocker onUploadClick={handleManualUpload} />

            <AnimatePresence>
                {showMoveModal && (
                    <MoveToFolderModal
                        folders={folders}
                        onClose={() => setShowMoveModal(false)}
                        onSelect={handleBulkMove}
                        activeFolderId={activeFolderId}
                        key="move-modal"
                    />
                )}
                {playingFile && (
                    <MediaPlayer
                        file={playingFile}
                        onClose={() => setPlayingFile(null)}
                        onNext={handleNextPreview}
                        onPrev={handlePrevPreview}
                        currentIndex={previewContextIndex}
                        totalItems={previewContextFiles.length}
                        activeFolderId={activeFolderId}
                        key="media-player"
                    />
                )}
                {pdfFile && (
                    <PdfViewer
                        file={pdfFile}
                        onClose={() => setPdfFile(null)}
                        onNext={handleNextPreview}
                        onPrev={handlePrevPreview}
                        currentIndex={previewContextIndex}
                        totalItems={previewContextFiles.length}
                        activeFolderId={activeFolderId}
                        key="pdf-viewer"
                    />
                )}
                {isDragging && internalDragFileId === null && <DragDropOverlay key="drag-drop-overlay" />}
                {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} key="settings-modal" />}
                {showHistory && <TransferLogs onClose={() => setShowHistory(false)} key="history-modal" />}
                {propertyFile && <PropertiesModal file={propertyFile} onClose={() => setPropertyFile(null)} key="props-modal" />}
                {showAi && <AiAssistant onClose={() => setShowAi(false)} currentFolderFiles={allFiles} key="ai-modal" />}
            </AnimatePresence>

            <Sidebar
                folders={folders}
                activeFolderId={activeFolderId}
                setActiveFolderId={setActiveFolderId}
                onDrop={handleDropOnFolder}
                onDelete={handleFolderDelete}
                onCreate={handleCreateFolder}
                onRename={(id, name) => handleRename(id, name, true)}
                onCut={(id) => handleCut([id])}
                onCopy={(id) => handleCopy([id])}
                onPaste={handlePaste}
                canPaste={!!clipboard}
                onProperties={(id) => {
                    if (id === null) {
                        setPropertyFile({
                            id: 0,
                            name: "Saved Messages",
                            type: 'folder',
                            icon_type: 'folder'
                        } as any);
                    } else {
                        const f = folders.find(folder => folder.id === id);
                        if (f) setPropertyFile({ ...f, type: 'folder', icon_type: 'folder' } as any);
                    }
                }}
                isSyncing={isSyncing}
                isConnected={isConnected}
                userInfo={userInfo}
                onSync={handleSyncFolders}
                onLogout={handleLogout}
                onSettings={() => setShowSettingsModal(true)}
                bandwidth={bandwidth || null}
            />
            
            {/* Floating History Toggle Button */}
            <button 
                onClick={() => setShowHistory(true)}
                className="fixed bottom-6 left-72 z-40 p-3 bg-telegram-surface border border-telegram-border rounded-full shadow-lg hover:bg-telegram-hover text-telegram-secondary transition-all hover:scale-110 group"
                title="Transfer History"
            >
                <History className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            </button>

            {/* Floating AI Assistant Toggle Button */}
            <button 
                onClick={() => setShowAi(prev => !prev)}
                className={`fixed bottom-6 right-8 z-40 p-4 rounded-2xl shadow-2xl transition-all hover:scale-110 active:scale-95 group flex items-center gap-2 border ${showAi ? 'bg-purple-600 border-purple-400 text-white' : 'bg-telegram-surface border-telegram-border text-purple-400 hover:bg-white/5'}`}
                title="AI Assistant"
            >
                <Bot className={`w-6 h-6 ${showAi ? 'animate-bounce' : 'group-hover:rotate-12 transition-transform'}`} />
                {!showAi && <span className="text-xs font-bold uppercase tracking-wider pr-1">Ask AI</span>}
            </button>

            <main className="flex-1 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds([]); }}>
                <TopBar
                    selectedIds={selectedIds}
                    onShowMoveModal={() => setShowMoveModal(true)}
                    onBulkDownload={handleBulkDownload}
                    onBulkDelete={handleBulkDelete}
                    onManualUpload={handleManualUpload}
                    onFolderUpload={handleFolderUpload}
                    onCreateFolder={() => handleCreateFolder()}
                    onPaste={handlePaste}
                    canPaste={!!clipboard}
                    viewSettings={viewSettings}
                    onUpdateViewSettings={onUpdateViewSettings}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                />
                {searchTerm.length > 2 && (
                    <div className="px-6 pt-4 pb-0">
                        <h2 className="text-sm font-medium text-telegram-subtext">
                            Search Results for <span className="text-telegram-primary">"{searchTerm}"</span>
                        </h2>
                    </div>
                )}
                <FileExplorer
                    files={displayedFiles}
                    loading={isLoading || isSearching}
                    error={error}
                    viewSettings={viewSettings}
                    onUpdateViewSettings={onUpdateViewSettings}
                    selectedIds={selectedIds}
                    activeFolderId={activeFolderId}
                    onFileClick={handleFileClick}
                    onDelete={handleDelete}
                    onDownload={(id, name, size) => queueDownload(id, name, size, activeFolderId)}
                    onPreview={handlePreview}
                    onManualUpload={handleManualUpload}
                    onFolderUpload={handleFolderUpload}
                    handleDroppedFiles={handleDroppedFiles}
                    onSelectionClear={() => setSelectedIds([])}
                    onToggleSelection={handleToggleSelection}
                    onDrop={(e, targetId) => handleDropOnFolder(e, targetId)}
                    onDragStart={(fileId) => setInternalDragFileId(fileId)}
                    onDragEnd={() => setTimeout(() => setInternalDragFileId(null), 50)}
                    onRename={handleRename}
                    onCut={handleCut}
                    onCopy={handleCopy}
                    onMove={() => setShowMoveModal(true)}
                    onPaste={handlePaste}
                    canPaste={!!clipboard}
                    onProperties={(file) => {
                        if (!file) {
                            // Properties for the current folder
                            setPropertyFile({
                                id: activeFolderId || 0,
                                name: currentFolderName,
                                type: 'folder',
                                icon_type: 'folder'
                            } as any);
                        } else {
                            setPropertyFile(file);
                        }
                    }}
                />
            </main>

            {previewFile && (
                <PreviewModal
                    file={previewFile}
                    activeFolderId={activeFolderId}
                    onClose={() => setPreviewFile(null)}
                    onNext={handleNextPreview}
                    onPrev={handlePrevPreview}
                    currentIndex={previewContextIndex}
                    totalItems={previewContextFiles.length}
                    nextFile={previewNeighbors.nextFile}
                    prevFile={previewNeighbors.prevFile}
                />
            )}


            <UploadQueue
                items={uploadQueue}
                onClearFinished={() => setUploadQueue(q => q.filter(i => i.status !== 'success' && i.status !== 'error' && i.status !== 'cancelled'))}
                onCancelAll={cancelUploads}
            />
            <DownloadQueue
                items={downloadQueue}
                onClearFinished={clearDownloads}
                onCancelAll={cancelDownloads}
            />
        </motion.div>
    );
}
