import { useCallback, useEffect, useRef, useState } from 'react';
import { withStatus, withError, removeEntry, clearTerminal } from '../uploadQueue';

// Shared parallel upload engine behind the master Dashboard queue and the
// org OrgAdminDashboard queue. Components own staging UI and the per-file
// transfer itself (injected via adapters); the engine owns queue state,
// parallel slots, pause/resume, cancel, retry, and speed/ETA readouts.

export type EngineStatus =
  | 'staged'
  | 'pending'
  | 'uploading'
  | 'paused'
  | 'success'
  | 'error'
  | 'cancelled';

export interface EngineItem {
  id: string;
  status: EngineStatus;
  progress?: number;
  error?: string;
  selected?: boolean;
  [key: string]: any;
}

export interface EngineItemCtx {
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
  waitIfPaused: () => Promise<void>;
  isCancelled: () => boolean;
  onUploadId: (id: string) => void;
}

export interface EngineAdapters<T extends EngineItem> {
  /** Transfer one file. Throw on failure; AbortError (or signal abort) counts as cancel. */
  uploadOne: (item: T, file: File, ctx: EngineItemCtx) => Promise<void>;
  notifySuccess: (name: string) => void;
  notifyError: (name: string, message: string) => void;
  notifyInfo: (msg: string) => void;
  notifyCancel?: (name: string) => void;
  /** Return true when the error was an auth failure already handled (e.g. forced logout). */
  onAuthError?: (err: any) => boolean;
  /** Called after each item settles (refresh lists, etc.). */
  onItemDone?: () => void;
  /** Called when new work is staged and should start (resets PIN caches, etc.). */
  onManualStart?: () => void;
  setBusy?: (busy: boolean) => void;
}

export interface EngineApi<T extends EngineItem> {
  queue: T[];
  pausedAll: boolean;
  maxParallel: number;
  setMaxParallel: (n: number) => void;
  stage: (
    entries: Array<{ file: File; meta: Omit<T, 'id' | 'file' | 'status' | 'progress' | 'error'> & { name: string } }>,
  ) => string[];
  start: (onlyIds?: string[]) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  pauseItem: (qid: string) => void;
  resumeItem: (qid: string) => void;
  cancelItem: (qid: string) => void;
  cancelAll: () => void;
  removeItem: (qid: string) => void;
  retryItem: (qid: string) => void;
  retryAllFailed: () => void;
  toggleSelect: (qid: string) => void;
  selectAll: (select: boolean) => void;
  clearFinished: () => void;
  getFile: (qid: string) => File | undefined;
}

const newQid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function useUploadEngine<T extends EngineItem>(
  adapters: EngineAdapters<T>,
  opts?: { maxParallel?: number; autoClearSuccessMs?: number },
): EngineApi<T> {
  const [queue, setQueue] = useState<T[]>([]);
  const [uploadsPaused, setUploadsPaused] = useState(false);
  const [maxParallelFiles, setMaxParallelFiles] = useState(opts?.maxParallel ?? 4);
  const autoClearMs = opts?.autoClearSuccessMs ?? 4000;

  const queueRef = useRef<T[]>([]);
  const filesRef = useRef<Map<string, File>>(new Map());
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const pausedIds = useRef<Set<string>>(new Set());
  const startingIds = useRef<Set<string>>(new Set());
  const pausedAllRef = useRef(false);
  const maxParallelRef = useRef(opts?.maxParallel ?? 4);
  const speedRef = useRef<Map<string, { t: number; done: number; speed: number }>>(new Map());
  // Last setQueue paint per item: XHR progress ticks fire far more often
  // than the eye (or React) needs — painting at most every 250ms stops the
  // whole Dashboard re-rendering dozens of times per second per upload.
  const paintRef = useRef<Map<string, number>>(new Map());
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const readStatus = useCallback(
    (qid: string) => queueRef.current.find((x) => x.id === qid)?.status,
    [],
  );

  const setMaxParallel = useCallback((n: number) => {
    const v = Math.min(8, Math.max(1, n));
    maxParallelRef.current = v;
    setMaxParallelFiles(v);
  }, []);

  const setPausedAll = useCallback(
    (p: boolean) => {
      pausedAllRef.current = p;
      setUploadsPaused(p);
    },
    [],
  );

  const reportProgress = useCallback((qid: string, done: number, total: number) => {
    const now = Date.now();
    const prev = speedRef.current.get(qid);
    let speed = prev?.speed ?? 0;
    if (prev && now - prev.t >= 250 && done > prev.done) {
      const inst = ((done - prev.done) / (now - prev.t)) * 1000;
      speed = prev.speed > 0 ? prev.speed * 0.6 + inst * 0.4 : inst;
      speedRef.current.set(qid, { t: now, done, speed });
    } else if (!prev) {
      speedRef.current.set(qid, { t: now, done, speed: 0 });
    }
    const remaining = Math.max(0, total - done);
    const eta = speed > 0 && done < total ? Math.round(remaining / speed) : undefined;
    const finished = done >= total;
    const lastPaint = paintRef.current.get(qid) ?? 0;
    // Always paint completion (progress bars must reach 100%); otherwise
    // throttle paints — speed/ETA math above stays exact in the ref.
    if (!finished && now - lastPaint < 250) return;
    paintRef.current.set(qid, now);
    setQueue((q) =>
      q.map((x) => {
        if (x.id !== qid) return x;
        const next: any = { ...x, progress: total ? Math.round((done / total) * 100) : 5 };
        if (speed > 0) {
          next.speed = Math.max(0, Math.round(speed));
          if (eta !== undefined) next.eta = eta;
        }
        return next;
      }),
    );
  }, []);

  const runOne = useCallback(
    async (file: File, qid: string) => {
      const ad = adaptersRef.current;
      if (readStatus(qid) === 'cancelled') return;
      const isPausedNow = () => pausedAllRef.current || pausedIds.current.has(qid);
      while (isPausedNow()) {
        setQueue((q) =>
          q.map((x) =>
            x.id === qid && (x.status === 'pending' || x.status === 'uploading' || x.status === 'staged')
              ? ({ ...x, status: 'paused' } as T)
              : x,
          ),
        );
        await new Promise((r) => setTimeout(r, 300));
        if (readStatus(qid) === 'cancelled') return;
      }
      const item = queueRef.current.find((x) => x.id === qid);
      const name = (item as any)?.name ?? file.name;
      setQueue((q) => withStatus(q, qid, 'uploading', { progress: 5 } as Partial<T>));
      const ctrl = new AbortController();
      controllers.current.set(qid, ctrl);
      const waitIfPaused = async () => {
        while (pausedAllRef.current || pausedIds.current.has(qid)) {
          if (readStatus(qid) === 'cancelled') throw new DOMException('cancelled', 'AbortError');
          setQueue((q) =>
            q.map((x) =>
              x.id === qid && (x.status === 'pending' || x.status === 'uploading')
                ? ({ ...x, status: 'paused' } as T)
                : x,
            ),
          );
          await new Promise((r) => setTimeout(r, 300));
        }
        if (readStatus(qid) === 'cancelled') throw new DOMException('cancelled', 'AbortError');
        if (!pausedIds.current.has(qid)) {
          setQueue((q) =>
            q.map((x) =>
              x.id === qid && x.status === 'paused' ? ({ ...x, status: 'uploading' } as T) : x,
            ),
          );
        }
      };
      try {
        await ad.uploadOne(queueRef.current.find((x) => x.id === qid) as T, file, {
          signal: ctrl.signal,
          onProgress: (done, total) => reportProgress(qid, done, total),
          waitIfPaused,
          isCancelled: () => readStatus(qid) === 'cancelled',
          onUploadId: (id) =>
            setQueue((q) => q.map((x) => (x.id === qid ? ({ ...x, uploadId: id } as T) : x))),
        });
        setQueue((q) => withStatus(q, qid, 'success', { progress: 100 } as Partial<T>));
        ad.notifySuccess(name);
      } catch (err: any) {
        const cancelled =
          ctrl.signal.aborted ||
          String(err?.name).includes('Abort') ||
          String(err?.message).includes('aborted') ||
          String(err?.message).includes('cancelled');
        if (cancelled) {
          setQueue((q) => withStatus(q, qid, 'cancelled'));
          if (!String(err?.message).includes('Encryption cancelled')) {
            ad.notifyCancel?.(name);
          }
        } else {
          setQueue((q) => withError(q, qid, err.message));
          if (!ad.onAuthError?.(err)) ad.notifyError(name, err.message || 'error');
        }
      } finally {
        controllers.current.delete(qid);
        speedRef.current.delete(qid);
      }
    },
    [readStatus, reportProgress],
  );

  // Live manager: owns ALL starts, keeps at most maxParallel in flight.
  useEffect(() => {
    const activeCount = controllers.current.size;
    const hasWork = queue.some((x) => x.status === 'uploading' || x.status === 'pending');
    adaptersRef.current.setBusy?.(hasWork || activeCount > 0);
    if (pausedAllRef.current) return;
    const slots = maxParallelRef.current - activeCount;
    if (slots <= 0) return;
    const next = queue
      .filter(
        (x) =>
          x.status === 'pending' &&
          (x as any).selected !== false &&
          !pausedIds.current.has(x.id) &&
          !startingIds.current.has(x.id) &&
          !controllers.current.has(x.id) &&
          filesRef.current.has(x.id),
      )
      .slice(0, slots);
    if (next.length === 0) return;
    next.forEach((item) => {
      const file = filesRef.current.get(item.id);
      if (!file) return;
      startingIds.current.add(item.id);
      runOne(file, item.id).finally(() => {
        startingIds.current.delete(item.id);
        adaptersRef.current.onItemDone?.();
        if (autoClearMs > 0) {
          setTimeout(() => setQueue((q) => clearTerminal(q, ['success'])), autoClearMs);
        }
        bump();
      });
    });
  }, [queue, maxParallelFiles, uploadsPaused, runOne, autoClearMs, bump]);

  useEffect(() => {
    const ctrls = controllers.current;
    return () => {
      ctrls.forEach((c) => {
        try {
          c.abort();
        } catch {}
      });
      ctrls.clear();
    };
  }, []);

  const stage = useCallback(
    (
      entries: Array<{
        file: File;
        meta: Omit<T, 'id' | 'file' | 'status' | 'progress' | 'error'> & { name: string };
      }>,
    ) => {
    if (entries.length === 0) return [] as string[];
    const ids = entries.map(() => newQid());
    entries.forEach((e, i) => filesRef.current.set(ids[i], e.file));
    setQueue((prev) => [
      ...prev,
      ...entries.map(
        (e, i) => ({ ...e.meta, id: ids[i], status: 'staged', progress: 0 }) as unknown as T,
      ),
    ]);
    return ids;
  },
  [],
  );

  const start = useCallback(
    (onlyIds?: string[]) => {
      const snapshot = queueRef.current;
      const pool = snapshot.filter(
        (x) =>
          (x.status === 'staged' ||
            x.status === 'pending' ||
            x.status === 'paused' ||
            x.status === 'error') &&
          (x as any).selected !== false &&
          (!onlyIds || onlyIds.includes(x.id)),
      );
      let ids = pool.map((x) => x.id);
      if (ids.length === 0 && onlyIds && onlyIds.length > 0) {
        ids = onlyIds.filter((id) => filesRef.current.has(id));
      }
      if (ids.length === 0) {
        adaptersRef.current.notifyInfo('Nothing selected — tick checkboxes first');
        return;
      }
      ids.forEach((id) => {
        pausedIds.current.delete(id);
        startingIds.current.delete(id);
      });
      setQueue((q) =>
        q.map((x) =>
          ids.includes(x.id) ? ({ ...x, status: 'pending', error: undefined, selected: true } as T) : x,
        ),
      );
      adaptersRef.current.onManualStart?.();
      bump();
    },
    [bump],
  );

  const pauseAll = useCallback(() => {
    setPausedAll(true);
    bump();
  }, [bump]);

  const resumeAll = useCallback(() => {
    setPausedAll(false);
    pausedIds.current.clear();
    setQueue((q) =>
      q.map((x) => (x.status === 'paused' ? ({ ...x, status: 'pending' } as T) : x)),
    );
    bump();
  }, [bump]);

  const pauseItem = useCallback(
    (qid: string) => {
      pausedIds.current.add(qid);
      setQueue((q) =>
        q.map((x) =>
          x.id === qid && (x.status === 'uploading' || x.status === 'pending' || x.status === 'staged')
            ? ({ ...x, status: 'paused' } as T)
            : x,
        ),
      );
      bump();
    },
    [bump],
  );

  const resumeItem = useCallback(
    (qid: string) => {
      pausedIds.current.delete(qid);
      setQueue((q) =>
        q.map((x) => {
          if (x.id !== qid) return x;
          if (x.status === 'paused' || x.status === 'staged')
            return { ...x, status: 'pending', selected: true } as T;
          return x;
        }),
      );
      bump();
    },
    [bump],
  );

  const cancelItem = useCallback(
    (qid: string) => {
      try {
        controllers.current.get(qid)?.abort();
      } catch {}
      controllers.current.delete(qid);
      pausedIds.current.delete(qid);
      startingIds.current.delete(qid);
      setQueue((q) => {
        const it = q.find((x) => x.id === qid);
        if (it?.status === 'staged') return removeEntry(q, qid);
        return withStatus(q, qid, 'cancelled');
      });
      setTimeout(() => {
        setQueue((q) => {
          if (!q.some((x) => x.id === qid)) filesRef.current.delete(qid);
          return q;
        });
      }, 0);
      bump();
    },
    [bump],
  );

  const cancelAll = useCallback(() => {
    controllers.current.forEach((c) => {
      try {
        c.abort();
      } catch {}
    });
    controllers.current.clear();
    pausedIds.current.clear();
    startingIds.current.clear();
    setPausedAll(false);
    setQueue((q) =>
      q.map((x) =>
        x.status === 'staged' || x.status === 'pending' || x.status === 'uploading' || x.status === 'paused'
          ? ({ ...x, status: 'cancelled' } as T)
          : x,
      ),
    );
    adaptersRef.current.setBusy?.(false);
    bump();
  }, [bump]);

  const removeItem = useCallback(
    (qid: string) => {
      try {
        controllers.current.get(qid)?.abort();
      } catch {}
      controllers.current.delete(qid);
      pausedIds.current.delete(qid);
      startingIds.current.delete(qid);
      filesRef.current.delete(qid);
      speedRef.current.delete(qid);
      setQueue((q) => removeEntry(q, qid));
      bump();
    },
    [bump],
  );

  const retryItem = useCallback(
    (qid: string) => {
      if (!filesRef.current.has(qid)) {
        adaptersRef.current.notifyError('', 'Original file unavailable — please re-select it');
        return;
      }
      pausedIds.current.delete(qid);
      startingIds.current.delete(qid);
      setQueue((q) =>
        q.map((x) =>
          x.id === qid ? ({ ...x, status: 'pending', progress: 0, error: undefined, selected: true } as T) : x,
        ),
      );
      bump();
    },
    [bump],
  );

  const retryAllFailed = useCallback(() => {
    const failed = queueRef.current.filter((x) => x.status === 'error');
    if (failed.length === 0) return;
    const retryable = failed.filter((x) => filesRef.current.has(x.id));
    if (retryable.length === 0) {
      adaptersRef.current.notifyError('', 'Original files unavailable — please re-select them');
      return;
    }
    const ids = new Set(retryable.map((x) => x.id));
    ids.forEach((id) => {
      pausedIds.current.delete(id);
      startingIds.current.delete(id);
    });
    setQueue((q) =>
      q.map((x) =>
        ids.has(x.id) ? ({ ...x, status: 'pending', progress: 0, error: undefined, selected: true } as T) : x,
      ),
    );
    bump();
    adaptersRef.current.notifyInfo(
      `Retrying ${retryable.length} failed upload(s)${failed.length - retryable.length > 0 ? ` — ${failed.length - retryable.length} unavailable, re-select` : ''}`,
    );
  }, [bump]);

  const toggleSelect = useCallback(
    (qid: string) => {
      const it = queueRef.current.find((x) => x.id === qid);
      if (!it) return;
      const nextSelected = !((it as any)?.selected !== false);
      if (it.status === 'uploading' && !nextSelected) {
        pausedIds.current.add(qid);
        setQueue((q) =>
          q.map((x) => (x.id === qid ? ({ ...x, selected: nextSelected, status: 'paused' } as T) : x)),
        );
      } else if (it.status === 'paused' && nextSelected) {
        pausedIds.current.delete(qid);
        startingIds.current.delete(qid);
        setQueue((q) =>
          q.map((x) => (x.id === qid ? ({ ...x, selected: nextSelected, status: 'pending' } as T) : x)),
        );
      } else {
        setQueue((q) => q.map((x) => (x.id === qid ? ({ ...x, selected: nextSelected } as T) : x)));
      }
      bump();
    },
    [bump],
  );

  const selectAll = useCallback(
    (select: boolean) => {
      setQueue((q) =>
        q.map((x) => {
          if (x.status === 'staged' || x.status === 'pending' || x.status === 'paused' || x.status === 'uploading') {
            if (!select && (x.status === 'uploading' || x.status === 'pending')) pausedIds.current.add(x.id);
            else if (select && x.status === 'paused' && (x as any).selected === false)
              pausedIds.current.delete(x.id);
            return { ...x, selected: select } as T;
          }
          return x;
        }),
      );
      if (!select) {
        setQueue((q) =>
          q.map((x) =>
            (x.status === 'uploading' || x.status === 'pending') && (x as any).selected === false
              ? ({ ...x, status: 'paused' } as T)
              : x,
          ),
        );
      }
      bump();
    },
    [bump],
  );

  const clearFinished = useCallback(() => {
    setQueue((q) => clearTerminal(q, ['success', 'error', 'cancelled']));
  }, []);

  const getFile = useCallback((qid: string) => filesRef.current.get(qid), []);

  return {
    queue,
    pausedAll: uploadsPaused,
    maxParallel: maxParallelFiles,
    setMaxParallel,
    stage,
    start,
    pauseAll,
    resumeAll,
    pauseItem,
    resumeItem,
    cancelItem,
    cancelAll,
    removeItem,
    retryItem,
    retryAllFailed,
    toggleSelect,
    selectAll,
    clearFinished,
    getFile,
  };
}
