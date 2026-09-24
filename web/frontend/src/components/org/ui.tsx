import type { ComponentType, FormEvent, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, X, Sparkles } from 'lucide-react';

export function OrgShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  );
}

export function PageHeader({ icon, title, subtitle, actions, onBack, backTitle }: {
  icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode; onBack?: () => void; backTitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {onBack && (
        <button onClick={onBack} className="p-2 rounded-lg border border-telegram-border hover:bg-telegram-hover" title={backTitle ?? 'Back'}>
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      {icon}
      <div className="flex-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-telegram-subtext">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Banner({ variant, children }: { variant: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const cls = variant === 'error'
    ? 'mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/40 text-sm text-red-500'
    : variant === 'warning'
      ? 'mb-4 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/40 text-sm text-yellow-600'
      : 'mb-4 p-3 rounded-xl bg-telegram-surface border border-telegram-border text-sm text-telegram-subtext';
  return <div className={cls}>{children}</div>;
}

export function OrgCard({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  return <div className={`p-4 bg-telegram-surface border border-telegram-border rounded-xl ${dimmed ? 'opacity-60' : ''}`}>{children}</div>;
}

export function OrgModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm bg-telegram-surface border border-telegram-border rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-telegram-hover" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthCard({ title, submitLabel, busy, error, onSubmit, children, footer, successBurst }: {
  title: string; submitLabel: string; busy: boolean; error: string | null;
  onSubmit: (e: FormEvent) => void; children: ReactNode; footer?: ReactNode; successBurst?: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      {title ? <h2 className="font-bold mb-4">{title}</h2> : null}
      {children}
      <AnimatePresence mode="wait">
        {successBurst ? (
          <motion.div
            key="burst"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1.1, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center justify-center gap-2 mb-3"
          >
            <Sparkles className="w-5 h-5 text-telegram-primary animate-pulse" />
            <span className="text-sm text-telegram-primary font-medium">Unlocked!</span>
          </motion.div>
        ) : error ? (
          <motion.p
            key="err"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="text-sm text-red-500 mb-3"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <button type="submit" disabled={busy}
        className="w-full px-4 py-2 rounded-lg bg-telegram-primary text-white font-medium disabled:opacity-50">
        {busy ? 'Working…' : submitLabel}
      </button>
      {footer}
    </form>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-telegram-subtext">{children}</p>;
}

export function TabBar<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string; icon: ComponentType<{ className?: string }> }[];
  active: T; onChange: (id: T) => void;
}) {
  return (
    <nav className="flex gap-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${active === t.id ? 'bg-telegram-primary text-white' : 'hover:bg-telegram-hover'}`}>
          <t.icon className="w-3.5 h-3.5" /> {t.label}
        </button>
      ))}
    </nav>
  );
}
