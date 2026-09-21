import { useEffect, useState } from 'react';
import { WrapText } from 'lucide-react';
import * as api from '../../../api';
import { TelegramFile } from '../../../types';
import { PreviewError, PreviewSpinner } from './shared';

const MAX_PREVIEW_BYTES = 256 * 1024; // first 256KB via Range — instant previews
const MAX_LINES = 10_000;

interface TextPreviewProps {
    file: TelegramFile;
    activeFolderId: number | null;
}

/** Client-side text/code preview: line numbers, mono font, wrap toggle. */
export function TextPreview({ file, activeFolderId }: TextPreviewProps) {
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [wrap, setWrap] = useState(true);
    const [byteTruncated, setByteTruncated] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setText(null);
        setError(null);
        setByteTruncated(false);

        api.fetchFileSlice(
            ((file as any).folder_id ?? activeFolderId ?? 0) as number,
            file.id,
            MAX_PREVIEW_BYTES,
        )
            .then(({ text: content, truncated }) => {
                if (cancelled) return;
                setText(content);
                setByteTruncated(truncated);
            })
            .catch((e) => {
                if (!cancelled) setError(e?.message || 'Failed to load file');
            });

        return () => { cancelled = true; };
    }, [file.id, activeFolderId, (file as any).folder_id]);

    if (error) return <PreviewError message={error} />;
    if (text === null) return <PreviewSpinner label="Downloading from Telegram..." />;

    const allLines = text.split('\n');
    const lineCapped = allLines.length > MAX_LINES;
    const lines = lineCapped ? allLines.slice(0, MAX_LINES) : allLines;
    const sizeLabel = Math.round(MAX_PREVIEW_BYTES / 1024);

    return (
        <div className="absolute inset-0 flex flex-col bg-[#0d1117] overflow-hidden">
            <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-white/10 shrink-0">
                {byteTruncated && (
                    <span className="text-xs text-yellow-500 mr-auto" title="Preview streams only the first part of the file">
                        Showing first {sizeLabel} KB — download the file to see everything
                    </span>
                )}
                {lineCapped && (
                    <span className="text-xs text-yellow-500">
                        {byteTruncated ? '· ' : ''}capped at {MAX_LINES.toLocaleString()} lines
                    </span>
                )}
                <button
                    onClick={() => setWrap((w) => !w)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${wrap ? 'bg-telegram-primary text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                    title="Toggle word wrap"
                >
                    <WrapText className="w-3.5 h-3.5" /> Wrap
                </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
                <div className="font-mono text-xs leading-5 text-gray-200 min-w-max">
                    {lines.map((line, i) => (
                        <div key={i} className="flex hover:bg-white/5">
                            <span className="w-12 shrink-0 text-right pr-4 text-white/25 select-none">{i + 1}</span>
                            <span className={wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}>
                                {line || ' '}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
