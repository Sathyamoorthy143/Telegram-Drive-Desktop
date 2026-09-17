import { describe, it, expect } from 'vitest';
import { orgSlugFromPath, RESERVED_SLUGS } from './orgRouting';

describe('orgSlugFromPath', () => {
  it('extracts slug from root-level org path', () => {
    expect(orgSlugFromPath('/sdpk')).toBe('sdpk');
  });

  it('uses only the first segment for nested paths', () => {
    expect(orgSlugFromPath('/sdpk/files')).toBe('sdpk');
  });

  it('lowercases the slug', () => {
    expect(orgSlugFromPath('/SDPK')).toBe('sdpk');
  });

  it('returns null for root and empty paths', () => {
    expect(orgSlugFromPath('/')).toBeNull();
    expect(orgSlugFromPath('')).toBeNull();
  });

  it('returns null for reserved slugs', () => {
    for (const slug of ['api', 'files', 'settings', 'trash', 'members', 'activity', 'admin', 'login', 'stream', 'preview', 'thumbnail', 'health']) {
      expect(orgSlugFromPath(`/${slug}`)).toBeNull();
    }
  });

  it('still resolves org slug when a reserved word appears deeper in the path', () => {
    expect(orgSlugFromPath('/sdpk/settings')).toBe('sdpk');
  });

  it('reserved set matches backend is_reserved_slug (parity pin)', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual([
      'account', 'activity', 'admin', 'api', 'auth', 'bandwidth', 'debug',
      'files', 'folders', 'health', 'login', 'logout', 'members', 'meta',
      'preview', 's', 'settings', 'share', 'stream', 'thumbnail', 'trash',
      'version', 'versions',
    ]);
  });
});
