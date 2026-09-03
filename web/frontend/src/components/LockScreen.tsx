import { useState, useEffect, useRef } from 'react';
import { Lock, Delete } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLock } from '../context/LockContext';
import { toast } from 'sonner';

export function LockScreen() {
  const { unlock, lockIntervalMs } = useLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [tries, setTries] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePress = (d: string) => {
    setPin(p => p.length < 4 ? p + d : p);
    setError(false);
  };
  const handleDelete = () => setPin(p => p.slice(0, -1));
  const handleClear = () => setPin('');

  const handleUnlock = async () => {
    // use functional pin value to avoid stale closure
    const currentPin = pin;
    if (currentPin.length < 4) { setError(true); return; }
    const ok = await unlock(currentPin);
    if (ok) {
      setPin(''); setError(false); setTries(0);
    } else {
      setError(true); setTries(t => t + 1);
      toast.error('Wrong PIN');
      setPin('');
      if (tries + 1 >= 3) {
        toast.error('Too many attempts, logging out');
        localStorage.clear();
        location.reload();
      }
    }
  };

  // Keyboard support: numbers 0-9, Backspace, Delete, Enter (physical keyboard)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setPin(p => p.length < 4 ? p + e.key : p);
        setError(false);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin(p => p.slice(0, -1));
      } else if (e.key === 'Delete') {
        e.preventDefault();
        setPin('');
        setError(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // trigger unlock via current pin length check inside handleUnlock
        handleUnlock();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPin('');
        setError(false);
      }
    };
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [pin, handleUnlock]);

  return (
    <div className="fixed inset-0 z-[200] auth-gradient flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="auth-glass p-8 rounded-3xl shadow-2xl w-full max-w-sm text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-white mb-1">Locked</h2>
        <p className="text-xs text-white/60 mb-6">Locks after {Math.round(lockIntervalMs/60000)}min of inactivity • Enter PIN</p>

        <div className="flex justify-center gap-3 mb-6">
          {[0,1,2,3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${i < pin.length ? 'bg-white border-white' : 'border-white/30'} ${error ? '!border-red-400 !bg-red-400/50' : ''}`} />
          ))}
        </div>

        {/* Hidden input to support physical keyboard + mobile numeric keyboard */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={pin}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
            setPin(v);
            setError(false);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 4) handleUnlock(); }}
          className="sr-only"
          autoFocus
          aria-label="PIN"
        />

        <div className="grid grid-cols-3 gap-3 mb-4">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} onClick={() => handlePress(String(n))} className="h-14 rounded-2xl bg-white text-black font-bold text-xl active:scale-95 transition-transform hover:bg-gray-100">
              {n}
            </button>
          ))}
          <button onClick={handleClear} className="h-14 rounded-2xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors text-sm">Clear</button>
          <button onClick={() => handlePress('0')} className="h-14 rounded-2xl bg-white text-black font-bold text-xl active:scale-95 transition-transform">0</button>
          <button onClick={handleDelete} className="h-14 rounded-2xl bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors">
            <Delete className="w-6 h-6" />
          </button>
        </div>

        <button onClick={handleUnlock} disabled={pin.length < 4} className="w-full bg-white text-black font-bold py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">
          Unlock
        </button>
        <p className="text-[10px] text-white/40 mt-3">Forgot PIN? Clear storage to logout (3 fails auto-logout)</p>
      </motion.div>
    </div>
  );
}
