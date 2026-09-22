// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadFileChunked } from './api';

const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('uploadFileChunked chunk retries', () => {
  let chunkPuts = 0;

  beforeEach(() => {
    chunkPuts = 0;
    localStorage.clear();
    // Deterministic manifest hashes (server is mocked; validity is not under test).
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async () => new Uint8Array(32).fill(7).buffer);
    vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      if (u.endsWith('/files/upload/init')) return okJson({ upload_id: 'u1', received: [] });
      if (u.includes('/files/upload/session')) return okJson({ upload_id: 'u1', received: [] });
      if (u.includes('/files/upload/chunk')) {
        chunkPuts += 1;
        // Simulate a flaky network (Render wake / DNS blip): fail three times,
        // then succeed. The old 3-attempt budget threw here; 6 attempts ride it out.
        if (chunkPuts <= 3) throw new TypeError('fetch failed');
        return okJson({ ok: true, index: 0 });
      }
      if (u.endsWith('/files/upload/complete')) return okJson({ ok: true });
      throw new Error(`unexpected fetch: ${u}`);
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries network-failed chunks and completes', async () => {
    const file = new File([new Uint8Array(100)], 'tiny.bin');
    const res: any = await uploadFileChunked(file, undefined);
    expect(res).toEqual({ ok: true });
    expect(chunkPuts).toBe(4);
  }, 60000);
});
