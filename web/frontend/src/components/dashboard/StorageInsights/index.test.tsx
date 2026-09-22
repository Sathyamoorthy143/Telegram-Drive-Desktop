// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { computeStorageStats, CATEGORY_COLORS } from './index';

describe('computeStorageStats', () => {
  it('sums bytes and counts files, excluding folders', () => {
    const stats = computeStorageStats([
      { name: 'a.pdf', size: 100, type: 'file' },
      { name: 'b.txt', size: 50, type: 'file' },
      { name: 'sub', size: 0, type: 'folder' },
    ]);
    expect(stats.totalBytes).toBe(150);
    expect(stats.fileCount).toBe(2);
    expect(stats.folderCount).toBe(1);
  });

  it('groups by file-type category', () => {
    const stats = computeStorageStats([
      { name: 'a.pdf', size: 100, type: 'file' },
      { name: 'b.pdf', size: 100, type: 'file' },
      { name: 'c.jpg', size: 300, type: 'file' },
    ]);
    expect(stats.byType.pdf).toEqual({ count: 2, bytes: 200 });
    expect(stats.byType.images).toEqual({ count: 1, bytes: 300 });
  });

  it('handles empty and missing sizes', () => {
    const stats = computeStorageStats([{ name: 'x', type: 'file' }, { name: '', size: undefined, type: 'file' }]);
    expect(stats.totalBytes).toBe(0);
    expect(stats.fileCount).toBe(2);
  });
});

describe('CATEGORY_COLORS', () => {
  it('has an entry for every common category', () => {
    for (const cat of ['docs', 'excel', 'pdf', 'images', 'video', 'audio', 'archives', 'other']) {
      expect(CATEGORY_COLORS[cat]).toBeTruthy();
    }
  });
});