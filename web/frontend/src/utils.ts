export function formatBytes(bytes: number, decimals = 2): string {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const MEDIA_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','mp4','webm','mov','avi','mkv']);
const PDF_EXT = new Set(['pdf']);
const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg']);
const VIDEO_EXT = new Set(['mp4','webm','mov','avi','mkv']);
const AUDIO_EXT = new Set(['mp3','wav','ogg','flac','aac','m4a']);

function getExt(name: string): string { return name.split('.').pop()?.toLowerCase() || ''; }

export function isMediaFile(name: string): boolean { return MEDIA_EXT.has(getExt(name)); }
export function isPdfFile(name: string): boolean { return PDF_EXT.has(getExt(name)); }
export function isImageFile(name: string): boolean { return IMAGE_EXT.has(getExt(name)); }
export function isVideoFile(name: string): boolean { return VIDEO_EXT.has(getExt(name)); }
export function isAudioFile(name: string): boolean { return AUDIO_EXT.has(getExt(name)); }

export function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
