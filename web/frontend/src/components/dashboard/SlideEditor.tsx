import { useEffect, useState } from 'react';
import { X, Save, Presentation, Plus, Trash2, ChevronUp, ChevronDown, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '../../api';
import { TelegramFile } from '../../types';

interface SlideEditorProps {
    file: TelegramFile;
    activeFolderId: number | null;
    onClose: () => void;
    onSaved: () => void;
}

interface EditSlide {
    title: string;
    bullets: string; // newline-separated
    images: string[]; // data URLs
}

function textsOfShape(shape: Element): string[] {
    const out: string[] = [];
    const runs = shape.getElementsByTagNameNS('*', 't');
    for (let i = 0; i < runs.length; i++) {
        const t = runs[i].textContent ?? '';
        if (t) out.push(t);
    }
    return out;
}

export function SlideEditor({ file, activeFolderId, onClose, onSaved }: SlideEditorProps) {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [slides, setSlides] = useState<EditSlide[]>([]);
    const [active, setActive] = useState(0);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const blob = await api.downloadFile(
                    ((file as any).folder_id ?? activeFolderId ?? 0) as number,
                    file.id
                );
                if (cancelled) return;
                if (blob.size > 25 * 1024 * 1024) {
                    setLoadError('File too large to edit in browser (>25MB). Please download it.');
                    setLoading(false);
                    return;
                }
                const buf = await blob.arrayBuffer();
                const JSZip = (await import('jszip')).default;
                const zip = await JSZip.loadAsync(buf);
                if (cancelled) return;
                if (!zip.file('ppt/presentation.xml')) {
                    setLoadError('Not a valid .pptx file (legacy .ppt is not supported — convert to .pptx first).');
                    setLoading(false);
                    return;
                }
                const parser = new DOMParser();
                const parsed: EditSlide[] = [];
                for (let i = 1; i <= 500; i++) {
                    const slideFile = zip.file(`ppt/slides/slide${i}.xml`);
                    if (!slideFile) break;
                    const xmlText = await slideFile.async('text');
                    const doc = parser.parseFromString(xmlText, 'application/xml');
                    // group texts per shape: first shape = title, rest = bullets
                    const shapes = doc.getElementsByTagNameNS('*', 'sp');
                    const shapeTexts: string[][] = [];
                    for (let s = 0; s < shapes.length; s++) {
                        const t = textsOfShape(shapes[s]).join('');
                        if (t.trim()) shapeTexts.push(textsOfShape(shapes[s]));
                    }
                    const flat = shapeTexts.map(parts => parts.join(''));
                    const title = flat[0] ?? '';
                    const bullets = flat.slice(1).join('\n');
                    // images referenced by this slide
                    const images: string[] = [];
                    const relsFile = zip.file(`ppt/slides/_rels/slide${i}.xml.rels`);
                    if (relsFile) {
                        const relsText = await relsFile.async('text');
                        const relsDoc = parser.parseFromString(relsText, 'application/xml');
                        const rels = relsDoc.getElementsByTagNameNS('*', 'Relationship');
                        for (let r = 0; r < rels.length; r++) {
                            const type = rels[r].getAttribute('Type') || '';
                            const target = rels[r].getAttribute('Target') || '';
                            if (!type.includes('/image') || !target) continue;
                            const mediaPath = ('ppt/slides/' + target).replace(/\/\.\.\//g, '/').replace('ppt/slides/../', 'ppt/');
                            const mediaFile = zip.file(mediaPath) || zip.file(`ppt/${target.replace(/^\.\.\//, '')}`);
                            if (!mediaFile) continue;
                            const b64 = await mediaFile.async('base64');
                            const ext = (mediaPath.split('.').pop() || 'png').toLowerCase();
                            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'image/png';
                            images.push(`data:${mime};base64,${b64}`);
                            if (images.length >= 4) break;
                        }
                    }
                    parsed.push({ title, bullets, images });
                }
                if (cancelled) return;
                if (parsed.length === 0) {
                    setLoadError('No slides found in this presentation.');
                    setLoading(false);
                    return;
                }
                setSlides(parsed);
                setLoading(false);
            } catch (e: any) {
                if (!cancelled) {
                    setLoadError(e?.message || 'Failed to open presentation');
                    setLoading(false);
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    const cur = slides[active];
    const setCur = (patch: Partial<EditSlide>) => {
        setSlides(prev => prev.map((s, i) => (i === active ? { ...s, ...patch } : s)));
    };

    const handleSave = async () => {
        if (slides.length === 0) return;
        setSaving(true);
        try {
            const PptxGenJS = (await import('pptxgenjs')).default;
            const pres: any = new (PptxGenJS as any)();
            pres.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
            pres.layout = 'WIDE';
            for (const s of slides) {
                const slide = pres.addSlide();
                if (s.title.trim()) {
                    slide.addText(s.title, { x: 0.5, y: 0.3, w: 12.33, h: 1.1, fontSize: 28, bold: true });
                }
                const lines = s.bullets.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                if (lines.length > 0) {
                    slide.addText(
                        lines.map(t => ({ text: t, options: { bullet: { code: '2022' }, fontSize: 18 } })),
                        { x: 0.7, y: 1.7, w: 11.9, h: 4.6, valign: 'top' }
                    );
                }
                let imgY = 1.7;
                for (const img of s.images.slice(0, 2)) {
                    try {
                        slide.addImage({ data: img, x: 8.8, y: imgY, w: 4.0, h: 2.4 });
                        imgY += 2.6;
                    } catch {}
                }
            }
            const out = await pres.write({ outputType: 'arraybuffer' });
            const upFile = new File([out], file.name, {
                type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            });
            await api.uploadFile(upFile, (file as any).folder_id ?? activeFolderId ?? undefined);
            try { await api.recordVersion(file.id, (file as any).folder_id ?? activeFolderId ?? undefined); } catch {}
            try { await api.deleteFile(file.id, (file as any).folder_id ?? activeFolderId ?? undefined); } catch {}
            api.logActivity('edit-save', file.id, `slide:${file.name}`).catch(() => {});
            toast.success(`Saved ${file.name} (old version moved to Trash)`);
            onSaved();
            onClose();
        } catch (e: any) {
            toast.error(`Save failed: ${e?.message || 'error'}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[160] bg-black/90 backdrop-blur-sm flex items-center justify-center p-2 md:p-4" onClick={onClose}>
            <div className="w-full max-w-6xl h-[92vh] bg-telegram-surface border border-telegram-border rounded-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-telegram-border">
                    <Presentation className="w-5 h-5 text-orange-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-telegram-text truncate">{file.name}</h3>
                        <p className="text-[10px] text-telegram-subtext">In-built slide editor • text + images round-trip (layouts/animations simplify)</p>
                    </div>
                    <button onClick={handleSave} disabled={saving || loading || !!loadError} className="flex items-center gap-2 px-4 py-2 bg-telegram-primary text-white rounded-xl text-xs font-bold disabled:opacity-50">
                        <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X className="w-5 h-5 text-telegram-subtext" /></button>
                </div>

                {loading || loadError ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                        {loadError ? (
                            <>
                                <p className="text-red-400 text-sm font-medium">{loadError}</p>
                                <button onClick={onClose} className="px-4 py-2 bg-white/10 rounded-xl text-xs">Close</button>
                            </>
                        ) : (
                            <>
                                <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
                                <p className="text-sm text-telegram-subtext">Opening presentation...</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 flex">
                        {/* slide list */}
                        <div className="w-36 md:w-48 shrink-0 border-r border-telegram-border overflow-y-auto p-2 space-y-2">
                            {slides.map((s, i) => (
                                <button key={i} onClick={() => setActive(i)} className={`w-full text-left p-2 rounded-xl border transition-colors ${i === active ? 'border-telegram-primary bg-telegram-primary/10' : 'border-telegram-border hover:bg-white/5'}`}>
                                    <p className="text-[10px] font-bold text-telegram-subtext mb-1">Slide {i + 1}</p>
                                    <p className="text-xs font-semibold text-telegram-text truncate">{s.title || '(no title)'}</p>
                                    <p className="text-[10px] text-telegram-subtext truncate">{s.bullets.split('\n')[0] || ''}</p>
                                </button>
                            ))}
                            <button onClick={() => { setSlides([...slides, { title: '', bullets: '', images: [] }]); setActive(slides.length); }} className="w-full p-2 rounded-xl border border-dashed border-telegram-border text-telegram-subtext hover:text-telegram-primary text-xs flex items-center justify-center gap-1">
                                <Plus className="w-3 h-3" /> Add slide
                            </button>
                        </div>
                        {/* editor */}
                        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-3">
                            {cur && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <button disabled={active === 0} onClick={() => { const n = [...slides]; [n[active - 1], n[active]] = [n[active], n[active - 1]]; setSlides(n); setActive(active - 1); }} className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                                        <button disabled={active === slides.length - 1} onClick={() => { const n = [...slides]; [n[active + 1], n[active]] = [n[active], n[active + 1]]; setSlides(n); setActive(active + 1); }} className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                                        <button onClick={() => { if (slides.length <= 1) { toast.error('A presentation needs at least 1 slide'); return; } setSlides(slides.filter((_, i) => i !== active)); setActive(Math.max(0, active - 1)); }} className="p-1.5 hover:bg-red-500/10 rounded-lg text-red-400 ml-auto flex items-center gap-1 text-xs"><Trash2 className="w-4 h-4" /> Delete slide</button>
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold">Title</label>
                                        <input value={cur.title} onChange={e => setCur({ title: e.target.value })} placeholder="Slide title" className="mt-1 w-full bg-black/20 border border-telegram-border rounded-xl px-3 py-2.5 text-lg font-bold text-telegram-text focus:outline-none focus:ring-2 focus:ring-telegram-primary/50" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold">Bullets (one per line)</label>
                                        <textarea value={cur.bullets} onChange={e => setCur({ bullets: e.target.value })} rows={8} placeholder={'Point one\nPoint two'} className="mt-1 w-full bg-black/20 border border-telegram-border rounded-xl px-3 py-2.5 text-sm text-telegram-text focus:outline-none focus:ring-2 focus:ring-telegram-primary/50" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold">Images ({cur.images.length})</label>
                                        <div className="mt-1 flex flex-wrap gap-2">
                                            {cur.images.map((img, i) => (
                                                <div key={i} className="relative w-24 h-16 rounded-lg overflow-hidden border border-telegram-border">
                                                    <img src={img} alt="" className="w-full h-full object-cover" />
                                                    <button onClick={() => setCur({ images: cur.images.filter((_, j) => j !== i) })} className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 rounded-full"><X className="w-3 h-3 text-white" /></button>
                                                </div>
                                            ))}
                                            <label className="w-24 h-16 rounded-lg border border-dashed border-telegram-border flex flex-col items-center justify-center text-telegram-subtext cursor-pointer hover:text-telegram-primary text-[10px] gap-1">
                                                <ImagePlus className="w-4 h-4" /> Add
                                                <input type="file" accept="image/*" className="hidden" onChange={e => {
                                                    const f = e.target.files?.[0];
                                                    if (!f) return;
                                                    const r = new FileReader();
                                                    r.onload = () => setCur({ images: [...cur.images, String(r.result)] });
                                                    r.readAsDataURL(f);
                                                }} />
                                            </label>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
