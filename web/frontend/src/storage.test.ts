import { describe, it, expect } from 'vitest';
import { formatBackfillResult } from './storage';

describe('formatBackfillResult', () => {
  it('summarizes a migration run', () => {
    expect(formatBackfillResult({ copied: 12, skipped: 3, checked: 20 })).toBe(
      'Copied 12 • skipped 3 • checked 20'
    );
  });

  it('handles a clean rerun', () => {
    expect(formatBackfillResult({ copied: 0, skipped: 20, checked: 20 })).toBe(
      'Copied 0 • skipped 20 • checked 20'
    );
  });
});
