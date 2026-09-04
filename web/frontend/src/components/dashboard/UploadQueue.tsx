import { Pause, Play, X, RotateCcw } from "lucide-react";
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
}

export function UploadQueue({ items, paused, onClearFinished, onCancelAll, onCancelItem, onPauseAll, onResumeAll, onRetryItem }: UploadQueueProps) {
    if (items.length === 0) return null;

    const hasPendingOrActive = items.some(i => i.status === 'pending' || i.status === 'uploading' || i.status === 'paused');

    // Aggregate across all files: total remaining bytes over combined live speed.
    const active = items.filter(i => i.status === 'pending' || i.status === 'uploading' || i.status === 'paused');
    const totalBytes = active.reduce((s, i) => s + (i.size || 0), 0);
    const doneBytes = active.reduce((s, i) => s + ((i.size || 0) * ((i.progress ?? 0) / 100)), 0);
    const liveSpeed = active.reduce((s, i) => s + (i.status === 'uploading' ? (i.speed || 0) : 0), 0);
    const remaining = Math.max(0, totalBytes - doneBytes);
    const overallProgress = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0;
    const overallEta = liveSpeed > 0 && remaining > 0 ? Math.round(remaining / liveSpeed) : undefined;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-telegram-surface border border-telegram-border rounded-xl shadow-2xl overflow-hidden z-[100] max-md:bottom-20">
            <div className="p-3 border-b border-telegram-border bg-telegram-hover">
                <div className="flex justify-between items-center">
                    <h4 className="text-sm font-medium text-telegram-text">Uploads{paused && <span className="ml-2 text-[10px] text-yellow-400 font-bold uppercase">Paused</span>}</h4>
                    <div className="flex gap-2 items-center">
                        {hasPendingOrActive && (
                            <>
                                <button onClick={paused ? onResumeAll : onPauseAll} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors" title={paused ? 'Resume all' : 'Pause queue'}>
                                    {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                    {paused ? 'Resume' : 'Pause'}
                                </button>
                                <button onClick={onCancelAll} className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancel All</button>
                            </>
                        )}
                        <button onClick={onClearFinished} className="text-xs text-telegram-primary hover:text-telegram-text transition-colors">Clear Finished</button>
                    </div>
                </div>
                {hasPendingOrActive && (
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
                {items.map(item => (
                    <div key={item.id} className="flex flex-col gap-1 p-2 bg-telegram-hover rounded">
                        <div className="flex items-center gap-3 text-sm">
                            <div className={`w-2 h-2 rounded-full ${item.status === 'pending' ? 'bg-yellow-500' :
                                item.status === 'uploading' ? 'bg-blue-500 animate-pulse' :
                                    item.status === 'cancelled' ? 'bg-gray-500' :
                                        item.status === 'error' ? 'bg-red-500' : 'bg-green-500'
                                }`} />
                            <div className="flex-1 truncate text-telegram-subtext text-xs" title={item.path}>
                                {item.path.split(/[/\\]/).pop() || item.name}
                            </div>
                            {item.status === 'uploading' && item.progress !== undefined && (
                                <div className="text-xs text-blue-400 font-mono font-bold">{item.progress}%</div>
                            )}
                            {item.status === 'paused' && <div className="text-xs text-yellow-400 font-bold">Paused</div>}
                            {item.status === 'error' && <div className="text-xs text-red-400">Error</div>}
                            {item.status === 'cancelled' && <div className="text-xs text-gray-400">Cancelled</div>}
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
                        </div>
                        {item.status === 'uploading' && (
                            <>
                                <div className="w-full bg-telegram-border h-1.5 mt-1 rounded-full overflow-hidden">
                                    <div
                                        className="bg-blue-500 h-full rounded-full transition-all duration-300"
                                        style={{ width: `${item.progress || 0}%` }}
                                    />
                                </div>
                                <div className="flex justify-between items-center mt-1 text-[10px] text-telegram-subtext">
                                    <span>{item.speed ? `${formatBytes(item.speed)}/s` : 'Calculating...'}</span>
                                    <span>{item.eta ? `ETA: ${formatDuration(item.eta)}` : ''}</span>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
