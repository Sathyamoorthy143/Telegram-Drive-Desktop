// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrgAlerts } from './useOrgAlerts';

vi.mock('../api', () => ({ getOrgAlerts: vi.fn() }));
import * as api from '../api';

const getAlerts = () => api.getOrgAlerts as unknown as ReturnType<typeof vi.fn>;

describe('useOrgAlerts outage backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('backs off exponentially on consecutive failures and recovers', async () => {
    getAlerts().mockRejectedValue(new Error('fetch failed'));
    renderHook(() => useOrgAlerts('o1'));
    await act(async () => {});
    expect(getAlerts()).toHaveBeenCalledTimes(1); // t=0 initial

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); // t=30
    expect(getAlerts()).toHaveBeenCalledTimes(2); // backoff was 30s = normal cadence

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); // t=60: in 60s backoff
    expect(getAlerts()).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); // t=90: backoff expired
    expect(getAlerts()).toHaveBeenCalledTimes(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); // t=150: in 120s backoff
    expect(getAlerts()).toHaveBeenCalledTimes(3);

    // Backend recovers: next allowed tick fetches and restores normal cadence.
    getAlerts().mockResolvedValue([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); // t=210
    expect(getAlerts()).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); // t=240
    expect(getAlerts()).toHaveBeenCalledTimes(5);
  });
});
