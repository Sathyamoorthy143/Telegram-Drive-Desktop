import { useEffect, useState } from 'react';
import { X, Calendar, Hash, HardDrive, Folder, Info, Loader2 } from 'lucide-react';
import { TelegramFile } from '../../types';
import { formatBytes } from '../../utils';
import { invoke } from '@tauri-apps/api/core';

interface PropertiesModalProps {
    file: TelegramFile;
    onClose: () => void;
}

export function PropertiesModal({ file, onClose }: PropertiesModalProps) {
    const [extra, setExtra] = useState<{ file_count: number; total_size: number; created_at: string } | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (file.type === 'folder') {
            setLoading(true);
            invoke<{ file_count: number; total_size: number; created_at: string }>('cmd_get_folder_properties', { folderId: file.id })
                .then(setExtra)
                .finally(() => setLoading(false));
        }
    }, [file]);

    const displaySize = extra ? extra.total_size : file.size;
    const displayDate = extra ? extra.created_at : file.created_at;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="glass-modal rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-telegram-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-telegram-primary" />
                        <h3 className="text-sm font-bold text-telegram-text">Properties</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                        <X className="w-4 h-4 text-telegram-subtext" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex flex-col items-center gap-3 pb-4 border-b border-telegram-border/50">
                        <div className={`p-4 rounded-2xl ${file.type === 'folder' ? 'bg-yellow-500/10' : 'bg-telegram-primary/10'}`}>
                            {file.type === 'folder' ? <Folder className="w-12 h-12 text-yellow-500" /> : <HardDrive className="w-12 h-12 text-telegram-primary" />}
                        </div>
                        <div className="text-center">
                            <h4 className="text-sm font-bold text-telegram-text break-all px-2">{file.name}</h4>
                            <p className="text-[10px] text-telegram-subtext uppercase tracking-widest mt-1">{file.type === 'folder' ? 'Folder' : 'File'}</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-telegram-subtext">
                                <HardDrive className="w-3.5 h-3.5" />
                                <span>{file.type === 'folder' ? 'Total Size' : 'Size'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {loading && <Loader2 className="w-3 h-3 animate-spin text-telegram-primary" />}
                                <span className="text-telegram-text font-medium">{formatBytes(displaySize)} ({displaySize.toLocaleString()} bytes)</span>
                            </div>
                        </div>

                        {file.type === 'folder' && extra && (
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 text-telegram-subtext">
                                    <Hash className="w-3.5 h-3.5" />
                                    <span>Contains</span>
                                </div>
                                <span className="text-telegram-text font-medium">{extra.file_count} files</span>
                            </div>
                        )}

                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-telegram-subtext">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{file.type === 'folder' ? 'Earliest Message' : 'Created'}</span>
                            </div>
                            <span className="text-telegram-text font-medium">{displayDate ? new Date(displayDate).toLocaleString() : 'N/A'}</span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-telegram-subtext">
                                <Hash className="w-3.5 h-3.5" />
                                <span>{file.type === 'folder' ? 'Channel ID' : 'Message ID'}</span>
                            </div>
                            <span className="text-telegram-text font-mono">#{file.id}</span>
                        </div>

                        {file.type !== 'folder' && (
                           <div className="pt-2">
                               <div className="bg-white/5 rounded-lg p-3 text-[10px] text-telegram-subtext leading-relaxed">
                                   <p className="font-bold text-telegram-text mb-1 uppercase tracking-tighter">Location</p>
                                   Telegram Cloud (End-to-End Encrypted)
                               </div>
                           </div>
                        )}
                    </div>
                </div>

                <div className="px-6 py-4 bg-white/5 border-t border-telegram-border flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-6 py-1.5 bg-telegram-primary hover:bg-telegram-primary-hover text-white rounded-lg text-xs font-bold transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
