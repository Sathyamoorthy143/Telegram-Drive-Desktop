import { useState } from 'react';
import { Folder, Eye, HardDrive, Plus } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';

interface FileListItemProps {
    file: TelegramFile;
    selectedIds: number[];
    onFileClick: (e: React.MouseEvent, id: number) => void;
    handleContextMenu: (e: React.MouseEvent, file: TelegramFile) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onPreview: (file: TelegramFile) => void;
    onDownload: (id: number, name: string, size: number) => void;
    onDelete: (id: number) => void;
}

export function FileListItem({
    file, selectedIds, onFileClick, handleContextMenu,
    onDragStart, onDragEnd, onDrop,
    onPreview, onDownload, onDelete
}: FileListItemProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const isFolder = file.type === 'folder';

    return (
        <div
            onClick={(e) => onFileClick(e, file.id)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            draggable
            onDragStart={(e) => {
                if (onDragStart) onDragStart(file.id);
                e.dataTransfer.setData("application/x-telegram-file-id", file.id.toString());
                e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
                if (onDragEnd) onDragEnd();
            }}
            onDragOver={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isDragOver) setIsDragOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                }
            }}
            onDrop={(e) => {
                if (isFolder && onDrop) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    onDrop(e, file.id);
                }
            }}
            className={`group grid grid-cols-[2.5rem_2fr_7rem_9rem] gap-2 items-center px-2 py-1.5 rounded-md cursor-pointer border border-transparent transition-all hover:bg-telegram-hover/50
                ${selectedIds.includes(file.id) ? 'bg-telegram-primary/10 border-telegram-primary/20' : ''}
                ${isDragOver ? 'ring-2 ring-telegram-primary bg-telegram-primary/20' : ''}
            `}
        >
            <div className="flex justify-center">
                {isFolder ? <Folder className="w-4 h-4 text-telegram-primary" /> : <FileTypeIcon filename={file.name} className="w-4 h-4" />}
            </div>
            <div className="truncate text-xs text-telegram-text font-semibold relative pr-8">
                {file.name}
                {/* List Actions */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center bg-telegram-surface border border-telegram-border shadow-md rounded overflow-hidden">
                    <button onClick={(e) => { e.stopPropagation(); onPreview(file) }} className="p-1 hover:bg-telegram-hover hover:text-telegram-primary text-telegram-subtext transition-colors" title="Preview"><Eye className="w-3.5 h-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); onDownload(file.id, file.name, file.size) }} className="p-1 hover:bg-telegram-hover hover:text-telegram-primary text-telegram-subtext transition-colors" title="Download"><HardDrive className="w-3.5 h-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(file.id) }} className="p-1 hover:bg-red-500/10 hover:text-red-400 text-telegram-subtext transition-colors" title="Delete"><Plus className="w-3.5 h-3.5 rotate-45" /></button>
                </div>
            </div>
            <div className="text-right text-[11px] text-telegram-subtext truncate pr-2">{isFolder ? '--' : file.sizeStr}</div>
            <div className="text-right text-[11px] text-telegram-subtext font-medium opacity-60 truncate pr-2">{file.created_at || '-'}</div>
        </div>
    );
}
