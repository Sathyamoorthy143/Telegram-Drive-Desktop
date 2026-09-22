import { useEffect, useMemo, useState } from 'react';
import { X, HardDrive, Files, FolderOpen, RefreshCw, TrendingUp, TriangleAlert } from 'lucide-react';
import * as api from '../../../api';
import { formatBytes, getFileTypeCategory } from '../../../utils';

interface StorageInsightsProps {
  folderId: number | null;
  folderName?: string;
  onClose: () => void;
}

/** Accent color per file-type category (bar fill). */
export const CATEGORY_COLORS: Record<string, string> = {
  docs: 'bg-blue-400',
  excel: 'bg-green-400',
  slides: 'bg-orange-400',
  pdf: 'bg-red-400',
  images: 'bg-pink-400',
  video: 'bg-purple-400',
  audio: 'bg-yellow-400',
  archives: 'bg-teal-400',
  text: 'bg-sky-400',
  executable: 'bg-rose-400',
  other: 'bg-telegram-subtext',
};

export interface TypeStat { count: number; bytes: number }

/** Pure stats computation from a file list (unit-testable). */
export function computeStorageStats(files: any[]): {
  totalBytes: number; fileCount: number; folderCount: number; byType: Record<string, TypeStat>;
} {
  const byType: Record<string, TypeStat> = {};
  let totalBytes = 0, fileCount = 0, folderCount = 0;
  for (const item of files) {
    if (item.type === 'folder') { folderCount++; continue; }
    fileCount++;
    const size = Number(item.size) || 0;
    totalBytes += size;
    const cat = getFileTypeCategory(item.name || '');
    if (!byType[cat]) byType[cat] = { count: 0, bytes: 0 };
    byType[cat].count++;
    byType[cat].bytes += size;
  }
  return { totalBytes, fileCount, folderCount, byType };
}

export function StorageInsights({ folderId, folderName, onClose }: StorageInsightsProps) {
  const [files, setFiles] = useState<any[] | null>(null);
  const [bandwidth, setBandwidth] = useState<{ up_bytes: number; down_bytes: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanMs, setScanMs] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      // Special views (trash/starred/recent) are not real folders; their
      // stats come from the same listing endpoint with no folder filter.
      const special = folderId != null && folderId < 0;
      const rows = await api.getFiles(special ? undefined : (folderId ?? undefined), { limit: 5000 });
      setFiles(rows);
      try { setBandwidth(await api.getBandwidth()); } catch { setBandwidth(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load storage stats');
    } finally {
      setScanMs(Math.round(performance.now() - t0));
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [folderId]);

  const stats = useMemo(() => (files ? computeStorageStats(files) : null), [files]);
  const sorted = useMemo(
    () => Object.entries(stats?.byType || {}).filter(([, d]) => d.count > 0).sort((a, b) => b[1].bytes - a[1].bytes),
    [stats],
  );
  const topFiles = useMemo(
    () => (files || []).filter((f) => f.type !== 'folder').sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 5),
    [files],
  );
  const maxBytes = Math.max(...sorted.map(([, d]) => d.bytes), 1);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Storage insights">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar bg-telegram-surface border border-telegram-border rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center gap-3 px-5 py-4 border-b border-telegram-border bg-telegram-surface rounded-t-2xl">
          <HardDrive className="w-5 h-5 text-telegram-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-telegram-text">Storage insights</h2>
            <p className="text-xs text-telegram-subtext truncate">
              {folderName ? `Folder: ${folderName}` : 'Current view'}
              {scanMs > 0 && !loading ? ` • scanned in ${scanMs}ms` : ''}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg hover:bg-telegram-hover text-telegram-subtext" title="Rescan" aria-label="Rescan storage stats">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-telegram-hover text-telegram-subtext" title="Close" aria-label="Close storage insights">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
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

          {!loading && stats && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <HardDrive className="w-3.5 h-3.5 text-telegram-primary" />
                    <span className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold">Total</span>
                  </div>
                  <p className="text-lg font-bold text-telegram-text">{formatBytes(stats.totalBytes)}</p>
                </div>
                <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Files className="w-3.5 h-3.5 text-telegram-primary" />
                    <span className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold">Files</span>
                  </div>
                  <p className="text-lg font-bold text-telegram-text">{stats.fileCount.toLocaleString()}</p>
                </div>
                <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <FolderOpen className="w-3.5 h-3.5 text-telegram-primary" />
                    <span className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold">Folders</span>
                  </div>
                  <p className="text-lg font-bold text-telegram-text">{stats.folderCount.toLocaleString()}</p>
                </div>
                <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-telegram-primary" />
                    <span className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold">Bandwidth</span>
                  </div>
                  {bandwidth ? (
                    <p className="text-xs font-bold text-telegram-text leading-5">
                      ↑ {formatBytes(bandwidth.up_bytes)}<br />↓ {formatBytes(bandwidth.down_bytes)}
                    </p>
                  ) : (
                    <p className="text-xs text-telegram-muted pt-1">—</p>
                  )}
                </div>
              </div>
              {/* Type breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-telegram-text mb-3">By type</h3>
                {sorted.length === 0 ? (
                  <p className="text-sm text-telegram-muted py-4 text-center">No files in this view yet.</p>
                ) : (
                  <div className="space-y-2">
                    {sorted.map(([cat, d]) => (
                      <div key={cat} className="flex items-center gap-3">
                        <span className="w-20 text-xs capitalize text-telegram-text font-medium shrink-0">{cat}</span>
                        <div className="flex-1 h-2 bg-telegram-border rounded-full overflow-hidden" title={`${d.count} file(s)`}>
                          <div className={`h-full rounded-full ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.other}`}
                            style={{ width: `${Math.max(2, (d.bytes / maxBytes) * 100)}%` }} />
                        </div>
                        <span className="w-24 text-right text-xs text-telegram-text shrink-0">{formatBytes(d.bytes)}</span>
                        <span className="w-14 text-right text-[10px] text-telegram-subtext shrink-0">{d.count} f</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Largest files */}
              {topFiles.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-telegram-text mb-3">Largest files</h3>
                  <div className="space-y-1">
                    {topFiles.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-telegram-hover text-sm">
                        <span className="flex-1 truncate text-telegram-text">{f.name}</span>
                        <span className="text-xs text-telegram-subtext shrink-0">{formatBytes(f.size || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Averages */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                  <p className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold mb-1">Avg file size</p>
                  <p className="text-base font-bold text-telegram-text">
                    {stats.fileCount > 0 ? formatBytes(stats.totalBytes / stats.fileCount) : '—'}
                  </p>
                </div>
                <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl">
                  <p className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold mb-1">Biggest category</p>
                  <p className="text-base font-bold text-telegram-text capitalize">
                    {sorted[0] ? sorted[0][0] : '—'}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}