export interface TelegramFile { id: number; folder_id?: number; name: string; size: number; mime_type?: string; file_ext?: string; created_at: string; icon_type: string; type?: 'file' | 'folder'; sizeStr?: string; }
export interface FolderMetadata { id: number; name: string; parent_id?: number; }
export interface BandwidthStats { up_bytes: number; down_bytes: number; }
export interface FileClipboard { type: 'cut' | 'copy'; messageIds: number[]; folderIds: number[]; sourceFolderId?: number | null; }
export type SortField = 'name' | 'date' | 'type' | 'size';
export type GroupBy = 'none' | 'type' | 'date';
export interface ViewSettings { viewMode: 'grid' | 'list'; groupBy: GroupBy; showPreviewPane: boolean; sortField: SortField; sortDirection: 'asc' | 'desc'; }
export interface UserInfo { id: number; first_name: string; last_name?: string; username?: string; phone?: string; }
export interface TransferProgress { id: string; percent: number; speed: number; eta: number; }

export interface QueueItem {
    id: string;
    name: string;
    size: number;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
    progress?: number;
    speed?: number;
    eta?: number;
    error?: string;
}

export interface DownloadItem {
    id: string;
    name: string;
    size: number;
    status: 'pending' | 'downloading' | 'success' | 'error' | 'cancelled';
    progress?: number;
    speed?: number;
    eta?: number;
    error?: string;
}
