import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, Folder } from 'lucide-react';
import { FileCard } from './FileCard';
import { EmptyState } from './EmptyState';
import { TelegramFile, ViewSettings } from '../../types';
import { ContextMenu } from './ContextMenu';
import { FileListItem } from './FileListItem';
import { PreviewPane } from './PreviewPane';

interface FileExplorerProps {
    files: TelegramFile[];
    loading: boolean;
    error: Error | null;
    viewSettings: ViewSettings;
    onUpdateViewSettings: (settings: Partial<ViewSettings>) => void;
    selectedIds: number[];
    activeFolderId: number | null;
    onFileClick: (e: React.MouseEvent, id: number) => void;
    onDelete: (id: number) => void;
    onDownload: (id: number, name: string, size: number) => void;
    onPreview: (file: TelegramFile, orderedFiles?: TelegramFile[]) => void;
    onManualUpload: () => void;
    onFolderUpload: () => void;
    handleDroppedFiles: (paths: string[]) => void;
    onSelectionClear: () => void;
    onToggleSelection: (id: number) => void;
    onDrop?: (e: React.DragEvent, folderId: number | null) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onRename: (id: number, currentName: string, isFolder: boolean) => void;
    onCut: (ids: number[]) => void;
    onCopy: (ids: number[]) => void;
    onMove: () => void;
    onPaste: () => void;
    canPaste: boolean;
    onProperties: (file?: TelegramFile) => void;
    onOpenFolder?: (folderId: number) => void;
}

function useGridColumns(containerRef: React.RefObject<HTMLDivElement | null>) {
    const [columns, setColumns] = useState(4);
    const [containerWidth, setContainerWidth] = useState(800);

    useEffect(() => {
        if (!containerRef.current) return;
        const updateColumns = () => {
            const width = containerRef.current?.clientWidth || 800;
            setContainerWidth(width);
            if (width < 640) setColumns(2);
            else if (width < 768) setColumns(3);
            else if (width < 1024) setColumns(4);
            else if (width < 1280) setColumns(5);
            else setColumns(6);
        };
        updateColumns();
        const observer = new ResizeObserver(updateColumns);
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [containerRef]);

    return { columns, containerWidth };
}

export function FileExplorer({
    files, loading, error, viewSettings, onUpdateViewSettings, selectedIds, activeFolderId,
    onFileClick, onDelete, onDownload, onPreview, onManualUpload, onFolderUpload, handleDroppedFiles,
    onSelectionClear, onToggleSelection, onDrop, onDragStart, onDragEnd,
    onRename, onCut, onCopy, onMove, onPaste, canPaste, onProperties, onOpenFolder
}: FileExplorerProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file?: TelegramFile; isFolder?: boolean } | null>(null);
    const [isOSDragging, setIsOSDragging] = useState(false);

    const parentRef = useRef<HTMLDivElement>(null);
    const { columns, containerWidth } = useGridColumns(parentRef);

    const GAP = 8;
    const cardWidth = (containerWidth - (GAP * (columns - 1))) / columns;
    const cardHeight = cardWidth * 0.85; 

    const handleContextMenu = useCallback((e: React.MouseEvent, file: TelegramFile) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, file });
    }, []);

    const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, isFolder: true });
    }, []);

    const sortedFiles = useMemo(() => {
        return [...files].sort((a, b) => {
            let comparison = 0;
            switch (viewSettings.sortField) {
                case 'name': comparison = a.name.localeCompare(b.name); break;
                case 'size': comparison = (a.size || 0) - (b.size || 0); break;
                case 'date': comparison = (a.created_at || '').localeCompare(b.created_at || ''); break;
                case 'type': comparison = (a.type || '').localeCompare(b.type || ''); break;
            }
            return viewSettings.sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [files, viewSettings.sortField, viewSettings.sortDirection]);

    const groupedItems = useMemo(() => {
        if (viewSettings.groupBy === 'none') return [{ title: '', items: sortedFiles }];

        const groups: { title: string; items: TelegramFile[] }[] = [];
        const groupMap: Record<string, TelegramFile[]> = {};

        sortedFiles.forEach(file => {
            let key = 'Other';
            if (viewSettings.groupBy === 'type') {
                key = file.type === 'folder' ? 'Folders' : (file.name.split('.').pop()?.toUpperCase() || 'Other');
            } else if (viewSettings.groupBy === 'date') {
                // Simplified date grouping
                const date = file.created_at ? new Date(file.created_at) : new Date();
                const now = new Date();
                const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));
                if (diffDays === 0) key = 'Today';
                else if (diffDays === 1) key = 'Yesterday';
                else if (diffDays < 7) key = 'Earlier this week';
                else if (diffDays < 30) key = 'Earlier this month';
                else key = 'Long ago';
            }
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(file);
        });

        Object.keys(groupMap).forEach(title => {
            groups.push({ title, items: groupMap[title] });
        });

        // Sort groups (Folders first, then by title)
        return groups.sort((a, b) => {
            if (a.title === 'Folders') return -1;
            if (b.title === 'Folders') return 1;
            return a.title.localeCompare(b.title);
        });
    }, [sortedFiles, viewSettings.groupBy]);

    const handlePreviewRequest = useCallback((file: TelegramFile) => {
        onPreview(file, sortedFiles);
    }, [onPreview, sortedFiles]);

    const handleOSDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsOSDragging(false);
        const paths = (e as any).dataTransfer?.files 
            ? Array.from((e as any).dataTransfer.files).map((f: any) => f.path).filter(Boolean)
            : [];
        if (paths.length > 0) {
            handleDroppedFiles(paths);
        }
    }, [handleDroppedFiles]);

    if (loading) {
        return (
            <div className="flex-1 p-6 flex justify-center items-center text-telegram-subtext flex-col gap-4">
                <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin"></div>
                Loading your files...
            </div>
        )
    }

    if (error) return <div className="flex-1 p-6 flex justify-center items-center text-red-400">Error loading files</div>;

    if (files.length === 0) {
        return (
            <div className="flex-1 p-6 overflow-auto">
                <EmptyState onUpload={onManualUpload} />
            </div>
        );
    }

    const selectedFile = selectedIds.length === 1 ? files.find(f => f.id === selectedIds[0]) : null;

    return (
        <div className="flex-1 flex overflow-hidden relative">
            <div
                ref={parentRef}
                className={`flex-1 p-4 overflow-auto custom-scrollbar transition-all ${isOSDragging ? 'bg-telegram-primary/5 ring-2 ring-inset ring-telegram-primary' : ''}`}
                onClick={(e) => { if (e.target === e.currentTarget) onSelectionClear(); }}
                onContextMenu={handleRootContextMenu}
                onDragOver={(e) => { e.preventDefault(); setIsOSDragging(true); }}
                onDragLeave={() => setIsOSDragging(false)}
                onDrop={handleOSDrop}
            >
                {groupedItems.map((group, groupIdx) => (
                    <div key={group.title || 'root'} className={groupIdx > 0 ? 'mt-8' : ''}>
                        {group.title && (
                            <div className="flex items-center gap-2 mb-3 px-2">
                                <span className="text-xs font-bold text-telegram-subtext uppercase tracking-widest">{group.title}</span>
                                <div className="flex-1 h-px bg-telegram-border"></div>
                            </div>
                        )}

                        {viewSettings.viewMode === 'grid' ? (
                            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                                {group.items.map((file) => (
                                    <FileCard
                                        key={file.id}
                                        file={file}
                                        isSelected={selectedIds.includes(file.id)}
                                        onClick={(e) => onFileClick(e, file.id)}
                                        onContextMenu={(e) => handleContextMenu(e, file)}
                                        onDelete={() => onDelete(file.id)}
                                        onDownload={() => onDownload(file.id, file.name, file.size)}
                                        onPreview={() => handlePreviewRequest(file)}
                                        onDrop={onDrop}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        activeFolderId={activeFolderId}
                                        height={cardHeight}
                                        onToggleSelection={() => onToggleSelection(file.id)}
                                        onDoubleClick={file.type === 'folder' ? () => onOpenFolder?.(file.id) : () => handlePreviewRequest(file)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-0.5">
                                {groupIdx === 0 && (
                                    <div className="grid grid-cols-[2rem_2fr_6rem_8rem] gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-telegram-subtext border-b border-telegram-border mb-2 select-none items-center">
                                        <div className="text-center">#</div>
                                        <div>Name</div>
                                        <div className="text-right">Size</div>
                                        <div className="text-right">Modified</div>
                                    </div>
                                )}
                                {group.items.map((file) => (
                                    <FileListItem
                                        key={file.id}
                                        file={file}
                                        selectedIds={selectedIds}
                                        onFileClick={onFileClick}
                                        handleContextMenu={handleContextMenu}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        onDrop={onDrop}
                                        onPreview={handlePreviewRequest}
                                        onDownload={(id, name, size) => onDownload(id, name, size)}
                                        onDelete={onDelete}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {/* Upload Buttons for root */}
                {activeFolderId === null && (
                    <div className="mt-8 flex gap-4">
                        <button onClick={onManualUpload} className="flex-1 h-24 border-2 border-dashed border-telegram-border rounded-xl flex flex-col items-center justify-center text-telegram-subtext hover:border-telegram-primary hover:text-telegram-primary transition-all group bg-telegram-surface/50">
                            <Plus className="w-6 h-6 mb-1 group-hover:scale-110 transition-transform" />
                            <span className="text-xs font-bold uppercase tracking-widest">Upload File</span>
                        </button>
                        <button onClick={onFolderUpload} className="flex-1 h-24 border-2 border-dashed border-telegram-border rounded-xl flex flex-col items-center justify-center text-telegram-subtext hover:border-telegram-primary hover:text-telegram-primary transition-all group bg-telegram-surface/50">
                            <Folder className="w-6 h-6 mb-1 group-hover:scale-110 transition-transform" />
                            <span className="text-xs font-bold uppercase tracking-widest">Upload Folder</span>
                        </button>
                    </div>
                )}
            </div>

            {viewSettings.showPreviewPane && (
                <PreviewPane 
                    file={selectedFile || null} 
                    onClose={() => onUpdateViewSettings({ showPreviewPane: false })}
                    onDownload={onDownload}
                    onDelete={onDelete}
                />
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    file={contextMenu.file}
                    isFolderContext={contextMenu.isFolder}
                    onClose={() => setContextMenu(null)}
                    onDownload={() => {
                        if (contextMenu.file) onDownload(contextMenu.file.id, contextMenu.file.name, contextMenu.file.size);
                        setContextMenu(null);
                    }}
                    onDelete={() => {
                        if (contextMenu.file) onDelete(contextMenu.file.id);
                        setContextMenu(null);
                    }}
                    onPreview={() => {
                        if (contextMenu.file) {
                            if (contextMenu.file.type === 'folder') onFileClick({ preventDefault: () => { }, stopPropagation: () => { } } as React.MouseEvent, contextMenu.file.id);
                            else handlePreviewRequest(contextMenu.file);
                        }
                        setContextMenu(null);
                    }}
                    onRename={() => {
                        if (contextMenu.file) onRename(contextMenu.file.id, contextMenu.file.name, contextMenu.file.type === 'folder');
                        setContextMenu(null);
                    }}
                    onCut={() => {
                        if (contextMenu.file) {
                            const ids = selectedIds.includes(contextMenu.file.id) ? selectedIds : [contextMenu.file.id];
                            onCut(ids);
                        }
                        setContextMenu(null);
                    }}
                    onCopy={() => {
                        if (contextMenu.file) {
                            const ids = selectedIds.includes(contextMenu.file.id) ? selectedIds : [contextMenu.file.id];
                            onCopy(ids);
                        }
                        setContextMenu(null);
                    }}
                    onMove={() => {
                        if (contextMenu.file && !selectedIds.includes(contextMenu.file.id)) onToggleSelection(contextMenu.file.id);
                        onMove();
                        setContextMenu(null);
                    }}
                    canPaste={canPaste}
                    onPaste={() => { onPaste(); setContextMenu(null); }}
                    onProperties={() => { onProperties(contextMenu.file); setContextMenu(null); }}
                />
            )}
        </div>
    )
}
