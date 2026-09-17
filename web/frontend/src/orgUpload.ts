// Pure org upload-queue helpers (no React/DOM — unit-tested in orgUpload.test.ts).
import { waitingEntries } from './uploadQueue';

export type OrgUploadStatus = 'staged' | 'uploading' | 'success' | 'error' | 'cancelled';

export interface OrgUploadItem {
  id: string;
  file: File;
  name: string;
  /** Nested folder path from a folder upload (`docs/sub` for `docs/sub/file.pdf`). Empty for single files. */
  dirs: string[];
  size: number;
  progress: number;
  status: OrgUploadStatus;
  error?: string;
}

/** Split a `webkitRelativePath` (`docs/sub/file.pdf`) into dir parts + file name. */
export function splitRelativePath(relativePath: string): { dirs: string[]; fileName: string } {
  const parts = relativePath.split('/').filter((p) => p !== '');
  if (parts.length <= 1) return { dirs: [], fileName: relativePath };
  return { dirs: parts.slice(0, -1), fileName: parts[parts.length - 1] };
}

/** Items still waiting to be uploaded (the re-entrancy guard relies on this being empty). */
export function stagedUploads<T extends { id: string; status: string; progress: number }>(queue: T[]): T[] {
  return waitingEntries(queue, ['staged']);
}

/** Large files go through the resumable chunked endpoint; small ones via single POST. */
export function needsChunkedUpload(sizeBytes: number, chunkSizeBytes: number): boolean {
  return sizeBytes > chunkSizeBytes;
}

export interface OrgFolderRef {
  id: number;
  name: string;
  parent_id?: number | null;
}

/** Lookup key for a child folder under a parent (`0` = root). */
export function childFolderKey(parentId: number | undefined, name: string): string {
  return `${parentId ?? 0}/${name}`;
}

/**
 * Index folders by parent/name so folder-upload structure can be matched without duplicates.
 * First occurrence wins, so repeated scans stay deterministic under same-name collisions.
 */
export function buildFolderIndex(folders: OrgFolderRef[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const f of folders) {
    const key = childFolderKey(f.parent_id ?? undefined, f.name);
    if (!index.has(key)) index.set(key, f.id);
  }
  return index;
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'ico']);

/** True for files worth fetching an inline thumbnail for (mime first, extension fallback). */
export function isPreviewableImage(name: string, mimeType?: string | null): boolean {
  if (mimeType?.toLowerCase().startsWith('image/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.has(ext);
}
