export interface FolderNode { id: number; name: string; parent_id?: number; children: FolderNode[]; }
export function buildFolderTree(folders: { id: number; name: string; parent_id?: number }[]): FolderNode[] {
    const map = new Map<number, FolderNode>();
    const roots: FolderNode[] = [];
    for (const f of folders) map.set(f.id, { ...f, children: [] });
    for (const f of folders) { const node = map.get(f.id)!; if (f.parent_id && map.has(f.parent_id)) map.get(f.parent_id)!.children.push(node); else roots.push(node); }
    return roots;
}
