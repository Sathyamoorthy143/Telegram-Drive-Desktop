// Pure path-based org routing helpers (no DOM access — pass the path in).
// Used by App.tsx boot logic; unit-tested in orgRouting.test.ts.

const RESERVED_SLUGS = new Set([
  'api', 'auth', 'login', 'logout',
  'files', 'settings', 'trash', 'members',
  'activity', 'admin', 'share', 's',
  'health', 'version', 'stream', 'preview',
  'thumbnail', 'debug', 'account', 'bandwidth',
  'folders', 'meta', 'versions',
]);

/** Extract the org slug from a URL path (`/sdpk` → `sdpk`). Null for root/reserved. */
export function orgSlugFromPath(path: string): string | null {
  if (path === '/' || path === '') return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const slug = segments[0].toLowerCase();
  if (RESERVED_SLUGS.has(slug)) return null;
  return slug;
}
