import { useState, useEffect } from 'react';
import { X, History, Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '../../api';
import { formatBytes } from '../../utils';

interface VersionsModalProps {
    file: any;
    activeFolderId: number | null;
    onClose: () => void;
    onRestored: () => void;
}

export function VersionsModal({ file, activeFolderId, onClose, onRestored }: VersionsModalProps) {
    const folderId = (file as any).folder_id ?? activeFolderId ?? undefined;
    const [versions, setVersions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<number | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            setVersions(await api.getVersions(file.id, file.name, folderId));
        } catch {
            setVersions([]);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const handleDownload = async (v: any) => {
        try {
            const blob = await api.downloadFile(folderId ?? 0, v.message_id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${file.name}.v${v.version_no}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e: any) {
            toast.error(`Download failed: ${e?.message || 'version may be permanently deleted'}`);
        }
    };

    const handleRestore = async (v: any) => {
        if (!confirm(`Restore v${v.version_no} of "${file.name}"? The current file will be moved to Trash.`)) return;
        setBusy(v.message_id);
        try {
            await api.restoreVersion(file.id, v.message_id, folderId, file.name);
            toast.success(`Restored v${v.version_no}`);
            api.logActivity('version-restore', `v${v.version_no}`, file.name).catch(() => {});
            onRestored();
            await load();
        } catch (e: any) {
            toast.error(`Restore failed: ${e?.message || 'error'}`);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="glass-modal rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-telegram-border flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                        <History className="w-4 h-4 text-telegram-primary shrink-0" />
                        <h3 className="text-sm font-bold text-telegram-text truncate">Versions — {file.name}</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full"><X className="w-4 h-4 text-telegram-subtext" /></button>
                </div>
                <div className="p-4 max-h-[60vh] overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center p-6"><div className="w-6 h-6 border-2 border-telegram-primary border-t-transparent rounded-full animate-spin" /></div>
                    ) : versions.length === 0 ? (
                        <div className="text-center py-8 text-telegram-subtext">
                            <p className="text-sm">No older versions yet</p>
                            <p className="text-[11px] mt-1">Each edit-save stores the previous file here automatically.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 p-3 rounded-xl border border-telegram-primary/30 bg-telegram-primary/5">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-telegram-text truncate">{file.name}</p>
                                    <p className="text-[11px] text-telegram-subtext">Current version • {formatBytes(file.size || 0)}</p>
                                </div>
                                <span className="text-[10px] font-bold uppercase text-telegram-primary">Current</span>
                            </div>
                            {versions.map((v: any) => (
                                <div key={v.id ?? `${v.message_id}-${v.version_no}`} className="flex items-center gap-3 p-3 rounded-xl border border-telegram-border bg-white/[0.02]">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-telegram-text">v{v.version_no}</p>
                                        <p className="text-[11px] text-telegram-subtext">
                                            {v.created_at ? new Date(v.created_at).toLocaleString() : ''} • {formatBytes(v.size || 0)}
                                        </p>
                                    </div>
                                    {v.message_id !== file.id && (
                                        <button
                                            onClick={() => handleRestore(v)}
                                            disabled={busy !== null}
                                            className="flex items-center gap-1 px-2.5 py-1.5 bg-telegram-primary/15 hover:bg-telegram-primary/25 text-telegram-primary rounded-lg text-[11px] font-bold disabled:opacity-50"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            {busy === v.message_id ? '...' : 'Restore'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleDownload(v)}
                                        className="p-1.5 hover:bg-white/10 rounded-lg text-telegram-subtext hover:text-telegram-text"
                                        title="Download this version"
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
