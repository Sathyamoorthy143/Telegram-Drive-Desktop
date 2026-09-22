// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadQueue } from './UploadQueue';
import { DownloadQueue } from './DownloadQueue';
import type { QueueItem, DownloadItem } from '../../types';

const uploadItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'q1', path: 'a.jpg', name: 'a.jpg', size: 165780, folderId: null,
  status: 'staged', ...over,
});

const downloadItem = (over: Partial<DownloadItem> = {}): DownloadItem => ({
  id: 'd1', messageId: 9, filename: 'b.jpg', name: 'b.jpg', size: 200,
  folderId: null, status: 'error', error: 'Failed to fetch', ...over,
});

const uploadProps = {
  paused: false, onClearFinished: vi.fn(), onCancelAll: vi.fn(),
  onCancelItem: vi.fn(), onPauseAll: vi.fn(), onResumeAll: vi.fn(),
};

describe('queue panel close buttons', () => {
  it('UploadQueue calls onClose when the hide button is clicked', () => {
    const onClose = vi.fn();
    render(<UploadQueue {...uploadProps} items={[uploadItem()]} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('UploadQueue renders no hide button without onClose', () => {
    render(<UploadQueue {...uploadProps} items={[uploadItem()]} />);
    expect(screen.queryByTitle('Hide panel')).toBeNull();
  });

  it('DownloadQueue calls onClose when the hide button is clicked', () => {
    const onClose = vi.fn();
    render(<DownloadQueue items={[downloadItem()]} onClearFinished={vi.fn()} onCancelAll={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('DownloadQueue renders no hide button without onClose', () => {
    render(<DownloadQueue items={[downloadItem()]} onClearFinished={vi.fn()} onCancelAll={vi.fn()} />);
    expect(screen.queryByTitle('Hide panel')).toBeNull();
  });
});
