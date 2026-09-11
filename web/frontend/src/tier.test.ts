import { describe, it, expect } from 'vitest';
import { tierUploadLabel } from './tier';

describe('tierUploadLabel', () => {
  it('labels the free tier cap', () => {
    expect(tierUploadLabel({ premium: false, max_upload_bytes: 2 * 1024 ** 3 })).toBe('2 GB');
  });

  it('labels the premium tier cap', () => {
    expect(tierUploadLabel({ premium: true, max_upload_bytes: 4 * 1024 ** 3 })).toBe('4 GB (Premium)');
  });
});
