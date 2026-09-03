import { useEffect, useRef, useState } from 'react';
import { X, Save, Sheet as SheetIcon } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '../../api';
import { TelegramFile } from '../../types';

interface SheetEditorProps {
    file: TelegramFile;
    activeFolderId: number | null;
    onClose: () => void;
    onSaved: () => void;
}

export function SheetEditor({ file, activeFolderId, onClose, onSaved }: SheetEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const univerRef = useRef<any>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!containerRef.current || univerRef.current) return;
        let disposed = false;

        async function init() {
            try {
                // 1. download + parse xlsx
                const blob = await api.downloadFile(
                    ((file as any).folder_id ?? activeFolderId ?? 0) as number,
                    file.id
                );
                if (disposed) return;
                if (blob.size > 15 * 1024 * 1024) {
                    setLoadError('File too large to edit in browser (>15MB). Please download it.');
                    setLoading(false);
                    return;
                }
                const buf = await blob.arrayBuffer();
                const XLSX = await import('xlsx');
                if (disposed) return;
                const wb = XLSX.read(buf, { type: 'array' });

                // 2. xlsx -> Univer snapshot (values + formulas)
                const sheets: Record<string, any> = {};
                wb.SheetNames.forEach((name: string, i: number) => {
                    const ws = wb.Sheets[name];
                    const cellData: Record<number, Record<number, any>> = {};
                    let maxR = 19, maxC = 9;
                    if (ws['!ref']) {
                        const range = XLSX.utils.decode_range(ws['!ref']);
                        maxR = Math.max(range.e.r, 19);
                        maxC = Math.max(range.e.c, 9);
                        for (let r = range.s.r; r <= range.e.r; r++) {
                            for (let c = range.s.c; c <= range.e.c; c++) {
                                const cell = ws[XLSX.utils.encode_cell({ r, c })];
                                if (!cell || (cell.v === undefined && !cell.f)) continue;
                                const out: any = {};
                                if (cell.f) out.f = '=' + cell.f;
                                if (cell.v !== undefined) out.v = cell.v;
                                if (!cellData[r]) cellData[r] = {};
                                cellData[r][c] = out;
                            }
                        }
                    }
                    const sid = `sheet${i}`;
                    sheets[sid] = {
                        id: sid,
                        name: name.slice(0, 31),
                        cellData,
                        rowCount: maxR + 1,
                        columnCount: maxC + 1,
                    };
                });

                // 3. init Univer (same pattern as trust-crm Spreadsheet page)
                const { createUniver, LocaleType, mergeLocales } = await import('@univerjs/presets');
                const { UniverSheetsCorePreset } = await import('@univerjs/preset-sheets-core');
                const UniverPresetSheetsCoreEnUS = (await import('@univerjs/preset-sheets-core/locales/en-US')).default;
                await import('@univerjs/preset-sheets-core/lib/index.css');
                if (disposed || !containerRef.current) return;

                const { univerAPI } = createUniver({
                    locale: LocaleType.EN_US,
                    locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
                    presets: [UniverSheetsCorePreset({ container: containerRef.current })],
                });
                univerAPI.createWorkbook({
                    id: 'wb1',
                    name: file.name,
                    sheets,
                } as any);
                univerRef.current = univerAPI;
                setLoading(false);
            } catch (e: any) {
                if (!disposed) {
                    setLoadError(e?.message || 'Failed to open spreadsheet');
                    setLoading(false);
                }
            }
        }
        init();
        return () => {
            disposed = true;
            if (univerRef.current) {
                try { univerRef.current.dispose(); } catch {}
                univerRef.current = null;
            }
        };
    }, []);

    const handleSave = async () => {
        const api0 = univerRef.current?.getActiveWorkbook?.();
        if (!api0) { toast.error('Editor not ready'); return; }
        setSaving(true);
        try {
            const snapshot = api0.save();
            const XLSX = await import('xlsx');
            const out = XLSX.utils.book_new();
            const sheets = snapshot.sheets || {};
            for (const sid of Object.keys(sheets)) {
                const sh = sheets[sid];
                const ws: any = {};
                const cellData = sh.cellData || {};
                let maxR = -1, maxC = -1;
                for (const rk of Object.keys(cellData)) {
                    const r = parseInt(rk);
                    if (isNaN(r)) continue;
                    maxR = Math.max(maxR, r);
                    for (const ck of Object.keys(cellData[rk] || {})) {
                        const c = parseInt(ck);
                        if (isNaN(c)) continue;
                        maxC = Math.max(maxC, c);
                        const cell = cellData[rk][ck];
                        const addr = XLSX.utils.encode_cell({ r, c });
                        if (cell?.f) {
                            ws[addr] = { f: String(cell.f).replace(/^=/, ''), v: cell.v ?? 0 };
                        } else if (cell?.v !== undefined) {
                            const v = cell.v;
                            ws[addr] = { v, t: typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's' };
                        }
                    }
                }
                if (maxR >= 0 && maxC >= 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
                XLSX.utils.book_append_sheet(out, ws, (sh.name || sid).slice(0, 31));
            }
            const u8 = XLSX.write(out, { bookType: 'xlsx', type: 'array' }) as Uint8Array;
            const upFile = new File([u8 as any], file.name, {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            await api.uploadFile(upFile, (file as any).folder_id ?? activeFolderId ?? undefined);
            // move old version to Trash (soft delete), keep history recoverable
            try { await api.recordVersion((file as any).folder_id ?? activeFolderId ?? undefined, file.name, file.id, (file as any).size); } catch {}
            try { await api.deleteFile(file.id, (file as any).folder_id ?? activeFolderId ?? undefined); } catch {}
            api.logActivity('edit-save', `sheet:${file.name}`, file.name).catch(() => {});
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
                    <SheetIcon className="w-5 h-5 text-green-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-telegram-text truncate">{file.name}</h3>
                        <p className="text-[10px] text-telegram-subtext">In-built spreadsheet editor • values + formulas saved back to Drive</p>
                    </div>
                    <button onClick={handleSave} disabled={saving || loading || !!loadError} className="flex items-center gap-2 px-4 py-2 bg-telegram-primary text-white rounded-xl text-xs font-bold disabled:opacity-50">
                        <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X className="w-5 h-5 text-telegram-subtext" /></button>
                </div>
                <div className="flex-1 min-h-0 relative">
                    {(loading || loadError) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-telegram-surface z-10 p-6 text-center">
                            {loadError ? (
                                <>
                                    <p className="text-red-400 text-sm font-medium">{loadError}</p>
                                    <button onClick={onClose} className="px-4 py-2 bg-white/10 rounded-xl text-xs">Close</button>
                                </>
                            ) : (
                                <>
                                    <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
                                    <p className="text-sm text-telegram-subtext">Opening spreadsheet...</p>
                                </>
                            )}
                        </div>
                    )}
                    <div ref={containerRef} className="w-full h-full" />
                </div>
            </div>
        </div>
    );
}
