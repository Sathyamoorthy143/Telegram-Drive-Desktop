import { X, FileInfo, Calendar, Hash, HardDrive, User, Folder } from 'lucide-react';
import { TelegramFile } from '../../types';
import { formatBytes } from '../../utils';

interface PropertiesModalProps {
    file: TelegramFile;
    onClose: () => void;
}

export function PropertiesModal({ file, onClose }: PropertiesModalProps) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="glass-modal rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-telegram-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <FileInfo className="w-4 h-4 text-telegram-primary" />
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
                                <span>Size</span>
                            </div>
                            <span className="text-telegram-text font-medium">{formatBytes(file.size)} ({file.size.toLocaleString()} bytes)</span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-telegram-subtext">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>Created</span>
                            </div>
                            <span className="text-telegram-text font-medium">{file.created_at ? new Date(file.created_at).toLocaleString() : 'N/A'}</span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-telegram-subtext">
                                <Hash className="w-3.5 h-3.5" />
                                <span>Message ID</span>
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
