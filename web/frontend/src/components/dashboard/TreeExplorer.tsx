import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, HardDrive, Eye, Loader2, Search } from 'lucide-react';
import { FolderMetadata, TelegramFile } from '../../types';
import { buildFolderTree, FolderNode } from '../../utils/treeUtils';
import { FileTypeIcon } from '../FileTypeIcon';
import { formatBytes } from '../../utils';
import * as api from '../../api';

interface TreeExplorerProps {
    folders: FolderMetadata[];
    activeFolderId: number | null;
    selectedIds: number[];
    onOpenFolder: (id: number | null) => void;
    onPreview: (file: TelegramFile) => void;
    onToggleSelection: (id: number) => void;
    onFileClick: (e: React.MouseEvent, id: number) => void;
}

interface FolderFiles {
    files: TelegramFile[];
    loading: boolean;
    error?: string;
}

const ROOT_KEY = 'root';
const keyOf = (folderId: number | null) => (folderId === null ? ROOT_KEY : `f:${folderId}`);

export function TreeExplorer({
    folders, activeFolderId, selectedIds, onOpenFolder, onPreview, onToggleSelection, onFileClick,
}: TreeExplorerProps) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({ [ROOT_KEY]: true });
    const [cache, setCache] = useState<Record<string, FolderFiles>>({});
    const [filter, setFilter] = useState('');

    const loadFolder = useCallback(async (folderId: number | null) => {
        const key = keyOf(folderId);
        setCache(prev => {
            if (prev[key]) return prev;
            return { ...prev, [key]: { files: [], loading: true } };
        });
        // skip if already cached (check inside updater above isn't readable; re-check)
        try {
            const res = await api.getFiles(folderId ?? undefined);
            const mapped: TelegramFile[] = res.map((f: any) => ({
                ...f,
                folder_id: folderId ?? undefined,
                sizeStr: formatBytes(f.size),
                type: f.icon_type || 'file',
            }));
            setCache(prev => ({ ...prev, [key]: { files: mapped, loading: false } }));
        } catch (e: any) {
            setCache(prev => {
                if (prev[key]?.files?.length) return { ...prev, [key]: { ...prev[key], loading: false } };
                return { ...prev, [key]: { files: [], loading: false, error: e?.message || 'Failed to load' } };
            });
        }
    }, []);

    const toggle = useCallback((folderId: number | null) => {
        const key = keyOf(folderId);
        const willOpen = !expanded[key];
        setExpanded(prev => ({ ...prev, [key]: willOpen }));
        if (willOpen) loadFolder(folderId);
    }, [expanded, loadFolder]);

    const q = filter.trim().toLowerCase();
    const matchesQ = useCallback((name: string) => !q || name.toLowerCase().includes(q), [q]);

    const renderFiles = (folderId: number | null, depth: number) => {
        const key = keyOf(folderId);
        const entry = cache[key];
        if (!entry) {
            loadFolder(folderId);
            return (
                <div className="flex items-center gap-2 py-1 text-[11px] text-telegram-subtext" style={{ paddingLeft: depth * 16 + 28 }}>
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                </div>
            );
        }
        if (entry.loading && entry.files.length === 0) {
            return (
                <div className="flex items-center gap-2 py-1 text-[11px] text-telegram-subtext" style={{ paddingLeft: depth * 16 + 28 }}>
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                </div>
            );
        }
        if (entry.error && entry.files.length === 0) {
            return <div className="py-1 text-[11px] text-red-400" style={{ paddingLeft: depth * 16 + 28 }}>{entry.error}</div>;
        }
        const files = entry.files.filter(f => matchesQ(f.name));
        if (files.length === 0) return null;
        return (
            <>
                {files.map(f => {
                    const selected = selectedIds.includes(f.id);
                    return (
                        <div
                            key={`${key}:${f.id}`}
                            onClick={(e) => onFileClick(e, f.id)}
                            onDoubleClick={() => onPreview({ ...f, folder_id: folderId ?? undefined } as TelegramFile)}
                            className={`group flex items-center gap-2 py-1 pr-2 rounded-md cursor-pointer hover:bg-telegram-hover/60 ${selected ? 'bg-telegram-primary/10' : ''}`}
                            style={{ paddingLeft: depth * 16 + 28 }}
                            title="Double-click to preview"
                        >
                            <FileTypeIcon filename={f.name} className="w-4 h-4 shrink-0" />
                            <span className="flex-1 min-w-0 truncate text-xs text-telegram-text">{f.name}</span>
                            <span className="text-[10px] text-telegram-subtext shrink-0">{(f as any).sizeStr || formatBytes(f.size)}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); onPreview({ ...f, folder_id: folderId ?? undefined } as TelegramFile); }}
                                className="p-1 opacity-0 group-hover:opacity-100 hover:text-telegram-primary text-telegram-subtext transition-all shrink-0"
                                title="Preview"
                            >
                                <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onToggleSelection(f.id); }}
                                className={`w-3.5 h-3.5 shrink-0 rounded border transition-all ${selected ? 'bg-telegram-primary border-telegram-primary' : 'border-telegram-subtext/40 opacity-0 group-hover:opacity-100'}`}
                                title="Select"
                            />
                        </div>
                    );
                })}
            </>
        );
    };

    const renderNode = (node: FolderNode | null, depth: number): React.ReactNode => {
        const folderId = node ? node.id : null;
        const key = keyOf(folderId);
        const isOpen = !!expanded[key];
        const isActive = activeFolderId === folderId || (folderId === null && activeFolderId === null);
        const children = node ? node.children : buildFolderTree(folders);
        const name = node ? node.name : 'Saved Messages';
        const Icon = folderId === null ? HardDrive : isOpen ? FolderOpen : Folder;

        // filter: show node if name matches or any descendant matches
        if (q) {
            const inSubtree = (n: FolderNode | null): boolean => {
                if (matchesQ(n ? n.name : 'Saved Messages')) return true;
                const kids = n ? n.children : buildFolderTree(folders);
                if (kids.some(inSubtree)) return true;
                const entry = cache[keyOf(n ? n.id : null)];
                return !!entry?.files.some(f => matchesQ(f.name));
            };
            if (!inSubtree(node)) return null;
        }

        const subCount = children.length;
        const fileCount = cache[key]?.files.length;

        return (
            <div key={key}>
                <div
                    className={`group flex items-center gap-1.5 py-1.5 pr-2 rounded-lg cursor-pointer hover:bg-telegram-hover/60 ${isActive ? 'bg-telegram-primary/10' : ''}`}
                    style={{ paddingLeft: depth * 16 + 8 }}
                    onClick={() => onOpenFolder(folderId)}
                    title="Open folder"
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); toggle(folderId); }}
                        className="p-0.5 hover:bg-white/10 rounded text-telegram-subtext shrink-0"
                    >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <Icon className={`w-4 h-4 shrink-0 ${folderId === null ? 'text-telegram-secondary' : 'text-yellow-500'}`} />
                    <span className="flex-1 min-w-0 truncate text-xs font-semibold text-telegram-text">{name}</span>
                    <span className="text-[10px] text-telegram-subtext shrink-0">
                        {subCount > 0 && `${subCount} folder${subCount > 1 ? 's' : ''}`}
                        {subCount > 0 && fileCount !== undefined && ' • '}
                        {fileCount !== undefined && `${fileCount} file${fileCount === 1 ? '' : 's'}`}
                    </span>
                </div>
                {isOpen && (
                    <div className="ml-2 border-l border-telegram-border/40 pl-1">
                        {children.map(child => renderNode(child, depth + 1))}
                        {renderFiles(folderId, depth + 1)}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-telegram-subtext" />
                    <input
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        placeholder="Filter tree..."
                        className="w-full bg-telegram-hover/50 border border-telegram-border rounded-full pl-8 pr-3 py-1.5 text-xs text-telegram-text placeholder:text-telegram-subtext focus:outline-none focus:border-telegram-primary/50"
                    />
                </div>
                <button
                    onClick={() => {
                        const all: Record<string, boolean> = { [ROOT_KEY]: true };
                        const walk = (nodes: FolderNode[]) => nodes.forEach(n => { all[`f:${n.id}`] = true; loadFolder(n.id); walk(n.children); });
                        walk(buildFolderTree(folders));
                        loadFolder(null);
                        setExpanded(all);
                    }}
                    className="text-[11px] text-telegram-primary hover:text-telegram-text shrink-0"
                >
                    Expand all
                </button>
                <button onClick={() => setExpanded({ [ROOT_KEY]: true })} className="text-[11px] text-telegram-subtext hover:text-telegram-text shrink-0">
                    Collapse
                </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4">
                {renderNode(null, 0)}
            </div>
        </div>
    );
}
