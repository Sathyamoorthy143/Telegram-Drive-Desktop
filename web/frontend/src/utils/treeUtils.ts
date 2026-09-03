export interface FolderNode {
    id: number;
    name: string;
    parent_id?: number;
    children: FolderNode[];
}

export function buildFolderTree(folders: { id: number; name: string; parent_id?: number }[]): FolderNode[] {
    const map = new Map<number, FolderNode>();
    const roots: FolderNode[] = [];

    for (const folder of folders) {
        map.set(folder.id, { ...folder, children: [] });
    }

    for (const folder of folders) {
        const node = map.get(folder.id)!;
        if (folder.parent_id && map.has(folder.parent_id)) {
            map.get(folder.parent_id)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}
