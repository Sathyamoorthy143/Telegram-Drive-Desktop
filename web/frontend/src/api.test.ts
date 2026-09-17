import { describe, it, expect } from 'vitest';
import {
  setOrgContext, moveFiles, searchFiles, getTrash, starFile,
  getSettings, createShare, searchFilesAdvanced,
} from './api';

describe('org-context guards', () => {
  it('master wrappers work without org context (deferred rejection only)', () => {
    setOrgContext(null);
    // These return promises; only assert they don't throw synchronously.
    // Swallow the inevitable network rejection (no backend in tests).
    expect(() => moveFiles([], []).catch(() => {})).not.toThrow();
    expect(() => searchFiles('x').catch(() => {})).not.toThrow();
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
