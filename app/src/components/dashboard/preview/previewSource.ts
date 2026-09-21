import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/**
 * Ask the Rust side to download the file to a local temp path (same command
 * the image preview uses), then read it back as a Blob via the asset protocol.
 */
export async function loadPreviewBlob(fileId: number, folderId: number | null): Promise<Blob> {
    const path = await invoke<string>('cmd_get_preview', { messageId: fileId, folderId });
    const res = await fetch(convertFileSrc(path));
    if (!res.ok) throw new Error('Failed to read preview file');
    return res.blob();
}

export type AppPreviewKind =
    | 'image'
    | 'text'
    | 'code'
    | 'office-doc'
    | 'office-sheet'
    | 'office-slide'
    | 'unknown';

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'ico', 'tiff']);
const DOC_EXT = new Set(['doc', 'docx', 'odt', 'rtf']);
const SHEET_EXT = new Set(['xls', 'xlsx', 'ods']);
const SLIDE_EXT = new Set(['ppt', 'pptx', 'odp']);
const CODE_EXT = new Set(['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'toml', 'md', 'sh', 'bat', 'sql', 'rb', 'php']);
const TEXT_EXT = new Set(['txt', 'log', 'ini', 'env', 'cfg', 'conf', 'csv']);

/** Classify a file name for the built-in preview (desktop app edition). */
export function appPreviewKind(name: string): AppPreviewKind {
    const ext = (name || '').split('.').pop()?.toLowerCase() || '';
    if (IMG_EXT.has(ext)) return 'image';
    if (ext === 'csv') return 'office-sheet';
    if (DOC_EXT.has(ext)) return 'office-doc';
    if (SHEET_EXT.has(ext)) return 'office-sheet';
    if (SLIDE_EXT.has(ext)) return 'office-slide';
    if (CODE_EXT.has(ext)) return 'code';
    if (TEXT_EXT.has(ext)) return 'text';
    return 'unknown';
}
