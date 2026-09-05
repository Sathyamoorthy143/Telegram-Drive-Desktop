import { Pause, Play, X, RotateCcw, Upload, Trash2, CheckSquare, Square } from "lucide-react";
import { QueueItem } from "../../types";
import { formatBytes, formatDuration } from "../../utils";

interface UploadQueueProps {
    items: QueueItem[];
    paused: boolean;
    onClearFinished: () => void;
    onCancelAll: () => void;
    onCancelItem: (id: string) => void;
    onPauseAll: () => void;
    onResumeAll: () => void;
    onRetryItem?: (id: string) => void;
    // Controllable staged uploads
    onToggleSelect?: (id: string) => void;
    onSelectAll?: (select: boolean) => void;
    onStartSelected?: () => void;
    onPauseItem?: (id: string) => void;
    onResumeItem?: (id: string) => void;
    onRemoveItem?: (id: string) => void;
}

export function UploadQueue({ items, paused, onClearFinished, onCancelAll, onCancelItem, onPauseAll, onResumeAll, onRetryItem, onToggleSelect, onSelectAll, onStartSelected, onPauseItem, onResumeItem, onRemoveItem }: UploadQueueProps) {
    if (items.length === 0) return null;

    const isStaged = (i: QueueItem) => (i as any).status === 'staged';
    const isSelected = (i: QueueItem) => (i.selected !== false);
    const hasPendingOrActive = items.some(i => i.status === 'pending' || i.status === 'uploading' || i.status === 'paused' || (i as any).status === 'staged');
    const staged = items.filter(i => (i as any).status === 'staged');
    const stagedSelected = staged.filter(isSelected);
    const stagedBytes = stagedSelected.reduce((s, i) => s + (i.size || 0), 0);
    const allSelectable = items.filter(i => (i as any).status === 'staged' || i.status === 'pending' || i.status === 'paused');
    const allChecked = allSelectable.length > 0 && allSelectable.every(isSelected);

    // Aggregate across all files: total remaining bytes over combined live speed.
    const active = items.filter(i => i.status === 'pending' || i.status === 'uploading' || i.status === 'paused');
    const totalBytes = active.reduce((s, i) => s + (i.size || 0), 0);
    const doneBytes = active.reduce((s, i) => s + ((i.size || 0) * ((i.progress ?? 0) / 100)), 0);
    const liveSpeed = active.reduce((s, i) => s + (i.status === 'uploading' ? (i.speed || 0) : 0), 0);
    const remaining = Math.max(0, totalBytes - doneBytes);
    const overallProgress = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0;
    const overallEta = liveSpeed > 0 && remaining > 0 ? Math.round(remaining / liveSpeed) : undefined;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[22rem] bg-telegram-surface border border-telegram-border rounded-xl shadow-2xl overflow-hidden z-[100] max-md:bottom-20">
            <div className="p-3 border-b border-telegram-border bg-telegram-hover">
                <div className="flex justify-between items-center">
                    <h4 className="text-sm font-medium text-telegram-text">Uploads{paused && <span className="ml-2 text-[10px] text-yellow-400 font-bold uppercase">Paused</span>}</h4>
                    <div className="flex gap-2 items-center">
                        {hasPendingOrActive && (
                            <>
                                <button onClick={paused ? onResumeAll : onPauseAll} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors" title={paused ? 'Resume all' : 'Pause all'}>
                                    {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                    {paused ? 'Resume' : 'Pause'}
                                </button>
                                <button onClick={onCancelAll} className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancel All</button>
                            </>
                        )}
                        <button onClick={onClearFinished} className="text-xs text-telegram-primary hover:text-telegram-text transition-colors">Clear Finished</button>
                    </div>
                </div>
                {/* Staged control bar: checkbox selection + start */}
                {staged.length > 0 && (
                    <div className="mt-2 p-2 bg-telegram-surface border border-telegram-border rounded-lg">
                        <div className="flex items-center justify-between gap-2">
                            <button
                                onClick={() => onSelectAll?.(!allChecked)}
                                className="flex items-center gap-1.5 text-xs text-telegram-subtext hover:text-telegram-text transition-colors"
                                title={allChecked ? 'Deselect all' : 'Select all'}
                            >
                                {allChecked ? <CheckSquare className="w-4 h-4 text-telegram-primary" /> : <Square className="w-4 h-4" />}
                                {stagedSelected.length}/{staged.length} selected
                            </button>
                            <span className="text-[10px] text-telegram-subtext font-mono">{formatBytes(stagedBytes)}</span>
                        </div>
                        <button
                            onClick={() => onStartSelected?.()}
                            disabled={stagedSelected.length === 0}
                            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-telegram-primary hover:bg-telegram-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition-colors"
                        >
                            <Upload className="w-3.5 h-3.5" />
                            Upload selected ({stagedSelected.length})
                        </button>
                        <p className="mt-1 text-[10px] text-telegram-subtext text-center">Tick checkboxes to choose which files upload</p>
                    </div>
                )}
                {hasPendingOrActive && active.length > 0 && (
                    <div className="mt-2">
                        <div className="flex justify-between items-center text-[10px] text-telegram-subtext mb-1">
                            <span className="font-mono font-bold text-blue-400">
                                {liveSpeed > 0 ? `${formatBytes(liveSpeed)}/s` : 'Starting...'}
                            </span>
                            <span>
                                {overallEta !== undefined ? `ETA ${formatDuration(overallEta)}` : 'ETA —'} • {overallProgress}%
                            </span>
                        </div>
                        <div className="w-full bg-telegram-border h-1.5 rounded-full overflow-hidden">
                            <div className="bg-telegram-primary h-full rounded-full transition-all duration-300" style={{ width: `${overallProgress}%` }} />
                        </div>
                    </div>
                )}
            </div>
            <div className="max-h-60 overflow-y-auto p-2 space-y-2">
                {items.map(item => {
                    const stagedItem = (item as any).status === 'staged';
                    const checked = item.selected !== false;
                    const canPause = item.status === 'uploading' || item.status === 'pending';
                    const canResumeSingle = item.status === 'paused';
                    return (
                    <div key={item.id} className={`flex flex-col gap-1 p-2 rounded ${stagedItem ? (checked ? 'bg-telegram-primary/10 border border-telegram-primary/30' : 'bg-telegram-hover border border-transparent opacity-70') : 'bg-telegram-hover'}`}>
                        <div className="flex items-center gap-2 text-sm">
                            {/* Checkbox — the "choose which one to upload" control */}
                            {(stagedItem || item.status === 'pending' || item.status === 'paused') && onToggleSelect && (
                                <button
                                    onClick={() => onToggleSelect(item.id)}
                                    className="shrink-0 p-0.5 hover:bg-telegram-primary/10 rounded transition-colors"
                                    title={checked ? `Deselect ${item.name}` : `Select ${item.name}`}
                                >
                                    {checked
                                        ? <CheckSquare className="w-4 h-4 text-telegram-primary" />
                                        : <Square className="w-4 h-4 text-telegram-subtext" />}
                                </button>
                            )}
                            <div className={`w-2 h-2 rounded-full shrink-0 ${stagedItem ? 'bg-purple-400' :
                                item.status === 'pending' ? 'bg-yellow-500' :
                                item.status === 'uploading' ? 'bg-blue-500 animate-pulse' :
                                    item.status === 'paused' ? 'bg-yellow-400' :
                                    item.status === 'cancelled' ? 'bg-gray-500' :
                                        item.status === 'error' ? 'bg-red-500' : 'bg-green-500'
                                }`} />
                            <div className="flex-1 min-w-0">
                                <div className="truncate text-telegram-subtext text-xs" title={item.path || item.name}>
                                    {(item.path || item.name || '').split(/[/\\]/).pop()}
                                </div>
                                <div className="text-[10px] text-telegram-subtext/70 font-mono">{formatBytes(item.size || 0)}</div>
                            </div>
                            {stagedItem && <div className="text-[10px] text-purple-300 font-bold uppercase shrink-0">Staged</div>}
                            {item.status === 'uploading' && item.progress !== undefined && (
                                <div className="text-xs text-blue-400 font-mono font-bold shrink-0">{item.progress}%</div>
                            )}
                            {item.status === 'paused' && <div className="text-xs text-yellow-400 font-bold shrink-0">Paused</div>}
                            {item.status === 'error' && <div className="text-xs text-red-400 shrink-0">Error</div>}
                            {item.status === 'cancelled' && <div className="text-xs text-gray-400 shrink-0">Cancelled</div>}
                            {/* Per-file pause / resume */}
                            {canPause && onPauseItem && (
                                <button onClick={() => onPauseItem(item.id)} className="p-1 hover:bg-yellow-500/10 rounded transition-colors" title={`Pause ${item.name}`}>
                                    <Pause className="w-3.5 h-3.5 text-yellow-400" />
                                </button>
                            )}
                            {canResumeSingle && onResumeItem && (
                                <button onClick={() => onResumeItem(item.id)} className="p-1 hover:bg-green-500/10 rounded transition-colors" title={`Resume ${item.name}`}>
                                    <Play className="w-3.5 h-3.5 text-green-400" />
                                </button>
                            )}
                            {item.status === 'error' && onRetryItem && (
                                <button onClick={() => onRetryItem(item.id)} className="flex items-center gap-1 text-xs text-telegram-primary hover:text-telegram-text transition-colors" title="Resume upload">
                                    <RotateCcw className="w-3.5 h-3.5" /> Resume
                                </button>
                            )}
                            {(item.status === 'pending' || item.status === 'uploading' || item.status === 'paused') && (
                                <button onClick={() => onCancelItem(item.id)} className="p-1 hover:bg-red-500/10 rounded transition-colors" title={`Cancel ${item.name}`}>
                                    <X className="w-3.5 h-3.5 text-red-400" />
                                </button>
                            )}
                            {stagedItem && (
                                <button onClick={() => (onRemoveItem ? onRemoveItem(item.id) : onCancelItem(item.id))} className="p-1 hover:bg-red-500/10 rounded transition-colors" title={`Remove ${item.name} from stage`}>
                                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </button>
                            )}
                        </div>
                        {(item.status === 'uploading' || item.status === 'paused') && (
                            <>
                                <div className="w-full bg-telegram-border h-1.5 mt-1 rounded-full overflow-hidden">
                                    <div
                                        className={`${item.status === 'paused' ? 'bg-yellow-400' : 'bg-blue-500'} h-full rounded-full transition-all duration-300`}
                                        style={{ width: `${item.progress || 0}%` }}
                                    />
                                </div>
                                <div className="flex justify-between items-center mt-1 text-[10px] text-telegram-subtext">
                                    <span>{item.speed ? `${formatBytes(item.speed)}/s` : item.status === 'paused' ? 'Paused' : 'Calculating...'}</span>
                                    <span>{item.eta ? `ETA: ${formatDuration(item.eta)}` : ''}</span>
                                </div>
                            </>
                        )}
                    </div>
                    );
                })}
            </div>
        </div>
    )
}
