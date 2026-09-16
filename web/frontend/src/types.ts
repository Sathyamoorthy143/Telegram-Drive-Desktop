export interface TelegramFile {
    id: number;
    folder_id?: number;
    name: string;
    size: number;
    mime_type?: string;
    file_ext?: string;
    created_at: string;
    icon_type: string;
    type?: 'file' | 'folder';
    sizeStr?: string;
}

export interface FolderMetadata {
    id: number;
    name: string;
    parent_id?: number;
}

export type TelegramFolder = FolderMetadata;

export interface BandwidthStats {
    up_bytes: number;
    down_bytes: number;
}

export interface FileClipboard {
    type: 'cut' | 'copy';
    messageIds: number[];
    folderIds: number[];
    sourceFolderId?: number | null;
    canPaste: boolean;
}

export type SortField = 'name' | 'date' | 'type' | 'size';
export type GroupBy = 'none' | 'type' | 'date';

export interface ViewSettings {
    viewMode: 'grid' | 'list' | 'tree';
    groupBy: GroupBy;
    showPreviewPane: boolean;
    sortField: SortField;
    sortDirection: 'asc' | 'desc';
}

export interface UserInfo {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    phone?: string;
}

export interface TransferProgress {
    id: string;
    percent: number;
    speed: number;
    eta: number;
}

export interface QueueItem {
    id: string;
    path: string;
    name?: string;
    size: number;
    folderId: number | null;
    status: 'staged' | 'pending' | 'uploading' | 'success' | 'error' | 'cancelled' | 'paused';
    error?: string;
    progress?: number;
    speed?: number;
    eta?: number;
    uploadId?: string;
    // Checkbox selection: user ticks which staged/pending files should upload.
    // Defaults to true when omitted.
    selected?: boolean;
}

export interface DownloadItem {
    id: string;
    messageId: number;
    filename: string;
    name?: string;
    size: number;
    folderId: number | null;
    status: 'pending' | 'downloading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number;
    speed?: number;
    eta?: number;
}

export interface AppSettings {
    telegram_api_id?: number;
    theme?: string;
    auto_login?: boolean;
    encryption_enabled?: boolean;
}

// ---- Multi-org platform ----

export interface Organization {
    id: string;
    name: string;
    subdomain: string;
    master_admin_id?: string;
    created_at?: string;
    active?: boolean;
}

export interface OrgMember {
    id: string;
    org_id: string;
    username: string;
    role: 'viewer' | 'editor' | 'admin' | 'owner';
    created_at?: string;
}

export interface OrgSession {
    token: string;
    org_id: string;
    member_id: string;
    username: string;
    role: string;
}

export interface OrgSettings {
    org_id: string;
    channel_id?: number;
    backup_channel_id?: number;
    lock_pin_hash?: string;
    lock_interval_ms?: number;
    notification_mode?: string;
}

export interface AuditEntry {
    id?: string;
    org_id: string;
    user_id?: string;
    action: string;
    target_type?: string;
    target_id?: string;
    details?: any;
    ip_address?: string;
    user_agent?: string;
    created_at?: string;
}

export interface OrgTrashItem {
    id?: string;
    org_id: string;
    message_id: number;
    folder_id: number;
    name: string;
    size: number;
    deleted_at?: string;
    restored_at?: string;
}

export interface OrgOverviewEntry {
    id: string;
    name: string;
    subdomain: string;
    active?: boolean;
    created_at?: string;
    member_count: number;
    trash_count: number;
    has_audit: boolean;
    provisioned: boolean;
    channel_id?: number;
    backup_channel_id?: number;
}
