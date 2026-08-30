import { X, HardDrive, Trash2, Info, FileText, Calendar, Database, Type } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { formatBytes } from '../../utils';

interface PreviewPaneProps {
    file: TelegramFile | null;
    onClose: () => void;
    onDownload: (id: number, name: string, size: number) => void;
    onDelete: (id: number) => void;
}

export function PreviewPane({ file, onClose, onDownload, onDelete }: PreviewPaneProps) {
    if (!file) {
        return (
            <div className="w-80 border-l border-telegram-border bg-telegram-surface/50 flex flex-col items-center justify-center p-8 text-center text-telegram-subtext animate-in fade-in duration-300">
                <div className="w-16 h-16 rounded-2xl bg-telegram-hover flex items-center justify-center mb-4">
                    <Info className="w-8 h-8 opacity-20" />
                </div>
                <p className="text-sm font-medium">Select a file to preview its details</p>
            </div>
        );
    }

    const isFolder = file.type === 'folder';

    return (
        <div className="w-80 border-l border-telegram-border bg-telegram-surface flex flex-col animate-in slide-in-from-right duration-300">
            <div className="h-12 flex items-center justify-between px-4 border-b border-telegram-border">
                <span className="text-xs font-bold uppercase tracking-wider text-telegram-subtext">Preview</span>
                <button onClick={onClose} className="p-1 hover:bg-telegram-hover rounded-md transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-32 h-32 rounded-3xl bg-telegram-hover flex items-center justify-center mb-4 shadow-xl border border-telegram-border relative group">
                        <FileTypeIcon filename={file.name} className="w-16 h-16" />
                        {!isFolder && (
                            <div className="absolute inset-0 bg-black/40 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                <span className="text-[10px] font-bold text-white uppercase tracking-widest">No Thumbnail</span>
                            </div>
                        )}
                    </div>
                    <h3 className="text-base font-bold text-telegram-text break-all line-clamp-2 px-2">
                        {file.name}
                    </h3>
                    <p className="text-xs text-telegram-subtext mt-1">
                        {isFolder ? 'File folder' : 'Document'}
                    </p>
                </div>

                <div className="space-y-6">
                    <section>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-telegram-subtext mb-3 px-1">Details</h4>
                        <div className="bg-telegram-hover/30 rounded-xl border border-telegram-border overflow-hidden">
                            <DetailRow icon={Database} label="Size" value={isFolder ? '--' : formatBytes(file.size)} />
                            <DetailRow icon={Type} label="Type" value={isFolder ? 'Folder' : file.name.split('.').pop()?.toUpperCase() || 'File'} />
                            <DetailRow icon={Calendar} label="Modified" value={file.created_at || 'Recently'} />
                        </div>
                    </section>

                    <section>
                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-telegram-subtext mb-3 px-1">Actions</h4>
                        <div className="grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => onDownload(file.id, file.name, file.size)}
                                className="flex flex-col items-center gap-2 p-3 bg-telegram-primary/10 hover:bg-telegram-primary/20 text-telegram-primary rounded-xl transition-all border border-telegram-primary/20"
                            >
                                <HardDrive className="w-5 h-5" />
                                <span className="text-[10px] font-bold uppercase">Download</span>
                            </button>
                            <button 
                                onClick={() => onDelete(file.id)}
                                className="flex flex-col items-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all border border-red-500/20"
                            >
                                <Trash2 className="w-5 h-5" />
                                <span className="text-[10px] font-bold uppercase">Delete</span>
                            </button>
                        </div>
                    </section>
                </div>
            </div>

            <div className="p-4 bg-telegram-hover/20 border-t border-telegram-border">
                <button className="w-full py-2.5 bg-telegram-surface border border-telegram-border hover:bg-telegram-hover text-telegram-text rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm">
                    <FileText className="w-4 h-4" />
                    Full Properties
                </button>
            </div>
        </div>
    );
}

function DetailRow({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-telegram-border/50 last:border-0 hover:bg-telegram-hover/50 transition-colors">
            <Icon className="w-3.5 h-3.5 text-telegram-subtext" />
            <div className="flex-1 min-w-0">
                <div className="text-[10px] text-telegram-subtext leading-none mb-0.5">{label}</div>
                <div className="text-xs font-medium text-telegram-text truncate">{value}</div>
            </div>
        </div>
    );
}
