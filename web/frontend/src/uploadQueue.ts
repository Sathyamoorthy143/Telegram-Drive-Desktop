// Shared upload-queue primitives for the master Dashboard queue and the
// org OrgAdminDashboard queue. Pure list transforms — both UIs stage the
// same statuses through the same transitions; this keeps them from diverging.

export interface QueueEntry {
  id: string;
  status: string;
  progress?: number;
  error?: string;
}

/** Set one entry's status (plus optional extra fields, e.g. progress/error). */
export function withStatus<T extends QueueEntry>(
  queue: T[],
  id: string,
  status: T['status'],
  extra?: Partial<T>,
): T[] {
  return queue.map((x) => (x.id === id ? { ...x, status, ...extra } : x));
}

/** Set one entry's progress percentage. */
export function withProgress<T extends QueueEntry>(queue: T[], id: string, progress: number): T[] {
  return queue.map((x) => (x.id === id ? { ...x, progress } : x));
}

/** Mark one entry failed with a message. */
export function withError<T extends QueueEntry>(queue: T[], id: string, error: string): T[] {
  return queue.map((x) => (x.id === id ? { ...x, status: 'error' as T['status'], error } : x));
}

/** Drop one entry by id. */
export function removeEntry<T extends QueueEntry>(queue: T[], id: string): T[] {
  return queue.filter((x) => x.id !== id);
}

/** Drop every entry whose status is in the terminal set. */
export function clearTerminal<T extends QueueEntry>(
  queue: T[],
  terminal: ReadonlyArray<T['status']>,
): T[] {
  return queue.filter((x) => !terminal.includes(x.status));
}

/** Entries still waiting to start. */
export function waitingEntries<T extends QueueEntry>(queue: T[], waiting: ReadonlyArray<T['status']>): T[] {
  return queue.filter((x) => waiting.includes(x.status));
}

/**
 * Bounded worker pool: `concurrency` workers pull items until drained.
 * Shared by the org upload runner and the master alerts fan-out so neither
 * stamps N parallel requests at once. Workers run sequentially in tests.
 */
export async function runParallelPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;
  const runOne = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => runOne()));
}
