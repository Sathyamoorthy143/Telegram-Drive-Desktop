/**
 * Upload session persistence for resume-after-reload.
 * Chunked uploads store their server upload_id and file metadata here so the
 * engine can resume them after a browser reload.
 */

export interface PendingUploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  folderId: number | null;
  totalChunks: number;
  chunkSize: number;
  uploadedChunks: number[];
  fileSha256: string;
  orgId?: string;
  startedAt: number;
}

const STORAGE_KEY = 'td_upload_sessions';

export function getPendingSessions(): PendingUploadSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.uploadId) : [];
  } catch {
    return [];
  }
}

export function saveSession(session: PendingUploadSession): void {
  try {
    const existing = getPendingSessions();
    const filtered = existing.filter((s) => s.uploadId !== session.uploadId);
    filtered.push(session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Quota exceeded — clear old sessions and retry once
    try {
      const oldest = getPendingSessions().sort((a, b) => a.startedAt - b.startedAt).slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(oldest));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...getPendingSessions(), session]));
    } catch {}
  }
}

export function removeSession(uploadId: string): void {
  try {
    const existing = getPendingSessions();
    const filtered = existing.filter((s) => s.uploadId !== uploadId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {}
}

export function updateSessionProgress(uploadId: string, uploadedChunks: number[]): void {
  try {
    const existing = getPendingSessions();
    const idx = existing.findIndex((s) => s.uploadId === uploadId);
    if (idx >= 0) {
      existing[idx].uploadedChunks = uploadedChunks;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    }
  } catch {}
}

export function clearSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Return sessions that are recent enough to still be valid (< 24h old). */
export function getResumableSessions(maxAgeMs = 24 * 60 * 60 * 1000): PendingUploadSession[] {
  const now = Date.now();
  return getPendingSessions().filter((s) => now - s.startedAt < maxAgeMs);
}
