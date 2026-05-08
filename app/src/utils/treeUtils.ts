import { FolderMetadata } from '../types';

export interface FolderNode extends FolderMetadata {
    children: FolderNode[];
}

export function buildFolderTree(folders: FolderMetadata[]): FolderNode[] {
    const map = new Map<number | i64, FolderNode>();
    const roots: FolderNode[] = [];

    // Initialize all nodes
    folders.forEach(f => {
        map.set(f.id, { ...f, children: [] });
    });

    // Connect children to parents
    folders.forEach(f => {
        const node = map.get(f.id)!;
        if (f.parent_id && map.has(f.parent_id)) {
            const parent = map.get(f.parent_id)!;
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    });

    return roots;
}
