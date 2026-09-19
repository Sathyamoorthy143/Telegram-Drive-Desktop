// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  setOrgContext, setOrgToken, getOrgToken, setOrgSlug, getOrgSlug,
  moveFiles, searchFiles, getTrash, starFile,
  getSettings, createShare, searchFilesAdvanced, isOrgAuthError,
} from './api';

describe('org-context guards', () => {
  it('master wrappers work without org context (deferred rejection only)', () => {
    setOrgContext(null);
    // These return promises; only assert they don't throw synchronously.
    // Swallow the inevitable network rejection (no backend in tests).
    expect(() => moveFiles([], []).catch(() => {})).not.toThrow();
    expect(() => searchFiles('x').catch(() => {})).not.toThrow();
  });

  it('keeps per-org token slots isolated', () => {
    setOrgContext(null);
    setOrgToken('tok-a', 'org-a');
    setOrgToken('tok-b', 'org-b');
    try {
      expect(getOrgToken('org-a')).toBe('tok-a');
      expect(getOrgToken('org-b')).toBe('tok-b');
      setOrgContext('org-a');
      expect(getOrgToken()).toBe('tok-a');
      // Clearing one org keeps the other signed in.
      setOrgToken(null, 'org-a');
      expect(getOrgToken('org-a')).toBeNull();
      expect(getOrgToken('org-b')).toBe('tok-b');
    } finally {
      setOrgToken(null, 'org-b');
      setOrgContext(null);
    }
  });

  it('tracks the org slug hint alongside context', () => {
    setOrgContext('org-a');
    setOrgSlug('acme');
    try {
      expect(getOrgSlug()).toBe('acme');
      setOrgContext(null);
      expect(getOrgSlug()).toBeNull();
    } finally {
      setOrgContext(null);
    }
  });

  it('detects org auth failures from status or message', () => {
    expect(isOrgAuthError({ status: 401, message: 'nope' })).toBe(true);
    expect(isOrgAuthError({ status: 403, message: 'Forbidden' })).toBe(false);
    expect(isOrgAuthError(new Error('Authentication required (org login or master admin)'))).toBe(true);
    expect(isOrgAuthError(new Error('Unauthorized'))).toBe(true);
    expect(isOrgAuthError(new Error('folder access denied'))).toBe(false);
  });

  it('namespace-sensitive wrappers refuse under org context', () => {
    setOrgContext('org-1');
    try {
      expect(() => moveFiles([], [])).toThrow(/organization context/);
      expect(() => searchFiles('x')).toThrow(/organization context/);
      expect(() => searchFilesAdvanced('x')).toThrow(/organization context/);
      expect(() => getTrash()).toThrow(/organization context/);
      expect(() => starFile(1, 2, true)).toThrow(/organization context/);
      expect(() => getSettings()).toThrow(/organization context/);
      expect(() => createShare(1, 2)).toThrow(/organization context/);
    } finally {
      setOrgContext(null);
    }
  });
});
