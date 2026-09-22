// Small LRU of already-decoded thumbnail URLs. The backend serves
// thumbnails with immutable cache headers, so this is about avoiding
// decode/spinner churn when folders are revisited, plus de-duping
// concurrent loads of the same thumbnail.
const MAX_ENTRIES = 80;
const ready = new Map<string, string>(); // key -> url, insertion-ordered LRU
const inflight = new Map<string, Promise<string>>();

const touch = (key: string, url: string) => {
    ready.delete(key);
    ready.set(key, url);
    while (ready.size > MAX_ENTRIES) {
        const oldest = ready.keys().next().value;
        if (!oldest) break;
        ready.delete(oldest);
    }
};

export const thumbKey = (folderId: number | string | null | undefined, fileId: number) =>
    `${folderId ?? 'home'}:${fileId}`;

export function getCachedThumb(key: string): string | null {
    const url = ready.get(key);
    if (!url) return null;
    touch(key, url);
    return url;
}

/** Store an already-fetched URL (e.g. org thumbnails fetched as blobs). */
export function storeCachedThumb(key: string, url: string): void {
    touch(key, url);
}

/** Load (or reuse) a thumbnail; resolves once the image has decoded. */
export function loadThumb(key: string, url: string): Promise<string> {
    const cached = getCachedThumb(key);
    if (cached) return Promise.resolve(cached);
    const existing = inflight.get(key);
    if (existing) return existing;

    const p = new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => { touch(key, url); resolve(url); };
        img.onerror = () => reject(new Error('thumbnail failed'));
        img.decoding = 'async';
        img.src = url;
    }).finally(() => { inflight.delete(key); });

    inflight.set(key, p);
    return p;
}
