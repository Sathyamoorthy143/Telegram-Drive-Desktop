import { describe, it, expect } from 'vitest';
import {
  withStatus, withProgress, withError, removeEntry, clearTerminal, waitingEntries,
  type QueueEntry,
} from './uploadQueue';

const entry = (id: string, status = 'staged', progress = 0): QueueEntry => ({ id, status, progress });

describe('upload queue primitives', () => {
  it('marks one entry without touching others', () => {
    const q = [entry('a'), entry('b', 'uploading', 10)];
    const next = withStatus(q, 'a', 'uploading', { progress: 5 });
    expect(next[0]).toMatchObject({ status: 'uploading', progress: 5 });
    expect(next[1]).toMatchObject({ status: 'uploading', progress: 10 });
    expect(q[0].status).toBe('staged');
  });

  it('tracks progress and failures', () => {
    const q = [entry('a', 'uploading')];
    expect(withProgress(q, 'a', 42)[0].progress).toBe(42);
    const failed = withError(q, 'a', 'boom');
    expect(failed[0]).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('removes and clears by status', () => {
    const q = [entry('a', 'success'), entry('b', 'error'), entry('c', 'staged')];
    expect(removeEntry(q, 'a').map((x) => x.id)).toEqual(['b', 'c']);
    expect(clearTerminal(q, ['success', 'error']).map((x) => x.id)).toEqual(['c']);
    expect(waitingEntries(q, ['staged']).map((x) => x.id)).toEqual(['c']);
  });
});
