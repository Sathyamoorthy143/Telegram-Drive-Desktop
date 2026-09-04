import { describe, it, expect } from 'vitest';
import type { TelegramFile, QueueItem, DownloadItem, ViewSettings, FileClipboard } from './types';

describe('types compile and have expected shape', () => {
  it('TelegramFile has required fields', () => {
    const f: TelegramFile = {
      id: 1,
      name: 'test.pdf',
      size: 1024,
      created_at: '2024-01-01',
      icon_type: 'file',
    };
    expect(f.id).toBe(1);
    expect(f.folder_id).toBeUndefined();
  });

  it('QueueItem statuses are well-typed', () => {
    const statuses: QueueItem['status'][] = ['pending', 'uploading', 'success', 'error', 'cancelled'];
    expect(statuses).toHaveLength(5);
  });

  it('DownloadItem statuses are well-typed', () => {
    const statuses: DownloadItem['status'][] = ['pending', 'downloading', 'success', 'error', 'cancelled'];
    expect(statuses).toHaveLength(5);
  });

  it('ViewSettings defaults', () => {
    const v: ViewSettings = {
      viewMode: 'grid',
      groupBy: 'none',
      showPreviewPane: false,
      sortField: 'name',
      sortDirection: 'asc',
    };
    expect(v.viewMode).toBe('grid');
  });

  it('FileClipboard cut vs copy', () => {
    const cut: FileClipboard = { type: 'cut', messageIds: [1], folderIds: [], canPaste: true };
    const copy: FileClipboard = { type: 'copy', messageIds: [1, 2], folderIds: [3], canPaste: true };
    expect(cut.type).toBe('cut');
    expect(copy.type).toBe('copy');
  });
});
