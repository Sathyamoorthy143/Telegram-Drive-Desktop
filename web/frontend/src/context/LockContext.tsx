import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

type NotificationMode = 'suppress' | 'hide' | 'allow';

interface LockContextValue {
  isLocked: boolean;
  hasPin: boolean;
  lockIntervalMs: number;
  notificationMode: NotificationMode;
  pendingCount: number;
  lock: () => void;
  unlock: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  setLockInterval: (ms: number) => Promise<void>;
  setNotificationMode: (mode: NotificationMode) => Promise<void>;
  setBusy: (busy: boolean) => void;
  snooze: () => void;
  queueToast: (msg: string, type: 'success'|'error'|'info') => void;
  flushQueue: () => {msg:string,type:string}[];
}

const LockContext = createContext<LockContextValue>(null as any);

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin + 'telegram-drive-salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function hashPinSync(pin: string): string {
  // fallback sync for initial set (will be overwritten by async after fetch)
  let h = 0;
  for (let i = 0; i < pin.length; i++) h = Math.imul(31, h) + pin.charCodeAt(i) | 0;
  return `${h}-${pin.length}-telegram-drive-salt`;
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [hasPin, setHasPin] = useState(() => !!localStorage.getItem('lock_pin_hash'));
  const [lockIntervalMs, setLockIntervalMsState] = useState(() => {
    const v = localStorage.getItem('lock_interval_ms');
    return v ? parseInt(v) : 15 * 60 * 1000; // 15min absolute default
  });
  const [notificationMode, setNotificationModeState] = useState<NotificationMode>(() => {
    const v = localStorage.getItem('notification_mode') as NotificationMode;
    return v || 'hide';
  });
  const pendingRef = useRef<{msg:string,type:string}[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const pinHashRef = useRef<string | null>(localStorage.getItem('lock_pin_hash'));
  const busyRef = useRef(false);

  // load from backend on mount (Supabase-synced)
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/settings/lock`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.lock_pin_hash) {
          pinHashRef.current = data.lock_pin_hash;
          localStorage.setItem('lock_pin_hash', data.lock_pin_hash);
          setHasPin(true);
        }
        if (data?.lock_interval_ms) {
          setLockIntervalMsState(data.lock_interval_ms);
          localStorage.setItem('lock_interval_ms', String(data.lock_interval_ms));
        }
        if (data?.notification_mode) {
          setNotificationModeState(data.notification_mode);
          localStorage.setItem('notification_mode', data.notification_mode);
        }
      }).catch(()=>{});
  }, []);

  const lock = useCallback(() => {
    if (!hasPin) return; // no pin -> no lock
    if (busyRef.current) return; // never lock mid-transfer; timer will retry
    setIsLocked(true);
  }, [hasPin]);

  const resetTimer = useCallback(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      lock();
    }, lockIntervalMs);
  }, [lockIntervalMs, lock]);

  const snooze = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  const setBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
    if (busy) {
      // pause the countdown while transfers run
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else {
      resetTimer();
    }
  }, [resetTimer]);

  // inactivity timer: resets on user activity so active use never locks
  useEffect(() => {
    if (!hasPin) return;
    resetTimer();
    const onActivity = () => { if (!busyRef.current) resetTimer(); };
    window.addEventListener('mousemove', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity);
    window.addEventListener('wheel', onActivity);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('wheel', onActivity);
    };
  }, [lockIntervalMs, hasPin, resetTimer]);

  // NOTE: no lock on tab hide / app background (per user request) — locking
  // is purely inactivity-based while the page is open. Switching tabs or
  // minimizing never locks; only `lockIntervalMs` of no input does.

  const unlock = useCallback(async (pin: string) => {
    const hashed = await hashPin(pin).catch(() => hashPinSync(pin));
    const expected = pinHashRef.current || localStorage.getItem('lock_pin_hash');
    // if expected is simple sync hash (legacy), also try simple compare
    const simple = hashPinSync(pin);
    if (expected && (hashed === expected || simple === expected)) {
      setIsLocked(false);
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = window.setInterval(() => lock(), lockIntervalMs);
      }
      return true;
    }
    return false;
  }, [lockIntervalMs, lock]);

  const setPin = useCallback(async (pin: string) => {
    const hashed = await hashPin(pin).catch(() => hashPinSync(pin));
    pinHashRef.current = hashed;
    localStorage.setItem('lock_pin_hash', hashed);
    setHasPin(true);
    setIsLocked(false);
    try {
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/settings/lock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
    } catch {}
    // also store sha256 to match backend after fetch
    setTimeout(async () => {
      try {
        const r = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/settings/lock`);
        if (r.ok) {
          const d = await r.json();
          if (d?.lock_pin_hash) {
            pinHashRef.current = d.lock_pin_hash;
            localStorage.setItem('lock_pin_hash', d.lock_pin_hash);
          }
        }
      } catch {}
    }, 500);
  }, []);

  const setLockInterval = useCallback(async (ms: number) => {
    setLockIntervalMsState(ms);
    localStorage.setItem('lock_interval_ms', String(ms));
    try {
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/settings/lock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_interval_ms: ms })
      });
    } catch {}
  }, []);

  const setNotificationMode = useCallback(async (mode: NotificationMode) => {
    setNotificationModeState(mode);
    localStorage.setItem('notification_mode', mode);
    try {
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/settings/lock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_mode: mode })
      });
    } catch {}
  }, []);

  const queueToast = useCallback((msg: string, type: 'success'|'error'|'info') => {
    pendingRef.current.push({ msg, type });
    setPendingCount(pendingRef.current.length);
  }, []);

  const flushQueue = useCallback(() => {
    const q = [...pendingRef.current];
    pendingRef.current = [];
    setPendingCount(0);
    return q;
  }, []);

  return (
    <LockContext.Provider value={{ isLocked, hasPin, lockIntervalMs, notificationMode, pendingCount, lock, unlock, setPin, setLockInterval, setNotificationMode, setBusy, snooze, queueToast, flushQueue }}>
      {children}
    </LockContext.Provider>
  );
}

export function useLock() {
  return useContext(LockContext);
}
