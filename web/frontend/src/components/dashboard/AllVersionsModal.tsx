import { useState, useEffect } from 'react';
import { X, Download, RotateCcw, History } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '../../api';
import { formatBytes } from '../../utils';

interface VersionRow {
    id?: string;
    message_id: number;
    folder_id?: number;
    name: string;
    size?: number;
    version_no?: number;
    created_at?: string;
}

interface AllVersionsModalProps {
    onClose: () => void;
}

export function AllVersionsModal({ onClose }: AllVersionsModalProps) {
    const [versions, setVersions] = useState<VersionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const rows = await api.getAllVersions();
            setVersions(rows as VersionRow[]);
        } catch {
            setVersions([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const grouped = versions.reduce<Record<string, VersionRow[]>>((acc, v) => {
        const key = v.name || `file-${v.message_id}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(v);
        return acc;
    }, {});

    const handleDownload = async (v: VersionRow) => {
        try {
            const blob = await api.downloadFile(v.folder_id ?? 0, v.message_id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${v.name}.v${v.version_no ?? 1}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e: any) {
            toast.error(`Download failed: ${e?.message || 'version may be permanently deleted'}`);
        }
    };

    const handleRestore = async (v: VersionRow) => {
        if (!confirm(`Restore ${v.name} to version v${v.version_no ?? 1}? Current file will be moved to Trash.`)) return;
        setBusyId(v.message_id);
        try {
            await api.restoreVersion(v.message_id, v.message_id, v.folder_id, v.name);
            toast.success('Restored');
            await load();
        } catch (e: any) {
            toast.error(`Restore failed: ${e?.message || 'error'}`);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="glass-modal rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-telegram-border flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                        <History className="w-4 h-4 text-telegram-primary shrink-0" />
                        <h3 className="text-sm font-bold text-telegram-text truncate">All Versions</h3>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full"><X className="w-4 h-4 text-telegram-subtext" /></button>
                </div>
                <div className="p-4 max-h-[70vh] overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center p-6"><div className="w-6 h-6 border-2 border-telegram-primary border-t-transparent rounded-full animate-spin" /></div>
                    ) : Object.keys(grouped).length === 0 ? (
                        <div className="text-center py-8 text-telegram-subtext">
                            <p className="text-sm">No versions yet</p>
                            <p className="text-[11px] mt-1">Edit and save files to create versions.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => (
                                <div key={name} className="space-y-2">
                                    <p className="text-xs font-bold text-telegram-subtext uppercase tracking-wider truncate">{name}</p>
                                    <div className="space-y-2">
                                        {rows.sort((a, b) => (b.version_no ?? 0) - (a.version_no ?? 0)).map((v) => (
                                            <div key={v.id ?? `${v.message_id}-${v.version_no}`} className="flex items-center gap-3 p-3 rounded-xl border border-telegram-border bg-white/[0.02]">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-telegram-text">v{v.version_no ?? 1}</p>
                                                    <p className="text-[11px] text-telegram-subtext">
                                                        {v.created_at ? new Date(v.created_at).toLocaleString() : ''} • {formatBytes(v.size || 0)}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleRestore(v)}
                                                    disabled={busyId === v.message_id}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-telegram-primary/15 hover:bg-telegram-primary/25 text-telegram-primary rounded-lg text-[11px] font-bold disabled:opacity-50"
                                                >
                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                    {busyId === v.message_id ? '...' : 'Restore'}
                                                </button>
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
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
