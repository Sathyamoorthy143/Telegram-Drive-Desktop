// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUploadEngine, type EngineItem } from './useUploadEngine';

interface TestItem extends EngineItem {
  name: string;
}

const file = (name = 'a.bin', size = 10) => new File(['x'.repeat(size)], name);
const meta = (name: string) => ({ name, size: 10, selected: true });

function setup(uploadOne?: (item: TestItem, f: File, ctx: any) => Promise<void>) {
  const notes: string[] = [];
  const adapters = {
    uploadOne: uploadOne ?? (async () => {}),
    notifySuccess: (n: string) => notes.push(`ok:${n}`),
    notifyError: (n: string, m: string) => notes.push(`err:${n}:${m}`),
    notifyInfo: (m: string) => notes.push(`info:${m}`),
  };
  const hook = renderHook(() => useUploadEngine<TestItem>(adapters, { autoClearSuccessMs: 60_000 }));
  return { hook, notes };
}

describe('useUploadEngine', () => {
  it('stages then runs to success via the manager', async () => {
    const { hook, notes } = setup();
    let ids: string[] = [];
    act(() => {
      ids = hook.result.current.stage([{ file: file(), meta: meta('a.bin') }]);
    });
    expect(hook.result.current.queue[0].status).toBe('staged');
    act(() => hook.result.current.start());
    await waitFor(() =>
      expect(hook.result.current.queue.find((x) => x.id === ids[0])?.status).toBe('success'),
    );
    expect(notes).toContain('ok:a.bin');
  });

  it('respects the parallel limit', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((res) => {
      releaseA = res;
    });
    let startedBResolve!: () => void;
    const startedB = new Promise<void>((res) => {
      startedBResolve = res;
    });
    const hook = renderHook(() =>
      useUploadEngine<TestItem>(
        {
          uploadOne: async (item) => {
            order.push(`start:${item.name}`);
            if (item.name === 'a') await gateA;
            else startedBResolve();
            order.push(`done:${item.name}`);
          },
          notifySuccess: () => {},
          notifyError: () => {},
          notifyInfo: () => {},
        },
        { maxParallel: 1, autoClearSuccessMs: 60_000 },
      ),
    );
    act(() => {
      hook.result.current.stage([
        { file: file('a'), meta: meta('a') },
        { file: file('b'), meta: meta('b') },
      ]);
    });
    act(() => hook.result.current.start());
    // Give the manager a beat: with limit 1, b must not start while a is gated.
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(['start:a']);
    act(() => releaseA());
    await startedB;
    await waitFor(() => expect(hook.result.current.queue.every((x) => x.status === 'success')).toBe(true));
    expect(order).toEqual(['start:a', 'done:a', 'start:b', 'done:b']);
  });

  it('cancels an in-flight upload', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const { hook } = setup(async () => gate);
    let id = '';
    act(() => {
      [id] = hook.result.current.stage([{ file: file(), meta: meta('a.bin') }]);
    });
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.queue[0].status).toBe('uploading'));
    act(() => hook.result.current.cancelItem(id));
    release();
    await waitFor(() =>
      expect(hook.result.current.queue.find((x) => x.id === id)?.status).toBe('cancelled'),
    );
  });

  it('retries failures and pauses/resumes', async () => {
    let fail = true;
    const { hook } = setup(async () => {
      if (fail) throw new Error('boom');
    });
    let id = '';
    act(() => {
      [id] = hook.result.current.stage([{ file: file(), meta: meta('a.bin') }]);
    });
    act(() => hook.result.current.start());
    await waitFor(() =>
      expect(hook.result.current.queue.find((x) => x.id === id)?.status).toBe('error'),
    );
    fail = false;
    act(() => hook.result.current.retryItem(id));
    await waitFor(() =>
      expect(hook.result.current.queue.find((x) => x.id === id)?.status).toBe('success'),
    );

    let id2 = '';
    act(() => {
      [id2] = hook.result.current.stage([{ file: file('b'), meta: meta('b') }]);
    });
    act(() => hook.result.current.pauseItem(id2));
    expect(hook.result.current.queue.find((x) => x.id === id2)?.status).toBe('paused');
    act(() => hook.result.current.resumeItem(id2));
    act(() => hook.result.current.start());
    await waitFor(() =>
      expect(hook.result.current.queue.find((x) => x.id === id2)?.status).toBe('success'),
    );
  });
});
