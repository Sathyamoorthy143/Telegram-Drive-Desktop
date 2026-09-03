import { TelegramFolder } from '../types';

export interface FolderNode extends TelegramFolder {
    id: number;
    name: string;
    parent_id?: number;
    children: FolderNode[];
}

export function buildFolderTree(folders: TelegramFolder[]): FolderNode[] {
    const map = new Map<number, FolderNode>();
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
