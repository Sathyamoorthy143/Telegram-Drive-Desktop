import { describe, it, expect } from 'vitest';
import {
  stagedUploads, needsChunkedUpload, splitRelativePath,
  childFolderKey, buildFolderIndex, type OrgUploadItem,
} from './orgUpload';

const item = (id: string, status: OrgUploadItem['status']): OrgUploadItem => ({
  id,
  file: {} as File,
  name: `${id}.bin`,
  dirs: [],
  size: 10,
  progress: 0,
  status,
});

describe('stagedUploads', () => {
  it('returns only staged items', () => {
    const queue = [item('a', 'staged'), item('b', 'uploading'), item('c', 'success'), item('d', 'staged'), item('e', 'error'), item('f', 'cancelled')];
    expect(stagedUploads(queue).map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('returns empty when nothing is staged (re-entrancy guard input)', () => {
    expect(stagedUploads([item('a', 'uploading'), item('b', 'success')])).toEqual([]);
    expect(stagedUploads([])).toEqual([]);
  });
});

describe('needsChunkedUpload', () => {
  const CHUNK = 1024 * 1024;

  it('uses single POST at and below the chunk size', () => {
    expect(needsChunkedUpload(CHUNK, CHUNK)).toBe(false);
    expect(needsChunkedUpload(100, CHUNK)).toBe(false);
    expect(needsChunkedUpload(0, CHUNK)).toBe(false);
  });

  it('uses chunked upload above the chunk size', () => {
    expect(needsChunkedUpload(CHUNK + 1, CHUNK)).toBe(true);
  });
});

describe('splitRelativePath', () => {
  it('splits nested folder paths into dirs + file name', () => {
    expect(splitRelativePath('docs/sub/file.pdf')).toEqual({ dirs: ['docs', 'sub'], fileName: 'file.pdf' });
  });

  it('returns no dirs for plain file names', () => {
    expect(splitRelativePath('file.pdf')).toEqual({ dirs: [], fileName: 'file.pdf' });
    expect(splitRelativePath('')).toEqual({ dirs: [], fileName: '' });
  });
});

describe('buildFolderIndex', () => {
  it('indexes by parent/name with 0 for root', () => {
    const index = buildFolderIndex([
      { id: 1, name: 'docs' },
      { id: 2, name: 'sub', parent_id: 1 },
      { id: 3, name: 'sub', parent_id: null },
    ]);
    expect(index.get(childFolderKey(undefined, 'docs'))).toBe(1);
    expect(index.get(childFolderKey(1, 'sub'))).toBe(2);
    expect(index.get(childFolderKey(undefined, 'sub'))).toBe(3);
    expect(index.get(childFolderKey(2, 'sub'))).toBeUndefined();
  });
});
