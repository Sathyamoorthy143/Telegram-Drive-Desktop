// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadFile } from './api';

const errRes = (status: number) => ({
  ok: false, status, text: async () => `HTTP ${status}`, blob: async () => { throw new Error('no body'); },
});

describe('downloadFile error surfacing', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => errRes(503)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws the status so busy-server failures are actionable, not silent', async () => {
    await expect(downloadFile(0, 36)).rejects.toThrow('Download failed: 503');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('surfaces 404 distinctly from transport failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errRes(404) as any);
    await expect(downloadFile(0, 36)).rejects.toThrow('Download failed: 404');
  });

  it('includes the server error body so Telegram reasons are visible', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 500, text: async () => 'FLOOD_WAIT_42', blob: async () => { throw new Error('no body'); },
    } as any);
    await expect(downloadFile(0, 36)).rejects.toThrow('Download failed: 500 — FLOOD_WAIT_42');
  });
});
