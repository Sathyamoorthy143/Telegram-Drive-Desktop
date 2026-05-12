export interface TelegramFile {
    id: number;
    name: string;
    size: number;
    sizeStr: string; // Formatted size
    created_at?: string;
    type?: 'folder' | 'file'; // implied icon_type
    // Add other fields if backend sends them
}

export interface TelegramFolder {
    id: number;
    name: string;
    parent_id?: number;
}

export interface QueueItem {
    id: string;
    path: string;
    size: number;
    folderId: number | null;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number; // 0-100
    speed?: number; // bytes per second
    eta?: number; // seconds
}

export interface BandwidthStats {
    up_bytes: number;
    down_bytes: number;
}

export interface DownloadItem {
    id: string;
    messageId: number;
    filename: string;
    size: number;
    folderId: number | null;
    status: 'pending' | 'downloading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number; // 0-100
    speed?: number; // bytes per second
    eta?: number; // seconds
}

export interface UserInfo {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    phone?: string;
}
export interface FolderMetadata {
    id: number;
    name: string;
    parent_id?: number;
    size?: number;
    file_count?: number;
}

export type i64 = number;
export type bool = boolean;

export type SortField = 'name' | 'size' | 'date' | 'type';
export type SortDirection = 'asc' | 'desc';
export type GroupBy = 'none' | 'type' | 'date';

export interface ViewSettings {
    viewMode: 'grid' | 'list';
    groupBy: GroupBy;
    showPreviewPane: boolean;
    sortField: SortField;
    sortDirection: SortDirection;
}

export interface FileClipboard {
    type: 'cut' | 'copy';
    messageIds: number[];
    folderIds: number[];
    sourceFolderId: number | null;
}
