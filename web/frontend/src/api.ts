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
  api<{ telegram_api_id?: number; theme?: string }>('GET', '/api/settings');

export const saveSettings = (settings: { telegram_api_id?: number; theme?: string }) =>
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
