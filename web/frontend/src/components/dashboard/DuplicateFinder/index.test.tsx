// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { findDuplicateGroups, DuplicateFinder } from './index';

// The finder hits api.getFiles on mount; stub it per-test.
vi.mock('../../../api', () => ({
  getFiles: vi.fn(async () => []),
  deleteFile: vi.fn(async () => true),
  getBandwidth: vi.fn(async () => ({ up_bytes: 0, down_bytes: 0 })),
}));

describe('findDuplicateGroups', () => {
  it('groups files with the same name and size, ignoring folders', () => {
    const groups = findDuplicateGroups([
      { id: 1, name: 'report.pdf', size: 500, type: 'file' },
      { id: 2, name: 'REPORT.PDF', size: 500, type: 'file' },
      { id: 3, name: 'report.pdf', size: 999, type: 'file' }, // different size
      { id: 4, name: 'docs', size: 0, type: 'folder' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].freeableBytes).toBe(500);
  });

  it('skips singleton files and sorts by recoverable bytes', () => {
    const groups = findDuplicateGroups([
      { id: 1, name: 'a.txt', size: 10, type: 'file' },
      { id: 2, name: 'big.bin', size: 1000, type: 'file' },
      { id: 3, name: 'big.bin', size: 1000, type: 'file' },
      { id: 4, name: 'small.txt', size: 5, type: 'file' },
      { id: 5, name: 'small.txt', size: 5, type: 'file' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].key.startsWith('big.bin')).toBe(true);
    expect(groups[0].freeableBytes).toBe(1000);
  });

  it('returns empty for empty input', () => {
    expect(findDuplicateGroups([])).toEqual([]);
  });
});

describe('DuplicateFinder render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a clean state when there are no duplicates', async () => {
    const { getFiles } = await import('../../../api');
    (getFiles as any).mockResolvedValue([{ id: 1, name: 'only.txt', size: 5, type: 'file' }]);
    render(<DuplicateFinder folderId={null} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('All clean!')).toBeTruthy());
  });

  it('lists duplicate groups with a trash action', async () => {
    const { getFiles } = await import('../../../api');
    (getFiles as any).mockResolvedValue([
      { id: 1, name: 'dup.bin', size: 100, type: 'file' },
      { id: 2, name: 'dup.bin', size: 100, type: 'file' },
    ]);
    render(<DuplicateFinder folderId={null} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/duplicate group/)).toBeTruthy());
    expect(screen.getByText('×2')).toBeTruthy();
    expect(screen.getByText(/Trash 1/)).toBeTruthy();
    expect(screen.getByText('KEEP')).toBeTruthy();
  });
});