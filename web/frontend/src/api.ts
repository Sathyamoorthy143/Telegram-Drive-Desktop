const API_BASE = import.meta.env.VITE_API_URL || '';

const LEGACY_ORG_TOKEN_KEY = 'td_org_token';
const orgTokenKey = (orgId: string) => `td_org_token_${orgId}`;

/**
 * Per-org token slots: staying signed into sdpk no longer wipes (or leaks
 * into) the acme session. `orgId` defaults to the active org context.
 * Reads fall back to the legacy single key once, then migrate.
 */
export function getOrgToken(orgId?: string | null): string | null {
  const id = orgId ?? getOrgContext();
  try {
    if (id) {
      const slot = localStorage.getItem(orgTokenKey(id));
      if (slot) return slot;
    }
    return localStorage.getItem(LEGACY_ORG_TOKEN_KEY);
  } catch { return null; }
}

export function setOrgToken(token: string | null, orgId?: string | null) {
  const id = orgId ?? getOrgContext();
  try {
    if (token && id) {
      localStorage.setItem(orgTokenKey(id), token);
      localStorage.removeItem(LEGACY_ORG_TOKEN_KEY);
    } else if (token) {
      localStorage.setItem(LEGACY_ORG_TOKEN_KEY, token);
    } else if (id) {
      localStorage.removeItem(orgTokenKey(id));
      // Also drop a legacy token that may belong to this org.
      if (getOrgId() === id) localStorage.removeItem(LEGACY_ORG_TOKEN_KEY);
    } else {
      localStorage.removeItem(LEGACY_ORG_TOKEN_KEY);
    }
  } catch {}
}

export function getOrgId(): string | null {
  try { return localStorage.getItem('td_org_id'); } catch { return null; }
}

export function setOrgId(orgId: string | null) {
  try {
    if (orgId) localStorage.setItem('td_org_id', orgId);
    else localStorage.removeItem('td_org_id');
  } catch {}
  _currentOrgId = orgId;
}

let _currentOrgId: string | null = null;
let _currentOrgSlug: string | null = null;

export function getOrgContext(): string | null {
  return _currentOrgId;
}

export function setOrgContext(orgId: string | null) {
  _currentOrgId = orgId;
  setOrgId(orgId);
  if (orgId === null) _currentOrgSlug = null;
}

export function getOrgSlug(): string | null {
  return _currentOrgSlug;
}

export function setOrgSlug(slug: string | null) {
  _currentOrgSlug = slug;
}

export async function api<T>(method: string, path: string, body?: any, options?: { signal?: AbortSignal }): Promise<T> {
  const isFormData = body instanceof FormData;

  const headers: Record<string, string> = {};
  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }
  // Org member auth travels on a separate header so it never clashes with
  // the (cookieless) master Telegram session. Scoped to the active org
  // context — other orgs' tokens are never attached.
  const orgToken = getOrgToken();
  if (orgToken) headers['X-Org-Token'] = orgToken;
  // Subdomain-first routing hint (backend also accepts ?subdomain=).
  if (_currentOrgSlug) headers['X-Org-Subdomain'] = _currentOrgSlug;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API Error ${res.status}`);
  }

  return res.json();
}

// Convenience methods matching the old Tauri command names
export const connect = (api_id: number) =>
  api<boolean>('POST', '/api/connect', { api_id });

export interface ConnectionStatus {
  connected: boolean;
  reason: 'ok' | 'unauthorized' | 'transport' | 'no_client' | string;
}

export const checkConnectionDetail = () =>
  api<ConnectionStatus>('GET', '/api/check-connection');

export const checkConnection = async () => {
  try {
    const res = await checkConnectionDetail();
    // Backwards compatible: older backends return a bare boolean.
    if (typeof res === 'boolean') return res;
    return res.connected;
  } catch {
    return false;
  }
};

export const requestCode = (phone: string, api_id: number, api_hash: string) =>
  api<string>('POST', '/api/auth/request-code', { phone, api_id, api_hash });

export const signIn = (code: string) =>
  api<{ success: boolean; next_step?: string; error?: string }>('POST', '/api/auth/sign-in', { code });

export const checkPassword = (password: string) =>
  api<{ success: boolean; next_step?: string; error?: string }>('POST', '/api/auth/check-password', { password });

export const getUserInfo = () =>
  api<{ id: number; first_name: string; last_name?: string; username?: string; phone?: string }>('GET', '/api/auth/user-info');

export const logout = () =>
  api<boolean>('POST', '/api/auth/logout');

export const getFiles = (folder_id?: number) => {
  const orgId = getOrgContext();
  if (orgId) return getOrgFiles(orgId, folder_id);
  return api<any[]>('GET', `/api/files${folder_id ? `?folder_id=${folder_id}` : ''}`);
};

export const uploadFile = (file: File, folder_id?: number, options?: { signal?: AbortSignal }) => {
  const orgId = getOrgContext();
  if (orgId) return uploadOrgFile(orgId, file, folder_id, options);
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) {
    formData.append('folder_id', folder_id.toString());
  }
  return api<string>('POST', '/api/files/upload', formData, options);
};

/**
 * Fail loud (never silently cross namespaces): wrappers without an org
 * equivalent must refuse under org context instead of hitting global
 * master endpoints with the wrong channel scope.
 */
function requireNoOrgContext(feature: string): void {
  if (getOrgContext()) {
    throw new Error(`${feature} is not available in organization context`);
  }
}

export const downloadFile = async (
  folder_id: number,
  message_id: number,
  options?: { signal?: AbortSignal },
): Promise<Blob> => {
  const orgId = getOrgContext();
  if (orgId) return downloadOrgFileBlob(orgId, folder_id, message_id, options);
  const res = await fetch(`${API_BASE}/api/files/${folder_id}/${message_id}/download`, {
    signal: options?.signal,
  });
  if (!res.ok) throw new Error('Download failed');
  return res.blob();
};

export const deleteFile = (message_id: number, folder_id?: number) => {
  const orgId = getOrgContext();
  if (orgId) return deleteOrgFile(orgId, message_id, folder_id);
  return api<boolean>('POST', '/api/files/delete', { message_id, folder_id });
};

export const moveFiles = (message_ids: number[], folder_ids: number[], source_folder_id?: number, target_folder_id?: number) => {
  requireNoOrgContext('Move');
  return api<boolean>('POST', '/api/files/move', { message_ids, folder_ids, source_folder_id, target_folder_id });
};

export const copyFiles = (message_ids: number[], folder_ids: number[], source_folder_id?: number, target_folder_id?: number) => {
  requireNoOrgContext('Copy');
  return api<boolean>('POST', '/api/files/copy', { message_ids, folder_ids, source_folder_id, target_folder_id });
};

export const searchFiles = (query: string) => {
  requireNoOrgContext('Search');
  return api<any[]>('GET', `/api/files/search?query=${encodeURIComponent(query)}`);
};

export const getBandwidth = () => {
  requireNoOrgContext('Bandwidth stats');
  return api<{ up_bytes: number; down_bytes: number }>('GET', '/api/bandwidth');
};

export const scanFolders = () => {
  const orgId = getOrgContext();
  if (orgId) return scanOrgFolders(orgId);
  return api<any[]>('GET', '/api/folders/scan');
};

export const createFolder = (name: string, parent_id?: number) => {
  const orgId = getOrgContext();
  if (orgId) return createOrgFolder(orgId, name, parent_id);
  return api<any>('POST', '/api/folders/create', { name, parent_id });
};

export const renameFolder = (id: number, new_name: string) => {
  requireNoOrgContext('Rename folder');
  return api<boolean>('PUT', `/api/folders/${id}/rename`, { new_name });
};

export const deleteFolder = (folder_id: number) => {
  requireNoOrgContext('Delete folder');
  return api<boolean>('DELETE', `/api/folders/${folder_id}/delete`, { folder_id });
};

export const getFolderProperties = (id: number) => {
  requireNoOrgContext('Folder properties');
  return api<{ file_count: number; total_size: number; created_at: string }>('GET', `/api/folders/${id}/properties`);
};

export const getStreamInfo = () =>
  api<{ token: string; base_url: string }>('GET', '/api/stream-info');

export const getStreamUrl = (folder_id: number | string, message_id: number, token?: string) =>
  `${API_BASE}/api/stream/${folder_id}/${message_id}${token ? `?token=${token}` : ''}`;

export const getPreviewUrl = (folder_id: number | string, message_id: number) =>
  `${API_BASE}/api/preview/${folder_id}/${message_id}`;

export const getThumbnailUrl = (folder_id: number | string, message_id: number) =>
  `${API_BASE}/api/thumbnail/${folder_id}/${message_id}`;

export const getSettings = () => {
  requireNoOrgContext('Master settings');
  return api<{ telegram_api_id?: number; theme?: string; auto_login?: boolean; encryption_enabled?: boolean }>('GET', '/api/settings');
};

export const saveSettings = (settings: { telegram_api_id?: number; theme?: string; auto_login?: boolean; encryption_enabled?: boolean }) => {
  requireNoOrgContext('Master settings');
  return api<boolean>('PUT', '/api/settings', settings);
};

export const getStore = async () => ({
  get: async <T>(key: string): Promise<T | null> => {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  },
  set: async (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
  delete: async (key: string) => localStorage.removeItem(key),
  save: async () => {},
});

export const CHUNK_SIZE = 1024 * 1024;

/**
 * Single routing threshold for chunked uploads. Files at or below this use
 * one POST (instant); above it they go chunked with hash manifest + resume.
 * Kept equal to the 8MB wire chunk size so small files never pay for a
 * one-chunk init/complete round trip.
 */
export const CHUNKED_UPLOAD_THRESHOLD = 8 * 1024 * 1024;

export const getTrash = () => {
  requireNoOrgContext('Master trash (use org trash instead)');
  return api<any[]>('GET', '/api/trash');
};

export const restoreTrash = (message_id: number, folder_id?: number) => {
  requireNoOrgContext('Master trash (use org trash instead)');
  return api<boolean>('POST', '/api/trash/restore', { message_id, folder_id });
};

export const emptyTrash = () => {
  requireNoOrgContext('Master trash (use org trash instead)');
  return api<boolean>('POST', '/api/trash/empty');
};

export const purgeTrash = (message_id: number, folder_id?: number) => {
  requireNoOrgContext('Master trash (use org trash instead)');
  return api<boolean>('POST', '/api/trash/purge', { message_id, folder_id });
};

export const getFavorites = () => {
  requireNoOrgContext('Favorites');
  return api<any[]>('GET', '/api/meta/favorites');
};

export const getRecent = () => {
  requireNoOrgContext('Recent');
  return api<any[]>('GET', '/api/meta/recent');
};

export const starFile = (message_id: number, folder_id: number, starred: boolean) => {
  requireNoOrgContext('Star');
  return api<boolean>('POST', '/api/meta/star', { message_id, folder_id, starred });
};

export const getTags = (message_id: number, folder_id?: number) => {
  requireNoOrgContext('Tags');
  return api<any[]>('GET', `/api/meta/tags?message_id=${message_id}${folder_id !== undefined ? `&folder_id=${folder_id}` : ''}`);
};

export const setTags = (message_id: number, tags: string[], folder_id?: number) => {
  requireNoOrgContext('Tags');
  return api<boolean>('PUT', '/api/meta/tags', { message_id, folder_id, tags });
};

export const createShare = (message_id: number, folder_id: number, expires_in?: number, password?: string) => {
  requireNoOrgContext('Share links');
  return api<{ url: string }>('POST', '/api/share', { message_id, folder_id, expiry_days: expires_in, password });
};

export const getShareUrl = (share_id: string) =>
  `${API_BASE}/s/${share_id}`;

export const getVersions = (name: string, folder_id?: number) => {
  requireNoOrgContext('Versions');
  return api<any[]>('GET', `/api/versions?name=${encodeURIComponent(name)}${folder_id !== undefined ? `&folder_id=${folder_id}` : ''}`);
};

export const getAllVersions = () => {
  requireNoOrgContext('Versions');
  return api<any[]>('GET', `/api/versions`);
};

export const restoreVersion = (message_id: number, version_message_id: number, folder_id?: number, name?: string) => {
  requireNoOrgContext('Versions');
  return api<boolean>('POST', '/api/versions/restore', { folder_id, name, version_message_id: version_message_id, current_message_id: message_id });
};

export const recordVersion = (message_id: number, folder_id: number, name: string) => {
  requireNoOrgContext('Versions');
  return api<boolean>('POST', '/api/versions/record', { message_id, folder_id, name });
};

export const logActivity = (action: string, detail?: string, name?: string) => {
  requireNoOrgContext('Activity log');
  return api<boolean>('POST', '/api/activity', { action, detail, name });
};

export const getActivity = () => {
  requireNoOrgContext('Activity log');
  return api<any[]>('GET', '/api/activity');
};

export const clearActivity = () => {
  requireNoOrgContext('Activity log');
  return api<boolean>('POST', '/api/activity/clear');
};

export const touchRecent = (message_id: number, folder_id: number, name?: string, size?: number) => {
  requireNoOrgContext('Recent');
  return api<boolean>('POST', '/api/meta/touch', { message_id, folder_id, name, size });
};

export const searchFilesAdvanced = (query: string, filters?: any) => {
  requireNoOrgContext('Search');
  return api<any[]>('GET', `/api/files/search?query=${encodeURIComponent(query)}${filters ? '&' + new URLSearchParams(filters).toString() : ''}`);
};

export const uploadFileResumable = (file: File, folder_id?: number, options?: {
  signal?: AbortSignal;
  resumeUploadId?: string;
  onProgress?: (done: number, total: number) => void;
  onUploadId?: (id: string) => void;
  waitIfPaused?: () => Promise<void>;
  isCancelled?: () => boolean;
}) => {
  const orgId = getOrgContext();
  if (orgId) return uploadOrgFileResumable(orgId, file, folder_id, options);
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) formData.append('folder_id', folder_id.toString());

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && options?.onProgress) options.onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(xhr.responseText || `Upload failed: ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    xhr.open('POST', `${API_BASE}/api/files/upload`);
    if (options?.signal?.aborted) {
      xhr.abort();
      return;
    }
    options?.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
};

export const uploadOrgFileResumable = (orgId: string, file: File, folder_id?: number, options?: {
  signal?: AbortSignal;
  resumeUploadId?: string;
  onProgress?: (done: number, total: number) => void;
  onUploadId?: (id: string) => void;
  waitIfPaused?: () => Promise<void>;
  isCancelled?: () => boolean;
}) => {
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) formData.append('folder_id', folder_id.toString());
  const orgToken = getOrgToken(orgId);

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && options?.onProgress) options.onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(xhr.responseText || `Upload failed: ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    xhr.open('POST', `${API_BASE}/api/org/${orgId}/files/upload`);
    if (orgToken) xhr.setRequestHeader('X-Org-Token', orgToken);
    if (options?.signal?.aborted) {
      xhr.abort();
      return;
    }
    options?.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
};

export const CHUNK_WORKERS = 8;
export const MAX_CONCURRENT_FILES = 4;

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const CHUNKED_SIZE = 8 * 1024 * 1024;

export const uploadFileChunked = (file: File, folder_id?: number, options?: {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onUploadId?: (id: string) => void;
  waitIfPaused?: () => Promise<void>;
  isCancelled?: () => boolean;
}) => {
  const orgId = getOrgContext();
  if (orgId) return uploadOrgFileChunked(orgId, file, folder_id, options);
  return _uploadFileChunked(null, file, folder_id, options);
};

export const uploadOrgFileChunked = (orgId: string, file: File, folder_id?: number, options?: {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onUploadId?: (id: string) => void;
  waitIfPaused?: () => Promise<void>;
  isCancelled?: () => boolean;
}) => _uploadFileChunked(orgId, file, folder_id, options);

async function _uploadFileChunked(
  orgId: string | null,
  file: File,
  folder_id?: number,
  options?: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    onUploadId?: (id: string) => void;
    waitIfPaused?: () => Promise<void>;
    isCancelled?: () => boolean;
  },
) {
  const total = file.size;
  const totalChunks = Math.ceil(total / CHUNKED_SIZE);
  const abortController = new AbortController();
  if (options?.signal?.aborted) abortController.abort();
  else options?.signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  const orgPrefix = orgId ? `/api/org/${orgId}` : '/api';
  const orgToken = orgId ? getOrgToken(orgId) : null;

  return (async () => {
    // Hash manifest: per-chunk SHA-256 plus the whole-file root over the
    // concatenated raw digests (same construction the server verifies).
    // Lets the server reject corrupt chunks instead of trusting the bytes.
    const chunkHashes: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (options?.isCancelled?.() || abortController.signal.aborted || options?.signal?.aborted) {
        throw new DOMException('cancelled', 'AbortError');
      }
      const start = i * CHUNKED_SIZE;
      const end = Math.min(start + CHUNKED_SIZE, total);
      chunkHashes.push(await sha256(await file.slice(start, end).arrayBuffer()));
    }
    const rootBytes = new Uint8Array(chunkHashes.length * 32);
    chunkHashes.forEach((h, i) => {
      const raw = h.match(/../g)?.map((b) => parseInt(b, 16)) ?? [];
      rootBytes.set(raw, i * 32);
    });
    const fileRoot = await sha256(rootBytes.buffer as ArrayBuffer);

    const initRes = await api<any>('POST', `${orgPrefix}/files/upload/init`, {
      name: file.name,
      size: total,
      folder_id,
      total_chunks: totalChunks,
      chunk_size: CHUNKED_SIZE,
      file_sha256: fileRoot,
      hashes: chunkHashes,
    });
    const uploadId = initRes.upload_id as string;
    options?.onUploadId?.(uploadId);

    // Seed from the server session too: if a previous attempt landed chunks
    // (or init raced), don't resend what the backend already holds.
    const uploaded = new Set<number>(initRes.received as number[]);
    try {
      const session = await api<any>('GET', `${orgPrefix}/files/upload/session?upload_id=${encodeURIComponent(uploadId)}`);
      for (const idx of (session?.received as number[]) || []) uploaded.add(idx);
    } catch {
      // Session lookup is best-effort; init's list still applies.
    }
    let doneBytes = uploaded.size * CHUNKED_SIZE;
    const speedMap = new Map<string, { t: number; done: number; speed: number }>();
    const report = (chunkIndex: number, chunkBytes: number) => {
      const now = Date.now();
      const prev = speedMap.get(`${chunkIndex}`);
      let speed = prev?.speed ?? 0;
      if (prev && now - prev.t >= 250 && chunkBytes > prev.done) {
        const inst = ((chunkBytes - prev.done) / (now - prev.t)) * 1000;
        speed = prev.speed > 0 ? prev.speed * 0.6 + inst * 0.4 : inst;
        speedMap.set(`${chunkIndex}`, { t: now, done: chunkBytes, speed });
      } else if (!prev) {
        speedMap.set(`${chunkIndex}`, { t: now, done: chunkBytes, speed: 0 });
      }
      doneBytes += chunkBytes;
      options?.onProgress?.(doneBytes, total);
    };

    const uploadChunk = async (index: number) => {
      if (options?.isCancelled?.() || abortController.signal.aborted || options?.signal?.aborted) return;
      const start = index * CHUNKED_SIZE;
      const end = Math.min(start + CHUNKED_SIZE, total);
      const blob = file.slice(start, end);
      const buffer = await blob.arrayBuffer();

      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (options?.isCancelled?.() || abortController.signal.aborted || options?.signal?.aborted) return;
        await options?.waitIfPaused?.();
        try {
          const chunkUrl = `${API_BASE}${orgPrefix}/files/upload/chunk?upload_id=${encodeURIComponent(uploadId)}&index=${index}&hash=${encodeURIComponent(chunkHashes[index])}`;
          const fetchOpts: RequestInit = {
            method: 'PUT',
            body: buffer,
            signal: abortController.signal,
          };
          if (orgToken) {
            fetchOpts.headers = { 'X-Org-Token': orgToken };
          }
          const res = await fetch(chunkUrl, fetchOpts);
          if (res.ok) {
            report(index, end - start);
            return index;
          }
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`Chunk ${index} transient: ${res.status}`);
          } else {
            throw new Error(`Chunk ${index} failed: ${res.status}`);
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') throw e;
          lastErr = e;
        }
        if (attempt < 2) {
          const backoff = 400 * Math.pow(2, attempt) + Math.random() * 200;
          await new Promise(r => setTimeout(r, backoff));
        }
      }
      throw lastErr || new Error(`Chunk ${index} failed after retries`);
    };

    const runWorker = async (queue: number[], workerIndex: number) => {
      while (queue.length > 0) {
        if (options?.isCancelled?.() || abortController.signal.aborted || options?.signal?.aborted) return;
        await options?.waitIfPaused?.();
        const idx = queue.shift();
        if (idx === undefined) return;
        if (uploaded.has(idx)) continue;
        await uploadChunk(idx);
        uploaded.add(idx);
      }
    };

    const pending = Array.from({ length: totalChunks }, (_, i) => i);
    const workers: Promise<void>[] = [];
    for (let w = 0; w < CHUNK_WORKERS; w++) {
      workers.push(runWorker(pending, w));
    }
    await Promise.all(workers);
    if (options?.isCancelled?.() || abortController.signal.aborted || options?.signal?.aborted) {
      throw new DOMException('cancelled', 'AbortError');
    }

    const complete = await api<any>('POST', `${orgPrefix}/files/upload/complete`, { upload_id: uploadId });
    return complete;
  })();
}

export const uploadFileWithProgress = (file: File, folder_id?: number, options?: {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}) => {
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) formData.append('folder_id', folder_id.toString());

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && options?.onProgress) options.onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(xhr.responseText || `Upload failed: ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    xhr.open('POST', `${API_BASE}/api/files/upload`);
    if (options?.signal?.aborted) {
      xhr.abort();
      return;
    }
    options?.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
};

// ---- Multi-org platform ----

export const getBackendCaps = () =>
  api<{ version: string; commit: string; org_platform?: boolean }>('GET', '/api/version');

export const getCurrentOrg = (subdomain?: string) =>
  api<{ org: { id: string; name: string; subdomain: string; active?: boolean } | null; subdomain: string | null }>(
    'GET', `/api/current-org${subdomain ? `?subdomain=${encodeURIComponent(subdomain)}` : ''}`);

export const getAdminOverview = () =>
  api<{ org_count: number; orgs: any[]; partial?: boolean }>('GET', '/api/admin/overview');

export const getOrganizations = () =>
  api<any[]>('GET', '/api/admin/organizations');

export const createOrganization = (name: string, subdomain: string) =>
  api<any>('POST', '/api/admin/organizations', { name, subdomain });

export const updateOrganization = (id: string, patch: { name?: string; active?: boolean }) =>
  api<boolean>('PUT', `/api/admin/organizations/${id}`, patch);

export const deleteOrganization = (id: string, hard = false) =>
  api<boolean>('DELETE', `/api/admin/organizations/${id}${hard ? '?hard=true' : ''}`);

export const getOrgSettings = (orgId: string, admin = false) =>
  api<any>('GET', admin ? `/api/admin/organizations/${orgId}/settings` : `/api/org/${orgId}/settings`);

export const updateOrgSettings = (orgId: string, patch: any, admin = false) =>
  api<any>('PUT', admin ? `/api/admin/organizations/${orgId}/settings` : `/api/org/${orgId}/settings`, patch);

export const getOrgMembers = (orgId: string, admin = false) =>
  api<any[]>('GET', admin ? `/api/admin/organizations/${orgId}/members` : `/api/org/${orgId}/members`);

export const createOrgMember = (orgId: string, username: string, password: string, role: string, admin = false) =>
  api<any>('POST', admin ? `/api/admin/organizations/${orgId}/members` : `/api/org/${orgId}/members`, { username, password, role });

export const deleteOrgMember = (orgId: string, memberId: string, admin = false) =>
  api<boolean>('DELETE', admin
    ? `/api/admin/organizations/${orgId}/members/${memberId}`
    : `/api/org/${orgId}/members/${memberId}`);

export const getOrgActivity = (orgId: string, admin = false) =>
  api<any[]>('GET', admin ? `/api/admin/organizations/${orgId}/activity` : `/api/org/${orgId}/activity`);

export const getOrgAlerts = (orgId: string, admin = false) =>
  api<any[]>('GET', admin ? `/api/admin/organizations/${orgId}/alerts` : `/api/org/${orgId}/alerts`);

export const logOrgActivity = (orgId: string, action: string, target_type?: string, target_id?: string, details?: any) =>
  api<boolean>('POST', `/api/org/${orgId}/activity`, { action, target_type, target_id, details });

export const getOrgTrash = (orgId: string) =>
  api<any[]>('GET', `/api/org/${orgId}/trash`);

export const restoreOrgTrash = (orgId: string, message_id: number, folder_id?: number) =>
  api<boolean>('POST', `/api/org/${orgId}/trash/restore`, { message_id, folder_id });

export const purgeOrgTrash = (orgId: string, message_id: number, folder_id?: number) =>
  api<boolean>('POST', `/api/org/${orgId}/trash/purge`, { message_id, folder_id });

export const orgLogin = (orgId: string, username: string, password: string) =>
  api<{ token: string; org_id: string; member_id: string; username: string; role: string }>(
    'POST', `/api/org/${orgId}/login`, { username, password });

export const orgLogout = (orgId: string) =>
  api<boolean>('POST', `/api/org/${orgId}/logout`);

export const orgMe = (orgId: string) =>
  api<{ org_id: string; member_id: string; username: string; role: string }>(
    'GET', `/api/org/${orgId}/me`);

export const getOrgFiles = (orgId: string, folder_id?: number) =>
  api<any[]>('GET', `/api/org/${orgId}/files${folder_id !== undefined ? `?folder_id=${folder_id}` : ''}`);

export const deleteOrgFile = (orgId: string, message_id: number, folder_id?: number) =>
  api<boolean>('POST', `/api/org/${orgId}/files/delete`, { message_id, folder_id });

export const scanOrgFolders = (orgId: string) =>
  api<any[]>('GET', `/api/org/${orgId}/folders/scan`);

export const createOrgFolder = (orgId: string, name: string, parent_id?: number) =>
  api<any>('POST', `/api/org/${orgId}/folders/create`, { name, parent_id });

export const getOrgStorageStatus = (orgId: string) =>
  api<{ provisioned: boolean; main_channel_id?: number; backup_channel_id?: number }>(
    'GET', `/api/org/${orgId}/storage/status`);

export const downloadOrgFileBlob = async (
  orgId: string,
  folder_id: number | undefined,
  message_id: number,
  options?: { signal?: AbortSignal },
): Promise<Blob> => {
  const fid = folder_id ?? 0;
  const orgToken = getOrgToken(orgId);
  const res = await fetch(`${API_BASE}/api/org/${orgId}/files/${fid}/${message_id}/download`, {
    headers: orgToken ? { 'X-Org-Token': orgToken } : {},
    signal: options?.signal,
  });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  return res.blob();
};

export const uploadOrgFile = (orgId: string, file: File, folder_id?: number, options?: { signal?: AbortSignal }) => {
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) {
    formData.append('folder_id', folder_id.toString());
  }
  return api<string>('POST', `/api/org/${orgId}/files/upload`, formData, options);
};

export const provisionOrgStorage = (orgId: string) =>
  api<{ main_channel_id: number; backup_channel_id: number }>(
    'POST', `/api/admin/organizations/${orgId}/provision`);
