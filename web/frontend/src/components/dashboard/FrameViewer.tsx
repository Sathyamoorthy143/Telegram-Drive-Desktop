import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Download, ExternalLink, FileWarning, Lock, PenLine } from 'lucide-react';
import * as api from '../../api';
import { TelegramFile } from '../../types';
import { getPreviewKind, getEditKind, PreviewKind } from '../../utils';

interface FrameViewerProps {
    file: TelegramFile;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    onEdit?: () => void;
    currentIndex?: number;
    totalItems?: number;
    activeFolderId: number | null;
}

const OFFICE_EMBED = 'https://view.officeapps.live.com/op/embed.aspx?src=';

export function FrameViewer({ file, onClose, onNext, onPrev, onEdit, currentIndex, totalItems, activeFolderId }: FrameViewerProps) {
    const isEncrypted = file.name.endsWith('.enc');
    const kind: PreviewKind = isEncrypted ? 'none' : getPreviewKind(file.name);
    const [frameSrc, setFrameSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(
        isEncrypted ? 'This file is end-to-end encrypted. Download it to decrypt with your lock PIN.' : null
    );

    useEffect(() => {
        if (isEncrypted) { setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setFrameSrc(null);

        const build = async () => {
            try {
                if (kind === 'office') {
                    // Office docs need a public URL for the external viewer.
                    // Create a short-lived (1 day) share link; revocable anytime.
                    const res: any = await api.createShare(
                        file.id,
                        (file as any).folder_id ?? activeFolderId ?? undefined,
                        1
                    );
                    if (cancelled) return;
                    const publicUrl = res.url || api.getShareUrl(res.token);
                    setFrameSrc(`${OFFICE_EMBED}${encodeURIComponent(publicUrl)}`);
                } else if (kind === 'video' || kind === 'audio') {
                    // stream endpoint supports range requests for seeking
                    setFrameSrc(api.getStreamUrl(activeFolderId ?? 'home', file.id));
                } else if (kind === 'none') {
                    setError('Preview not available for this file type.');
                } else {
                    setFrameSrc(api.getPreviewUrl(activeFolderId ?? 'home', file.id));
                }
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Failed to load preview');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        build();
        return () => { cancelled = true; };
    }, [file.id, activeFolderId, kind, isEncrypted, (file as any).folder_id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
            const k = e.key.toLowerCase();
            if (e.key === 'ArrowRight' || k === 'l') { e.preventDefault(); onNext?.(); }
            else if (e.key === 'ArrowLeft' || k === 'j') { e.preventDefault(); onPrev?.(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, onNext, onPrev]);

    const handleDownload = async () => {
        try {
            const blob = await api.downloadFile(
                ((file as any).folder_id ?? activeFolderId ?? 0) as number,
                file.id
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = file.name; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch { /* toast handled by caller */ }
    };

    const title =
        kind === 'office' ? 'Document' :
        kind === 'video' ? 'Video' :
        kind === 'audio' ? 'Audio' :
        kind === 'pdf' ? 'PDF' :
        kind === 'text' ? 'Text' :
        kind === 'image' ? 'Image' : 'File';

    return (
        <div className="fixed inset-0 z-[150] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="relative w-full max-w-6xl max-h-screen flex flex-col" onClick={e => e.stopPropagation()}>
                {/* top bar */}
                <div className="flex items-center gap-2 mb-2 px-1">
                    <div className="flex-1 min-w-0">
                        <h3 className="text-white font-medium truncate">{file.name}</h3>
                        <p className="text-xs text-white/50">
                            {title} preview
                            {typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 0 && (
                                <span className="ml-2">{currentIndex + 1}/{totalItems}</span>
                            )}
                            {kind === 'office' && <span className="ml-2 text-white/30">via Office viewer • link expires in 1 day</span>}
                        </p>
                    </div>
                    {onEdit && getEditKind(file.name) && !isEncrypted && (
                        <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-2 text-black bg-telegram-primary hover:bg-telegram-primary/90 rounded-full transition-colors text-xs font-bold" title="Edit in built-in editor">
                            <PenLine className="w-4 h-4" /> Edit
                        </button>
                    )}
                    <button onClick={handleDownload} className="p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors" title="Download">
                        <Download className="w-5 h-5" />
                    </button>
                    {frameSrc && (
                        <a href={frameSrc} target="_blank" rel="noopener noreferrer" className="p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors" title="Open in new tab">
                            <ExternalLink className="w-5 h-5" />
                        </a>
                    )}
                    <button onClick={onClose} className="p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors" title="Close (Esc)">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* frame */}
                <div className="relative w-full h-[75vh] bg-white rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#1c1c1c] text-white z-10">
                            <div className="w-10 h-10 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
                            <p>Loading preview...</p>
                            <p className="text-xs text-white/50">{kind === 'office' ? 'Creating secure link...' : 'Downloading from Telegram...'}</p>
                        </div>
                    )}
                    {error && !loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1c1c1c] text-center p-8 z-10">
                            {isEncrypted ? <Lock className="w-12 h-12 text-telegram-primary" /> : <FileWarning className="w-12 h-12 text-yellow-500" />}
                            <p className="text-white font-medium">{error}</p>
                            <p className="text-xs text-white/50">File type: {file.name.split('.').pop()}</p>
                            <button onClick={handleDownload} className="mt-2 px-5 py-2 bg-telegram-primary text-white rounded-xl text-sm font-bold flex items-center gap-2">
                                <Download className="w-4 h-4" /> Download instead
                            </button>
                        </div>
                    )}
                    {frameSrc && !error && (
                        <iframe
                            key={`${file.id}-${activeFolderId}`}
                            src={frameSrc}
                            title={file.name}
                            className="w-full h-full border-0 bg-white"
                            allow="fullscreen"
                            onLoad={() => setLoading(false)}
                        />
                    )}
                    {/* prev / next */}
                    <button onClick={onPrev} className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-all" title="Previous">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={onNext} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-all" title="Next">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
