import { useCallback, useState } from 'react';

/**
 * Persisted, clamped panel size (sidebar width / topbar height).
 * Reads `localStorage` lazily, clamps on every set, writes back.
 */
export function usePanelSize(key: string, defaultValue: number, min: number, max: number) {
  const [size, setSizeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const v = Number(raw);
        if (Number.isFinite(v)) return Math.min(max, Math.max(min, v));
      }
    } catch {}
    return defaultValue;
  });

  const setSize = useCallback(
    (v: number) => {
      const clamped = Math.min(max, Math.max(min, Math.round(v)));
      setSizeState(clamped);
      try {
        localStorage.setItem(key, String(clamped));
      } catch {}
    },
    [key, min, max]
  );

  const reset = useCallback(() => setSize(defaultValue), [setSize, defaultValue]);

  return { size, setSize, reset, min, max, defaultValue };
}
