import { useState, useEffect } from 'react';
import { X, History, FileUp, FileDown, Search, Trash2 } from 'lucide-react';
import { formatBytes } from '../../utils';

interface TransferLog {
    id: string;
    name: string;
    type: 'upload' | 'download';
    size: number;
    status: 'success' | 'error';
    timestamp: number;
    error?: string;
}

interface TransferLogsProps {
    onClose: () => void;
}

export function TransferLogs({ onClose }: TransferLogsProps) {
    const [logs, setLogs] = useState<TransferLog[]>([]);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        // In a real app, we'd fetch this from the backend or localStorage
        const savedLogs = localStorage.getItem('transfer_logs');
        if (savedLogs) {
            setLogs(JSON.parse(savedLogs));
        }
    }, []);

    const filteredLogs = logs.filter(l => l.name.toLowerCase().includes(searchTerm.toLowerCase()))
                             .sort((a, b) => b.timestamp - a.timestamp);

    const clearLogs = () => {
        setLogs([]);
        localStorage.removeItem('transfer_logs');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="glass-modal rounded-2xl w-full max-w-4xl max-h-[80vh] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-telegram-border flex items-center justify-between bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-telegram-secondary/20 rounded-lg">
                            <History className="w-5 h-5 text-telegram-secondary" />
                        </div>
                        <h2 className="text-lg font-bold text-telegram-text">Transfer History</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 w-4 h-4 text-telegram-subtext" />
                            <input 
                                type="text" 
                                placeholder="Search history..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="bg-white/5 border border-telegram-border rounded-lg pl-9 pr-4 py-2 text-xs text-telegram-text focus:outline-none focus:ring-1 focus:ring-telegram-secondary w-48"
                            />
                        </div>
                        <button onClick={clearLogs} className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors flex items-center gap-2 text-xs font-medium">
                            <Trash2 className="w-4 h-4" />
                            Clear
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                            <X className="w-5 h-5 text-telegram-subtext" />
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-y-auto p-4">
                    {filteredLogs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-telegram-subtext gap-4">
                            <History className="w-12 h-12 opacity-20" />
                            <p>No transfer history found</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold border-b border-telegram-border">
                                    <th className="px-4 py-3">File</th>
                                    <th className="px-4 py-3">Type</th>
                                    <th className="px-4 py-3">Size</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3 text-right">Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLogs.map(log => (
                                    <tr key={log.id} className="border-b border-telegram-border/50 hover:bg-white/5 transition-colors group">
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-3">
                                                {log.type === 'upload' ? <FileUp className="w-4 h-4 text-blue-400" /> : <FileDown className="w-4 h-4 text-telegram-secondary" />}
                                                <span className="text-sm font-medium text-telegram-text truncate max-w-xs">{log.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className={`text-[10px] font-bold px-2 py-1 rounded ${log.type === 'upload' ? 'bg-blue-500/10 text-blue-400' : 'bg-telegram-secondary/10 text-telegram-secondary'}`}>
                                                {log.type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-sm text-telegram-subtext">
                                            {formatBytes(log.size)}
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${log.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                                                <span className={`text-xs ${log.status === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                                    {log.status === 'success' ? 'Completed' : 'Failed'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-right text-xs text-telegram-subtext font-mono">
                                            {new Date(log.timestamp).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
