import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Search, Folder as FolderIcon, Upload, FolderPlus, Star, Clock,
    Trash2, Settings, Activity, History, FileArchive, CornerDownLeft,
    Command as CommandIcon, type LucideIcon,
} from 'lucide-react';
import { TelegramFile, FolderMetadata } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    folders?: FolderMetadata[];
    selectedCount: number;
    onOpenFolder: (id: number) => void;
    onPreviewFile: (file: TelegramFile) => void;
    onManualUpload: () => void;
    onFolderUpload: () => void;
    onSettings: () => void;
    onStarred: () => void;
    onRecent: () => void;
    onTrash: () => void;
    onActivity: () => void;
    onVersions: () => void;
    onDownloadSelectedZip?: () => void;
}

type Row =
    | { kind: 'action'; label: string; icon: LucideIcon; run: () => void }
    | { kind: 'folder'; name: string; id: number }
    | { kind: 'file'; file: TelegramFile };

const searchFilesApi = (query: string) => import('../../api').then((m) => m.searchFiles(query));

/**
 * ⌘K command palette: jump to files/folders and fire common actions without
 * touching the mouse. Debounced server search + local folder/action filter.
 */
export function CommandPalette({
    open, onClose, folders, selectedCount, onOpenFolder, onPreviewFile, onManualUpload,
    onFolderUpload, onSettings, onStarred, onRecent, onTrash, onActivity, onVersions,
    onDownloadSelectedZip,
}: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<TelegramFile[]>([]);
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Reset on open + autofocus
    useEffect(() => {
        if (open) {
            setQuery('');
            setResults([]);
            setIndex(0);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    // Debounced server file search
    useEffect(() => {
        if (!open || !query.trim()) { setResults([]); return; }
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const rows = await searchFilesApi(query.trim());
                if (!cancelled) setResults(Array.isArray(rows) ? rows.slice(0, 8) : []);
            } catch { if (!cancelled) setResults([]); }
        }, 250);
        return () => clearTimeout(t);
    }, [open, query]);

    const q = query.trim().toLowerCase();

    const rows = useMemo<Row[]>(() => {
        if (!open) return [];
        const actions: Row[] = [
            { kind: 'action', label: 'Upload file', icon: Upload, run: onManualUpload },
            { kind: 'action', label: 'Upload folder', icon: FolderPlus, run: onFolderUpload },
            { kind: 'action', label: 'Go to Saved Messages', icon: Search, run: onClose },
            { kind: 'action', label: 'Starred', icon: Star, run: onStarred },
            { kind: 'action', label: 'Recent', icon: Clock, run: onRecent },
            { kind: 'action', label: 'Trash', icon: Trash2, run: onTrash },
            { kind: 'action', label: 'Activity log', icon: Activity, run: onActivity },
            { kind: 'action', label: 'All versions', icon: History, run: onVersions },
            { kind: 'action', label: 'Settings', icon: Settings, run: onSettings },
        ];
        if (selectedCount >= 2 && onDownloadSelectedZip) {
            actions.unshift({ kind: 'action', label: `Download ${selectedCount} selected as ZIP`, icon: FileArchive, run: onDownloadSelectedZip });
        }
        const folderRows: Row[] = (folders || [])
            .filter((f) => !q || f.name.toLowerCase().includes(q))
            .slice(0, 5)
            .map((f) => ({ kind: 'folder', name: f.name, id: f.id }));

        const fileRows: Row[] = results.map((f) => ({ kind: 'file', file: f }));

        if (!q) return [...folderRows, ...actions];
        const filteredActions = actions.filter((a) => a.kind !== 'action' || (a as any).label.toLowerCase().includes(q));
        return [...filteredActions, ...folderRows, ...fileRows];
    }, [open, q, folders, results, selectedCount, onManualUpload, onFolderUpload, onClose, onStarred, onRecent, onTrash, onActivity, onVersions, onSettings, onDownloadSelectedZip]);

    // Keep selection in bounds
    useEffect(() => {
        setIndex((i) => Math.min(i, Math.max(0, rows.length - 1)));
    }, [rows.length]);

    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [index]);

    const runRow = (row: Row) => {
        onClose();
        if (row.kind === 'action') row.run();
        else if (row.kind === 'folder') onOpenFolder(row.id);
        else onPreviewFile(row.file);
    };

    // Keyboard navigation
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, rows.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); const row = rows[index]; if (row) runRow(row); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, rows, index, onClose, onOpenFolder, onPreviewFile]);

    if (!open) return null;

    return (
        <div
                className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[10vh] p-4"
                onMouseDown={onClose}
                role="presentation"
            >
                <div
                    className="w-full max-w-xl bg-telegram-surface border border-telegram-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                    onMouseDown={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Command palette"
                >
                    {/* Search input */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-telegram-border" role="search">
                        <Search className="w-4 h-4 text-telegram-subtext shrink-0" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
                            placeholder="Search files, folders, actions…"
                            className="flex-1 bg-transparent outline-none text-telegram-text placeholder-telegram-muted text-sm"
                            aria-label="Search files, folders, and actions"
                        />
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-telegram-hover text-telegram-subtext border border-telegram-border" aria-label="Press Escape to close">ESC</kbd>
                    </div>

                {/* Results */}
                <div ref={listRef} className="max-h-[55vh] overflow-y-auto custom-scrollbar py-1.5">
                    {rows.length === 0 && (
                        <p className="px-4 py-6 text-sm text-telegram-muted text-center">No matches for “{query}”.</p>
                    )}
                    {rows.map((row, i) => {
                        const selected = i === index;
                        const base = `flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors ${selected ? 'bg-telegram-active text-telegram-text' : 'text-telegram-subtext hover:bg-telegram-hover'}`;
                        if (row.kind === 'action') {
                            const Icon = row.icon;
                            return (
                                <div
                                    key={`a-${row.label}`}
                                    data-row-index={i}
                                    onMouseEnter={() => setIndex(i)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => runRow(row)}
                                    className={base}
                                    role="option"
                                    aria-selected={selected}
                                    tabIndex={selected ? 0 : -1}
                                >
                                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                                    <span className="flex-1">{row.label}</span>
                                    {selected && <CornerDownLeft className="w-3.5 h-3.5 text-telegram-muted" aria-hidden="true" />}
                                </div>
                            );
                        }
                        if (row.kind === 'folder') {
                            return (
                                <div
                                    key={`f-${row.id}`}
                                    data-row-index={i}
                                    onMouseEnter={() => setIndex(i)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => runRow(row)}
                                    className={base}
                                    role="option"
                                    aria-selected={selected}
                                    tabIndex={selected ? 0 : -1}
                                >
                                    <FolderIcon className="w-4 h-4 text-telegram-primary shrink-0" aria-hidden="true" />
                                    <span className="flex-1 truncate">{row.name}</span>
                                    <span className="text-[10px] uppercase tracking-widest text-telegram-muted" aria-label="folder">folder</span>
                                </div>
                            );
                        }
                        return (
                            <div
                                key={`file-${row.file.id}`}
                                data-row-index={i}
                                onMouseEnter={() => setIndex(i)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => runRow(row)}
                                className={base}
                                role="option"
                                aria-selected={selected}
                                tabIndex={selected ? 0 : -1}
                            >
                                <FileTypeIcon filename={row.file.name} size="sm" aria-hidden="true" />
                                <span className="flex-1 truncate">{row.file.name}</span>
                                <span className="text-[10px] uppercase tracking-widest text-telegram-muted" aria-label="file">file</span>
                            </div>
                        );
                    })}
                </div>

                {/* Footer hints */}
                <div className="flex items-center gap-4 px-4 py-2 border-t border-telegram-border text-[10px] text-telegram-muted">
                    <span className="flex items-center gap-1"><kbd className="px-1 rounded bg-telegram-hover border border-telegram-border">↑↓</kbd> navigate</span>
                    <span className="flex items-center gap-1"><kbd className="px-1 rounded bg-telegram-hover border border-telegram-border">↵</kbd> run</span>
                    <span className="ml-auto flex items-center gap-1"><CommandIcon className="w-3 h-3" />K to toggle</span>
                </div>
            </div>
        </div>
    );
}

