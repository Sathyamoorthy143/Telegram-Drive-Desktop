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

export function isMediaFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return MEDIA_EXTENSIONS.has(ext);
}

export function isPdfFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return PDF_EXTENSIONS.has(ext);
}

export function getFileExtension(name: string): string {
    return name.split('.').pop()?.toLowerCase() || '';
}
