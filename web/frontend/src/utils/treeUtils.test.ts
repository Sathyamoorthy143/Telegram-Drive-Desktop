import { describe, it, expect } from 'vitest';
import { buildFolderTree } from './treeUtils';

describe('buildFolderTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildFolderTree([])).toEqual([]);
  });

  it('returns roots when no parent_id', () => {
    const tree = buildFolderTree([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.map(n => n.name)).toEqual(['A', 'B']);
  });

  it('nests child under parent', () => {
    const tree = buildFolderTree([
      { id: 1, name: 'Root' },
      { id: 2, name: 'Child', parent_id: 1 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('Child');
  });

  it('promotes orphan to root', () => {
    const tree = buildFolderTree([
      { id: 2, name: 'Orphan', parent_id: 999 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Orphan');
  });

  it('builds deep hierarchy', () => {
    const tree = buildFolderTree([
      { id: 1, name: 'A' },
      { id: 2, name: 'B', parent_id: 1 },
      { id: 3, name: 'C', parent_id: 2 },
    ]);
    expect(tree[0].children[0].children[0].name).toBe('C');
  });

  it('handles multiple children per parent', () => {
    const tree = buildFolderTree([
      { id: 1, name: 'P' },
      { id: 2, name: 'X', parent_id: 1 },
      { id: 3, name: 'Y', parent_id: 1 },
    ]);
    expect(tree[0].children).toHaveLength(2);
  });
});
