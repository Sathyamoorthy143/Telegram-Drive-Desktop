import { useEffect, useMemo, useState } from 'react';
import { X, Copy, RefreshCw, Trash2, TriangleAlert, Check } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '../../../api';
import { formatBytes } from '../../../utils';

interface DuplicateFinderProps {
  folderId: number | null;
  onClose: () => void;
  /** Called after items are moved to trash so the parent can refetch. */
  onTrashChanged?: () => void;
}

export interface DuplicateGroup {
  /** `${name}|${size}` grouping key. */
  key: string;
  items: any[];
  /** Bytes that could be freed by trashing all but one copy. */
  freeableBytes: number;
}

/**
 * Pure duplicate detection: groups files by lowercase name + size.
 * Same name AND same byte size is a strong duplicate signal without
 * needing file content (which lives in Telegram, not metadata).
 */
export function findDuplicateGroups(files: any[]): DuplicateGroup[] {
  const byKey = new Map<string, any[]>();
  for (const f of files) {
    if (f.type === 'folder') continue;
    const key = `${String(f.name || '').toLowerCase()}|${Number(f.size) || 0}`;
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, items] of byKey) {
    if (items.length < 2) continue;
    const size = Number(items[0].size) || 0;
    groups.push({ key, items, freeableBytes: size * (items.length - 1) });
  }
  // Biggest savings first.
  return groups.sort((a, b) => b.freeableBytes - a.freeableBytes);
}

export function DuplicateFinder({ folderId, onClose, onTrashChanged }: DuplicateFinderProps) {
  const [files, setFiles] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Per-group index of the item to KEEP; every other copy is trashable. */
  const [keepIdx, setKeepIdx] = useState<Record<string, number>>({});
  const [trashing, setTrashing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const special = folderId != null && folderId < 0;
      const rows = await api.getFiles(special ? undefined : (folderId ?? undefined), { limit: 5000 });
      setFiles(rows);
      setKeepIdx({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan for duplicates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [folderId]);

  const groups = useMemo(() => (files ? findDuplicateGroups(files) : []), [files]);
  const totalFreeable = groups.reduce((s, g) => s + g.freeableBytes, 0);

  /** Trash every copy in the group except the kept one. */
  const trashGroup = async (group: DuplicateGroup) => {
    const keep = keepIdx[group.key] ?? 0;
    const victims = group.items.filter((_, i) => i !== keep);
    if (victims.length === 0) return;
    setTrashing(group.key);
    let ok = 0;
    for (const v of victims) {
      try {
        await api.deleteFile(v.id, folderId ?? undefined);
        ok++;
      } catch { /* keep going; report the count */ }
    }
    setTrashing(null);
    if (ok > 0) {
      toast.success(`Moved ${ok} duplicate${ok > 1 ? 's' : ''} to trash`);
      onTrashChanged?.();
      // Refresh in-place so the group list reflects reality.
      await load();
    } else {
      toast.error('Could not trash duplicates');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Duplicate finder">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar bg-telegram-surface border border-telegram-border rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center gap-3 px-5 py-4 border-b border-telegram-border bg-telegram-surface rounded-t-2xl">
          <Copy className="w-5 h-5 text-telegram-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-telegram-text">Duplicate finder</h2>
            <p className="text-xs text-telegram-subtext">
              {loading ? 'Scanning…' : groups.length > 0
                ? `${groups.length} duplicate group${groups.length > 1 ? 's' : ''} • ${formatBytes(totalFreeable)} recoverable`
                : 'No duplicates found'}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg hover:bg-telegram-hover text-telegram-subtext" title="Rescan" aria-label="Rescan for duplicates">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-telegram-hover text-telegram-subtext" title="Close" aria-label="Close duplicate finder">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2 text-telegram-muted">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-sm">Scanning folder…</span>
            </div>
          )}

          {!loading && error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-sm text-red-500 flex items-start gap-2">
              <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && groups.length === 0 && (
            <div className="py-10 text-center">
              <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-telegram-text font-medium">All clean!</p>
              <p className="text-xs text-telegram-subtext mt-1">No files share the same name and size in this view.</p>
            </div>
          )}

          {!loading && groups.map((group) => {
            const keep = keepIdx[group.key] ?? 0;
            const count = group.items.length;
            return (
              <div key={group.key} className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <p className="flex-1 text-sm font-medium text-telegram-text truncate">{group.items[0].name}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-telegram-primary/15 text-telegram-primary font-bold shrink-0">
                    ×{count}
                  </span>
                  <button
                    onClick={() => trashGroup(group)}
                    disabled={trashing === group.key}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 shrink-0"
                    title={`Keep 1 copy, trash ${count - 1} duplicate${count > 2 ? 's' : ''}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {trashing === group.key ? 'Trashing…' : `Trash ${count - 1}`}
                  </button>
                </div>
                <div className="space-y-1">
                  {group.items.map((f, i) => (
                    <label key={f.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-telegram-hover cursor-pointer text-xs">
                      <input
                        type="radio"
                        name={`keep-${group.key}`}
                        checked={keep === i}
                        onChange={() => setKeepIdx((prev) => ({ ...prev, [group.key]: i }))}
                        className="accent-telegram-primary"
                        aria-label={`Keep copy ${i + 1}`}
                      />
                      <span className="flex-1 truncate text-telegram-text">{f.name}</span>
                      <span className="text-telegram-subtext shrink-0">{formatBytes(f.size || 0)}</span>
                      <span className={`text-[10px] shrink-0 ${keep === i ? 'text-green-400 font-bold' : 'text-telegram-muted'}`}>
                        {keep === i ? 'KEEP' : 'duplicate'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}