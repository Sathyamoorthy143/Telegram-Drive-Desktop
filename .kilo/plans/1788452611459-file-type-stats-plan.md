# File Type Statistics in Sidebar

## Goal
Add a file-type breakdown card to the sidebar's "This folder" section, showing counts per file type (docs, excel, images, video, audio, pdf, archives, other) for the currently active folder.

## Context
The sidebar currently shows only total file count, folder count, and total bytes for the active folder. The user wants a breakdown by file type (e.g., "docs - 3, excel - 1").

## Files to Modify

### 1. `web/frontend/src/utils.ts`
Add a new helper function to categorize a file by extension:

```ts
export function getFileTypeCategory(name: string): string {
  if (isOfficeFile(name)) {
    const ext = getFileExtension(name);
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'docs';
    if (['xls', 'xlsx', 'ods'].includes(ext)) return 'excel';
    if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
    return 'docs';
  }
  if (isImageFile(name)) return 'images';
  if (isVideoFile(name)) return 'video';
  if (isAudioFile(name)) return 'audio';
  if (isPdfFile(name)) return 'pdf';
  if (isArchiveFile(name)) return 'archives';
  if (isTextFile(name)) return 'text';
  if (isExecutableFile(name)) return 'executable';
  return 'other';
}
```

### 2. `web/frontend/src/components/dashboard/Dashboard.tsx`
Extend the `folderStats` computation (around line 864-869) to include a `byType` breakdown:

```ts
const folderStats = (() => {
  if (isSpecial) return null;
  const filesOnly = (allFiles as any[]).filter((f: any) => f.type !== 'folder');
  const bytes = filesOnly.reduce((s: number, f: any) => s + (f.size || 0), 0);
  const byType: Record<string, number> = {};
  for (const f of filesOnly) {
    const cat = getFileTypeCategory(f.name || '');
    byType[cat] = (byType[cat] || 0) + 1;
  }
  return { count: filesOnly.length + subFolders.length, fileCount: filesOnly.length, folderCount: subFolders.length, bytes, byType };
})();
```

Import `getFileTypeCategory` from `../../utils`.

### 3. `web/frontend/src/components/dashboard/Sidebar.tsx`
Update the `SidebarProps` interface to include the new `byType` field:

```ts
stats?: { count: number; fileCount: number; folderCount: number; bytes: number; byType?: Record<string, number> } | null;
```

Update the "This folder" card (lines 400-406) to show the type breakdown:

```tsx
{stats && (
  <div className="mt-3 px-3 py-2 bg-white/5 border border-telegram-border rounded-xl">
    <p className="text-[10px] uppercase tracking-widest text-telegram-subtext font-bold mb-1">This folder</p>
    <p className="text-sm font-bold text-telegram-text">{formatBytesShort(stats.bytes)}</p>
    <p className="text-[11px] text-telegram-subtext">{stats.fileCount} file(s) • {stats.folderCount} folder(s)</p>
    {stats.byType && Object.keys(stats.byType).length > 0 && (
      <div className="mt-2 pt-2 border-t border-telegram-border/50">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {Object.entries(stats.byType)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <span key={type} className="text-[10px] text-telegram-subtext">
                <span className="capitalize">{type}</span> - {count}
              </span>
            ))}
        </div>
      </div>
    )}
  </div>
)}
```

## Validation
1. Run `npm run lint` in `web/frontend/` to check for TypeScript/lint errors
2. Run `npm run build` in `web/frontend/` to verify the production build succeeds
3. Verify the sidebar displays file type counts correctly when navigating between folders

## Notes
- The `byType` field is optional in the `stats` prop to maintain backward compatibility
- Only show the breakdown section when there are files in the folder
- Categories are sorted by count (descending) for readability
- The `app/` (Tauri) variant shares the same `utils.ts` and `Sidebar.tsx` — apply the same changes there if the feature is desired in the desktop app too