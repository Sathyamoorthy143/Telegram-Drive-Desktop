// TipTap JSON -> docx (browser-safe, uses the `docx` package).
// Supports: paragraphs, headings, bold/italic/strike/underline, bullet +
// ordered lists, blockquotes, code blocks, tables, images, horizontal rules.
import {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    LevelFormat, AlignmentType, Table, TableRow, TableCell, ImageRun,
    WidthType, ShadingType,
} from 'docx';

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
    const m = dataUrl.match(/^data:(image\/(png|jpe?g|gif|bmp));base64,(.+)$/);
    if (!m) return null;
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = m[2].toLowerCase();
    return { bytes, type: ext === 'jpg' || ext === 'jpeg' ? 'jpg' : (ext as any) };
}

function imageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, 600 / (img.naturalWidth || 600));
            resolve({ w: Math.round((img.naturalWidth || 600) * scale), h: Math.round((img.naturalHeight || 400) * scale) });
        };
        img.onerror = () => resolve({ w: 450, h: 300 });
        img.src = dataUrl;
    });
}

function inlineToRuns(content: any[] | undefined): TextRun[] {
    const runs: TextRun[] = [];
    for (const n of content || []) {
        if (n.type === 'text') {
            const marks = Object.fromEntries((n.marks || []).map((m: any) => [m.type, m.attrs || {}]));
            runs.push(
                new TextRun({
                    text: n.text || '',
                    bold: !!marks.bold,
                    italics: !!marks.italic,
                    strike: !!marks.strike,
                    underline: (marks.underline ? {} : undefined) as any,
                    font: marks.code ? 'Consolas' : undefined,
                    shading: marks.code ? { type: ShadingType.CLEAR, fill: 'F2F2F2' } : undefined,
                })
            );
        } else if (n.type === 'hardBreak') {
            runs.push(new TextRun({ break: 1 }));
        } else if (n.type === 'image' && n.attrs?.src?.startsWith('data:')) {
            // handled at block level; placeholder here
            runs.push(new TextRun({ text: '' }));
        }
    }
    return runs;
}

async function blockToDocx(node: any, listInstance: { n: number }): Promise<(Paragraph | Table)[]> {
    switch (node.type) {
        case 'paragraph':
            return [new Paragraph({ children: inlineToRuns(node.content) })];
        case 'heading': {
            const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
            const map: any = {
                1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
                4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
            };
            return [new Paragraph({ heading: map[level], children: inlineToRuns(node.content) })];
        }
        case 'bulletList': {
            const out: Paragraph[] = [];
            for (const item of node.content || []) {
                for (const b of item.content || []) {
                    if (b.type === 'paragraph') {
                        out.push(new Paragraph({ bullet: { level: 0 }, children: inlineToRuns(b.content) }));
                    } else {
                        for (const p of await blockToDocx(b, listInstance)) {
                            if (p instanceof Paragraph) out.push(p);
                        }
                    }
                }
            }
            return out;
        }
        case 'orderedList': {
            const out: Paragraph[] = [];
            const inst = listInstance.n++;
            for (const item of node.content || []) {
                for (const b of item.content || []) {
                    if (b.type === 'paragraph') {
                        out.push(
                            new Paragraph({
                                numbering: { reference: 'ordered', instance: inst, level: 0 },
                                children: inlineToRuns(b.content),
                            })
                        );
                    } else {
                        for (const p of await blockToDocx(b, listInstance)) {
                            if (p instanceof Paragraph) out.push(p);
                        }
                    }
                }
            }
            return out;
        }
        case 'blockquote': {
            const out: Paragraph[] = [];
            for (const b of node.content || []) {
                const nested = await blockToDocx(b, listInstance);
                if (nested.length === 0) continue;
                // re-emit as indented quote paragraphs (nested tables/lists flatten to text)
                if (b.type === 'paragraph' || b.type === 'heading') {
                    out.push(
                        new Paragraph({
                            children: inlineToRuns((b as any).content),
                            indent: { left: 720 },
                            shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
                        })
                    );
                } else {
                    for (const p of nested) {
                        if (p instanceof Paragraph) out.push(p);
                    }
                }
            }
            return out.length ? out : [new Paragraph({ children: [] })];
        }
        case 'codeBlock': {
            const text = (node.content || []).map((t: any) => t.text || '').join('\n');
            return text.split('\n').map(
                (line: string) => new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas' })], shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' } })
            );
        }
        case 'table': {
            const rows: TableRow[] = [];
            for (const tr of node.content || []) {
                const cells: TableCell[] = [];
                for (const tc of tr.content || []) {
                    const paras: Paragraph[] = [];
                    for (const b of tc.content || []) {
                        paras.push(...((await blockToDocx(b, listInstance)).filter(p => p instanceof Paragraph) as Paragraph[]));
                    }
                    cells.push(new TableCell({ children: paras.length ? paras : [new Paragraph({})] }));
                }
                rows.push(new TableRow({ children: cells }));
            }
            return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })];
        }
        case 'image': {
            const src = node.attrs?.src || '';
            const conv = dataUrlToBytes(src);
            if (!conv) return [];
            const { w, h } = await imageDimensions(src);
            return [
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: conv.bytes as any,
                            transformation: { width: w, height: h },
                            type: conv.type as any,
                        }),
                    ],
                }),
            ];
        }
        case 'horizontalRule':
            return [new Paragraph({ children: [], thematicBreak: true } as any)];
        default:
            return [];
    }
}

export async function tiptapJsonToDocxBlob(doc: any): Promise<Blob> {
    const children: (Paragraph | Table)[] = [];
    const listInstance = { n: 0 };
    for (const node of doc?.content || []) {
        children.push(...(await blockToDocx(node, listInstance)));
    }
    if (children.length === 0) children.push(new Paragraph({ children: [] }));
    const document = new Document({
        numbering: {
            config: [
                {
                    reference: 'ordered',
                    levels: [
                        {
                            level: 0,
                            format: LevelFormat.DECIMAL,
                            text: '%1.',
                            alignment: AlignmentType.START,
                        },
                    ],
                },
            ],
        },
        sections: [{ children }],
    });
    return Packer.toBlob(document);
}
