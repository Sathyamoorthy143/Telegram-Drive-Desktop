export function formatBytes(bytes: number, decimals = 2): string {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']);
const PDF_EXTENSIONS = new Set(['pdf']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma', 'amr']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'ico', 'tiff']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg']);
const EXEC_EXTENSIONS = new Set(['exe', 'msi', 'apk', 'bat', 'sh', 'app', 'pkg', 'sdk', 'bin']);

function endsWithAny(name: string, exts: Set<string>): boolean {
    const lower = name.toLowerCase();
    for (const ext of exts) {
        if (lower.endsWith(ext)) return true;
    }
    return false;
}

export function isMediaFile(name: string): boolean {
    return endsWithAny(name, MEDIA_EXTENSIONS);
}

export function isVideoFile(name: string): boolean {
    return endsWithAny(name, VIDEO_EXTENSIONS);
}

export function isAudioFile(name: string): boolean {
    return endsWithAny(name, AUDIO_EXTENSIONS);
}

export function isImageFile(name: string): boolean {
    return endsWithAny(name, IMAGE_EXTENSIONS);
}

export function isPdfFile(name: string): boolean {
    return endsWithAny(name, PDF_EXTENSIONS);
}

export function isArchiveFile(name: string): boolean {
    return endsWithAny(name, ARCHIVE_EXTENSIONS);
}

export function isExecutableFile(name: string): boolean {
    return endsWithAny(name, EXEC_EXTENSIONS);
}

export function isTextFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml', 'yaml', 'yml', 'py', 'rs', 'toml', 'csv', 'log', 'doc', 'docx', 'pdf', 'rtf'].includes(ext);
}

export function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
}

export function getFileExtension(name: string): string {
    return name.split('.').pop()?.toLowerCase() || '';
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'unknown';

export function getPreviewKind(file: { name: string; mime_type?: string; file_ext?: string }): PreviewKind {
    const ext = getFileExtension(file.name);
    const mime = (file.mime_type || '').toLowerCase();

    if (mime.startsWith('image/') || isImageFile(file.name)) return 'image';
    if (mime.startsWith('video/') || isVideoFile(file.name)) return 'video';
    if (mime.startsWith('audio/') || isAudioFile(file.name)) return 'audio';
    if (mime === 'application/pdf' || isPdfFile(file.name)) return 'pdf';
    if (isTextFile(file.name)) return 'text';
    if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'toml', 'md', 'sh', 'bat', 'sql', 'rb', 'php'].includes(ext)) return 'code';

    return 'unknown';
}

export type EditKind = 'doc' | 'sheet' | 'slide' | 'pdf' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'unknown';

export function getEditKind(file: { name: string; mime_type?: string; file_ext?: string }): EditKind {
    const ext = getFileExtension(file.name);

    if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'doc';
    if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'sheet';
    if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slide';
    if (ext === 'pdf') return 'pdf';
    if (isImageFile(file.name)) return 'image';
    if (isVideoFile(file.name)) return 'video';
    if (isAudioFile(file.name)) return 'audio';
    if (isArchiveFile(file.name)) return 'archive';
    if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'sql', 'rb', 'php', 'sh', 'yaml', 'yml', 'toml'].includes(ext)) return 'code';

    return 'unknown';
}
