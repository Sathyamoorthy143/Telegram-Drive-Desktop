import { describe, it, expect } from 'vitest';
import { filterNewAlerts } from './useOrgAlerts';
import type { OrgAlert } from '../types';

const alert = (id: string): OrgAlert => ({ id, org_id: 'org-1', action: 'file.upload' });

describe('filterNewAlerts', () => {
  it('returns all entries on first poll and records their ids', () => {
    const seen = new Set<string>();
    const fresh = filterNewAlerts(seen, [alert('a'), alert('b')]);
    expect(fresh.map((a) => a.id)).toEqual(['a', 'b']);
    expect(seen.has('a') && seen.has('b')).toBe(true);
  });

  it('deduplicates across polls', () => {
    const seen = new Set<string>();
    filterNewAlerts(seen, [alert('a')]);
    expect(filterNewAlerts(seen, [alert('a'), alert('b')]).map((a) => a.id)).toEqual(['b']);
  });

  it('skips entries without an id', () => {
    const seen = new Set<string>();
    const idLess = { org_id: 'org-1', action: 'file.upload' } as OrgAlert;
    expect(filterNewAlerts(seen, [idLess, alert('a')]).map((a) => a.id)).toEqual(['a']);
    expect(seen.size).toBe(1);
  });
});
