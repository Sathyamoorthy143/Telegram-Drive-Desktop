const API_BASE = import.meta.env.VITE_API_URL || '';

export async function api<T>(method: string, path: string, body?: any): Promise<T> {
  const isFormData = body instanceof FormData;

  const headers: Record<string, string> = {};
  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
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

export const checkConnection = () =>
  api<boolean>('GET', '/api/check-connection');

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

export const getFiles = (folder_id?: number) =>
  api<any[]>('GET', `/api/files${folder_id ? `?folder_id=${folder_id}` : ''}`);

export const uploadFile = (file: File, folder_id?: number) => {
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) {
    formData.append('folder_id', folder_id.toString());
  }
  return api<string>('POST', '/api/files/upload', formData);
};

export const downloadFile = async (folder_id: number, message_id: number): Promise<Blob> => {
  const res = await fetch(`${API_BASE}/api/files/${folder_id}/${message_id}/download`);
  if (!res.ok) throw new Error('Download failed');
  return res.blob();
};

export const deleteFile = (message_id: number, folder_id?: number) =>
  api<boolean>('POST', '/api/files/delete', { message_id, folder_id });

export const moveFiles = (message_ids: number[], folder_ids: number[], source_folder_id?: number, target_folder_id?: number) =>
  api<boolean>('POST', '/api/files/move', { message_ids, folder_ids, source_folder_id, target_folder_id });

export const copyFiles = (message_ids: number[], folder_ids: number[], source_folder_id?: number, target_folder_id?: number) =>
  api<boolean>('POST', '/api/files/copy', { message_ids, folder_ids, source_folder_id, target_folder_id });

export const searchFiles = (query: string) =>
  api<any[]>('GET', `/api/files/search?query=${encodeURIComponent(query)}`);

export const getBandwidth = () =>
  api<{ up_bytes: number; down_bytes: number }>('GET', '/api/bandwidth');

export const scanFolders = () =>
  api<any[]>('GET', '/api/folders/scan');

export const createFolder = (name: string, parent_id?: number) =>
  api<any>('POST', '/api/folders/create', { name, parent_id });

export const renameFolder = (id: number, new_name: string) =>
  api<boolean>('PUT', `/api/folders/${id}/rename`, { new_name });

export const deleteFolder = (folder_id: number) =>
  api<boolean>('DELETE', `/api/folders/${folder_id}/delete`, { folder_id });

export const getFolderProperties = (id: number) =>
  api<{ file_count: number; total_size: number; created_at: string }>('GET', `/api/folders/${id}/properties`);

export const getStreamInfo = () =>
  api<{ token: string; base_url: string }>('GET', '/api/stream-info');

export const getStreamUrl = (folder_id: number | string, message_id: number, token?: string) =>
  `${API_BASE}/api/stream/${folder_id}/${message_id}${token ? `?token=${token}` : ''}`;

export const getPreviewUrl = (folder_id: number | string, message_id: number) =>
  `${API_BASE}/api/preview/${folder_id}/${message_id}`;

export const getThumbnailUrl = (folder_id: number | string, message_id: number) =>
  `${API_BASE}/api/thumbnail/${folder_id}/${message_id}`;

export const geminiChat = (message: string) =>
  api<{ reply: string }>('POST', '/api/ai/chat', { message });

export const getSettings = () =>
  api<{ telegram_api_id?: number; theme?: string; auto_login?: boolean; ai_proxy_url?: string; encryption_enabled?: boolean }>('GET', '/api/settings');

export const saveSettings = (settings: { telegram_api_id?: number; theme?: string; auto_login?: boolean; ai_proxy_url?: string; encryption_enabled?: boolean }) =>
  api<boolean>('PUT', '/api/settings', settings);

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

export const getTrash = () =>
  api<any[]>('GET', '/api/trash');

export const restoreTrash = (message_id: number, folder_id?: number) =>
  api<boolean>('POST', '/api/trash/restore', { message_id, folder_id });

export const emptyTrash = () =>
  api<boolean>('POST', '/api/trash/empty');

export const purgeTrash = (message_id: number, folder_id?: number) =>
  api<boolean>('POST', '/api/trash/purge', { message_id, folder_id });

export const getFavorites = () =>
  api<any[]>('GET', '/api/meta/favorites');

export const getRecent = () =>
  api<any[]>('GET', '/api/meta/recent');

export const starFile = (message_id: number, folder_id: number, starred: boolean) =>
  api<boolean>('POST', '/api/meta/star', { message_id, folder_id, starred });

export const getTags = (message_id: number, folder_id?: number) =>
  api<any[]>('GET', `/api/meta/tags?message_id=${message_id}${folder_id !== undefined ? `&folder_id=${folder_id}` : ''}`);

export const setTags = (message_id: number, tags: string[], folder_id?: number) =>
  api<boolean>('PUT', '/api/meta/tags', { message_id, folder_id, tags });

export const createShare = (message_id: number, folder_id: number, expires_in?: number) =>
  api<{ url: string }>('POST', '/api/share', { message_id, folder_id, expiry_days: expires_in });

export const getShareUrl = (share_id: string) =>
  `${API_BASE}/s/${share_id}`;

export const getVersions = (message_id: number, name: string, folder_id?: number) =>
  api<any[]>('GET', `/api/versions?name=${encodeURIComponent(name)}${folder_id !== undefined ? `&folder_id=${folder_id}` : ''}`);

export const restoreVersion = (message_id: number, version_message_id: number, folder_id?: number, name?: string) =>
  api<boolean>('POST', '/api/versions/restore', { folder_id, name, version_message_id: message_id, current_message_id: version_message_id });

export const recordVersion = (message_id: number, folder_id: number, name: string) =>
  api<boolean>('POST', '/api/versions/record', { message_id, folder_id, name });

export const logActivity = (action: string, detail?: string, name?: string) =>
  api<boolean>('POST', '/api/activity', { action, detail, name });

export const getActivity = () =>
  api<any[]>('GET', '/api/activity');

export const clearActivity = () =>
  api<boolean>('POST', '/api/activity/clear');

export const touchRecent = (message_id: number, folder_id: number, name?: string, size?: number) =>
  api<boolean>('POST', '/api/meta/touch', { message_id, folder_id, name, size });

export const searchFilesAdvanced = (query: string, filters?: any) =>
  api<any[]>('GET', `/api/files/search?query=${encodeURIComponent(query)}${filters ? '&' + new URLSearchParams(filters).toString() : ''}`);

export const uploadFileResumable = (file: File, folder_id?: number, options?: {
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
    xhr.open('POST', `${API_BASE}/api/files/upload`);
    if (options?.signal) (xhr as XMLHttpRequest & { signal?: AbortSignal }).signal = options.signal;
    xhr.send(formData);
  });
};

export const uploadFileWithProgress = (file: File, folder_id?: number, options?: {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}) => {
  const id = crypto.randomUUID();
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append('file', file);
  if (folder_id !== undefined) formData.append('folder_id', folder_id.toString());

  return new Promise<string>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && options?.onProgress) options.onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(xhr.responseText || `Upload failed: ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.open('POST', `${API_BASE}/api/files/upload`);
    if (options?.signal) (xhr as XMLHttpRequest & { signal?: AbortSignal }).signal = options.signal;
    xhr.send(formData);
  });
};
