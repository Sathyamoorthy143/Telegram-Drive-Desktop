import { describe, it, expect } from 'vitest';
import { withTimeout } from './api';

describe('withTimeout', () => {
  it('passes fast results through untouched', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'fallback')).resolves.toBe('ok');
  });

  it('falls back when the promise never settles', async () => {
    await expect(withTimeout(new Promise<string>(() => {}), 50, 'fallback')).resolves.toBe('fallback');
  });

  it('propagates rejections instead of masking them', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'fallback')).rejects.toThrow('boom');
  });
});
