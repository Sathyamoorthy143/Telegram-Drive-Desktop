import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Presentation } from 'lucide-react';
import { TelegramFile } from '../../../types';
import { loadPreviewBlob } from './previewSource';
import { PreviewError, PreviewSpinner, sanitizeHtml } from './shared';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB cap for in-browser parsing

export type OfficeVariant = 'doc' | 'sheet' | 'slide';

interface OfficePreviewProps {
    file: TelegramFile;
    activeFolderId: number | null;
    variant: OfficeVariant;
}

interface SheetData {
    name: string;
    html: string;
}

interface SlideData {
    paragraphs: string[];
    images: string[]; // object URLs
}

type LoadState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; html?: string; text?: string; sheets?: SheetData[]; slides?: SlideData[] };

/** Crude but effective RTF → plain text (strips control words & groups). */
function rtfToText(rtf: string): string {
    return rtf
        .replace(/\\par[d]?/g, '\n')
        .replace(/\\tab/g, '\t')
        .replace(/\\'[0-9a-fA-F]{2}/g, '')
        .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
        .replace(/[{}]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Extract slide text + images from a .pptx (it's just a zip of XML). */
async function parsePptx(buf: ArrayBuffer, objectUrls: string[]): Promise<SlideData[]> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const slideNames = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => parseInt(a.match(/slide(\d+)\.xml/)![1], 10) - parseInt(b.match(/slide(\d+)\.xml/)![1], 10));

    const slides: SlideData[] = [];
    for (const name of slideNames) {
        const entry = zip.file(name);
        if (!entry) continue;
        const doc = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');

        const paragraphs: string[] = [];
        Array.from(doc.getElementsByTagNameNS('*', 'p')).forEach((p) => {
            const text = Array.from(p.getElementsByTagNameNS('*', 't'))
                .map((n) => n.textContent || '')
                .join('');
            if (text.trim()) paragraphs.push(text);
        });

        const images: string[] = [];
        const slideNum = name.match(/slide(\d+)\.xml/)![1];
        const relsEntry = zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`);
        const blips = Array.from(doc.getElementsByTagNameNS('*', 'blip'));
        if (relsEntry && blips.length > 0) {
            const relsDoc = new DOMParser().parseFromString(await relsEntry.async('text'), 'application/xml');
            const rels = new Map<string, string>();
            Array.from(relsDoc.getElementsByTagName('Relationship')).forEach((r) => {
                rels.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '');
            });
            for (const blip of blips) {
                const rid =
                    blip.getAttribute('r:embed') ||
                    blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
                const target = rid ? rels.get(rid) : undefined;
                if (!target) continue;
                const mediaEntry = zip.file(target.replace(/^\.\.\//, 'ppt/'));
                if (!mediaEntry) continue;
                const blob = await mediaEntry.async('blob');
                const url = URL.createObjectURL(blob);
                objectUrls.push(url);
                images.push(url);
            }
        }
        slides.push({ paragraphs, images });
    }
    return slides;
}

/**
 * Fully client-side Office preview — no external viewer service, works
 * offline in the desktop app:
 *  - docx → HTML via mammoth (rtf → plain text)
 *  - xlsx / xls / ods / csv → HTML tables via SheetJS, with sheet tabs
 *  - pptx → slide text + images extracted from the OOXML zip
 */
export function OfficePreview({ file, activeFolderId, variant }: OfficePreviewProps) {
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [activeSheet, setActiveSheet] = useState(0);
    const [activeSlide, setActiveSlide] = useState(0);
    const objectUrlsRef = useRef<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        setState({ status: 'loading' });
        setActiveSheet(0);
        setActiveSlide(0);

        const load = async () => {
            try {
                const blob = await loadPreviewBlob(file.id, (file as any).folder_id ?? activeFolderId);
                if (cancelled) return;
                if (blob.size > MAX_BYTES) {
                    setState({ status: 'error', message: 'File too large to preview in app (>25MB). Download it instead.' });
                    return;
                }
                const buf = await blob.arrayBuffer();
                const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';

                if (variant === 'doc') {
                    if (ext === 'docx') {
                        const mammoth = await import('mammoth');
                        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
                        if (!cancelled) setState({ status: 'ready', html: sanitizeHtml(result.value) });
                    } else if (ext === 'rtf') {
                        const text = rtfToText(await blob.text());
                        if (!cancelled) setState({ status: 'ready', text });
                    } else if (!cancelled) {
                        setState({ status: 'error', message: `Legacy .${ext} files can't be previewed in the app.` });
                    }
                    return;
                }

                if (variant === 'sheet') {
                    const XLSX = await import('xlsx');
                    const wb = XLSX.read(buf, { type: 'array' });
                    const sheets: SheetData[] = wb.SheetNames.map((name) => ({
                        name,
                        html: sanitizeHtml(XLSX.utils.sheet_to_html(wb.Sheets[name])),
                    }));
                    if (!cancelled) {
                        if (sheets.length === 0) setState({ status: 'error', message: 'This spreadsheet has no sheets.' });
                        else setState({ status: 'ready', sheets });
                    }
                    return;
                }

                // slide
                if (ext === 'pptx') {
                    const slides = await parsePptx(buf, objectUrlsRef.current);
                    if (!cancelled) {
                        if (slides.length === 0) setState({ status: 'error', message: 'No slides found in this presentation.' });
                        else setState({ status: 'ready', slides });
                    }
                } else if (!cancelled) {
                    setState({ status: 'error', message: `Legacy .${ext} files can't be previewed in the app.` });
                }
            } catch (e: any) {
                if (!cancelled) setState({ status: 'error', message: e?.message || 'Failed to render preview' });
            }
        };
        load();
        return () => { cancelled = true; };
    }, [file.id, activeFolderId, variant, (file as any).folder_id, file.name]);

    // Revoke slide image object URLs on unmount / file change
    useEffect(() => {
        const urls = objectUrlsRef.current;
        return () => {
            urls.forEach((u) => URL.revokeObjectURL(u));
            urls.length = 0;
        };
    }, [file.id]);

    if (state.status === 'loading') return <PreviewSpinner label="Parsing document locally..." />;
    if (state.status === 'error') {
        return <PreviewError message={state.message} detail="Use the download button to open it in a desktop app." />;
    }

    // ---- DOC (html or plain text) ----
    if (state.html !== undefined) {
        return (
            <div className="absolute inset-0 overflow-auto bg-zinc-100 p-4 sm:p-8">
                <div
                    className="office-doc max-w-3xl mx-auto bg-white shadow-xl rounded-lg p-8 sm:p-12 text-zinc-900 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: state.html }}
                />
            </div>
        );
    }
    if (state.text !== undefined) {
        return (
            <div className="absolute inset-0 overflow-auto bg-zinc-100 p-4 sm:p-8">
                <pre className="max-w-3xl mx-auto bg-white shadow-xl rounded-lg p-8 sm:p-12 text-zinc-900 whitespace-pre-wrap font-sans leading-relaxed">
                    {state.text}
                </pre>
            </div>
        );
    }

    // ---- SHEET ----
    if (state.sheets) {
        const sheet = state.sheets[Math.min(activeSheet, state.sheets.length - 1)];
        return (
            <div className="absolute inset-0 flex flex-col bg-zinc-100 overflow-hidden">
                {state.sheets.length > 1 && (
                    <div className="flex gap-1 px-3 pt-2 pb-0 overflow-x-auto shrink-0">
                        {state.sheets.map((s, i) => (
                            <button
                                key={s.name}
                                onClick={() => setActiveSheet(i)}
                                className={`px-3 py-1.5 rounded-t-lg text-xs font-semibold whitespace-nowrap transition-colors ${i === activeSheet ? 'bg-white text-blue-900 shadow' : 'bg-white/50 text-zinc-500 hover:bg-white/80'}`}
                            >
                                {s.name}
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex-1 overflow-auto m-3 mt-2 bg-white rounded-lg shadow-xl">
                    <div className="office-sheet" dangerouslySetInnerHTML={{ __html: sheet.html }} />
                </div>
            </div>
        );
    }

    // ---- SLIDES ----
    if (state.slides) {
        const slide = state.slides[Math.min(activeSlide, state.slides.length - 1)];
        return (
            <div className="absolute inset-0 flex flex-col bg-[#16161a] overflow-hidden">
                <div className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8">
                    <div className="w-full max-w-4xl bg-white rounded-xl shadow-2xl aspect-video overflow-auto p-8 sm:p-12">
                        {slide.paragraphs.map((p, i) => (
                            <p key={i} className={`text-zinc-900 ${i === 0 ? 'text-2xl font-bold mb-4' : 'text-lg mb-2'}`}>
                                {p}
                            </p>
                        ))}
                        {slide.images.length > 0 && (
                            <div className="flex flex-wrap gap-4 mt-4">
                                {slide.images.map((src, i) => (
                                    <img key={i} src={src} alt="" className="max-h-56 rounded shadow object-contain" />
                                ))}
                            </div>
                        )}
                        {slide.paragraphs.length === 0 && slide.images.length === 0 && (
                            <div className="h-full flex items-center justify-center text-zinc-400">
                                <Presentation className="w-10 h-10 mr-2" /> (Empty slide)
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center justify-center gap-4 py-3 shrink-0">
                    <button
                        onClick={() => setActiveSlide((s) => Math.max(0, s - 1))}
                        disabled={activeSlide === 0}
                        className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="text-white/70 text-sm font-medium">
                        Slide {activeSlide + 1} / {state.slides.length}
                    </span>
                    <button
                        onClick={() => setActiveSlide((s) => Math.min(state.slides!.length - 1, s + 1))}
                        disabled={activeSlide >= state.slides.length - 1}
                        className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 transition-colors"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
