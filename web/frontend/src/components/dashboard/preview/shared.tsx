/** Shared building blocks for the built-in file preview renderers. */

export function PreviewSpinner({ label }: { label: string }) {
    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#1c1c1c] text-white z-10">
            <div className="w-10 h-10 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin" />
            <p>Loading preview...</p>
            <p className="text-xs text-white/50">{label}</p>
        </div>
    );
}

export function PreviewError({ message, detail }: { message: string; detail?: string }) {
    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1c1c1c] text-center p-8 z-10">
            <p className="text-white font-medium">{message}</p>
            {detail && <p className="text-xs text-white/50 max-w-md">{detail}</p>}
        </div>
    );
}

/**
 * Strip anything dangerous from generated preview HTML (scripts, embeds,
 * inline handlers, javascript: URLs) before it hits dangerouslySetInnerHTML.
 */
export function sanitizeHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link,meta,style,form,input,button,select,textarea')
        .forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const isHandler = name.startsWith('on');
            const isJsUrl = (name === 'href' || name === 'src' || name === 'xlink:href')
                && /^\s*javascript:/i.test(attr.value);
            if (isHandler || isJsUrl) el.removeAttribute(attr.name);
        }
    });
    return doc.body.innerHTML;
}
