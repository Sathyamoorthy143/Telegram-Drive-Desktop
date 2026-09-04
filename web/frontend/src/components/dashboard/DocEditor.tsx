import { useEffect, useState } from 'react';
import { X, Save, FileText, Bold, Italic, Strikethrough, List, ListOrdered, Heading1, Heading2, Undo2, Redo2, Quote, Code } from 'lucide-react';
import { toast } from 'sonner';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import * as api from '../../api';
import { TelegramFile } from '../../types';
import { isTextFile } from '../../utils';

interface DocEditorProps {
    file: TelegramFile;
    activeFolderId: number | null;
    onClose: () => void;
    onSaved: () => void;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function DocEditor({ file, activeFolderId, onClose, onSaved }: DocEditorProps) {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [initialHtml, setInitialHtml] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const isText = isTextFile(file.name);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const blob = await api.downloadFile(
                    ((file as any).folder_id ?? activeFolderId ?? 0) as number,
                    file.id
                );
                if (cancelled) return;
                if (blob.size > 10 * 1024 * 1024) {
                    setLoadError('File too large to edit in browser (>10MB). Please download it.');
                    setLoading(false);
                    return;
                }
                if (isText) {
                    const text = await blob.text();
                    const html = text.split(/\r?\n/).map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
                    setInitialHtml(html || '<p></p>');
                } else {
                    const buf = await blob.arrayBuffer();
                    const mammoth = await import('mammoth');
                    const result = await mammoth.convertToHtml({ arrayBuffer: buf });
                    if (cancelled) return;
                    setInitialHtml(result.value || '<p></p>');
                    if (result.messages?.length) console.debug('mammoth messages', result.messages);
                }
                setLoading(false);
            } catch (e: any) {
                if (!cancelled) {
                    setLoadError(e?.message || 'Failed to open document');
                    setLoading(false);
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    const editor = useEditor(
        {
            extensions: [StarterKit, Image],
            content: initialHtml,
            editable: true,
            editorProps: {
                attributes: {
                    class: 'tiptap-doc outline-none min-h-[50vh] px-6 py-5 text-[15px] leading-7 text-telegram-text',
                },
            },
        },
        [initialHtml]
    );

    const handleSave = async () => {
        if (!editor) return;
        setSaving(true);
        try {
            let upFile: File;
            if (isText) {
                const text = editor.getText({ blockSeparator: '\n' });
                upFile = new File([text], file.name, { type: 'text/plain' });
            } else {
                // TipTap JSON -> real .docx (browser-safe, no Node polyfills needed)
                const { tiptapJsonToDocxBlob } = await import('../../lib/tiptapToDocx');
                const blob = await tiptapJsonToDocxBlob(editor.getJSON());
                upFile = new File([blob], file.name, {
                    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                });
            }
            await api.uploadFile(upFile, (file as any).folder_id ?? activeFolderId ?? undefined);
            try { await api.recordVersion(file.id, (file as any).folder_id ?? activeFolderId ?? undefined); } catch {}
            try { await api.deleteFile(file.id, (file as any).folder_id ?? activeFolderId ?? undefined); } catch {}
            api.logActivity('edit-save', file.id, `doc:${file.name}`).catch(() => {});
            toast.success(`Saved ${file.name} (old version moved to Trash)`);
            onSaved();
            onClose();
        } catch (e: any) {
            toast.error(`Save failed: ${e?.message || 'error'}`);
        } finally {
            setSaving(false);
        }
    };

    const btn = 'p-2 rounded-lg hover:bg-white/10 text-telegram-subtext hover:text-telegram-text transition-colors disabled:opacity-30';
    const activeBtn = 'p-2 rounded-lg bg-telegram-primary/20 text-telegram-primary transition-colors';

    return (
        <div className="fixed inset-0 z-[160] bg-black/90 backdrop-blur-sm flex items-center justify-center p-2 md:p-4" onClick={onClose}>
            <div className="w-full max-w-4xl h-[92vh] bg-telegram-surface border border-telegram-border rounded-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-telegram-border">
                    <FileText className="w-5 h-5 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-telegram-text truncate">{file.name}</h3>
                        <p className="text-[10px] text-telegram-subtext">In-built document editor • complex layouts may simplify on round-trip</p>
                    </div>
                    <button onClick={handleSave} disabled={saving || loading || !!loadError} className="flex items-center gap-2 px-4 py-2 bg-telegram-primary text-white rounded-xl text-xs font-bold disabled:opacity-50">
                        <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X className="w-5 h-5 text-telegram-subtext" /></button>
                </div>

                {editor && !loading && !loadError && (
                    <div className="flex items-center gap-1 px-3 py-2 border-b border-telegram-border overflow-x-auto">
                        <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? activeBtn : btn} title="Bold"><Bold className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? activeBtn : btn} title="Italic"><Italic className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive('strike') ? activeBtn : btn} title="Strikethrough"><Strikethrough className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? activeBtn : btn} title="Heading 1"><Heading1 className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? activeBtn : btn} title="Heading 2"><Heading2 className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? activeBtn : btn} title="Bullet list"><List className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? activeBtn : btn} title="Numbered list"><ListOrdered className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive('blockquote') ? activeBtn : btn} title="Quote"><Quote className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? activeBtn : btn} title="Code block"><Code className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className={btn} title="Undo"><Undo2 className="w-4 h-4" /></button>
                        <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className={btn} title="Redo"><Redo2 className="w-4 h-4" /></button>
                    </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto bg-white/[0.02]">
                    {loading || loadError ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                            {loadError ? (
                                <>
                                    <p className="text-red-400 text-sm font-medium">{loadError}</p>
                                    <button onClick={onClose} className="px-4 py-2 bg-white/10 rounded-xl text-xs">Close</button>
                                </>
                            ) : (
                                <>
                                    <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
                                    <p className="text-sm text-telegram-subtext">Opening document...</p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="max-w-3xl mx-auto my-4 bg-white rounded-lg shadow-xl">
                            <EditorContent editor={editor} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
