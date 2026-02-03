/**
 * Tree and BOM (Bill of Materials) utility types and functions
 */

/** A tree structure */
export type Tree<TData> = {
  id: string;
  children?: Tree<TData>[];
  data: TData;
};

/** A tree but flattened so it can easily be used for DOM elements */
export type FlatTreeItem<TData> = {
  id: string;
  parentId: string | undefined;
  children: string[];
  hasChildren: boolean;
  /** The indentation level, the root is 0 */
  level: number;
  data: TData;
};

export type FlatTree<TData> = FlatTreeItem<TData>[];

/**
 * Flattens a tree structure into an array of FlatTreeItems.
 * Preserves parent-child relationships and calculates the level (depth) of each node.
 */
export function flattenTree<TData>(tree: Tree<TData>): FlatTree<TData> {
  const flatTree: FlatTree<TData> = [];

  function flattenNode(
    node: Tree<TData>,
    parentId: string | undefined,
    level: number
  ) {
    const children = node.children?.map((child) => child.id) ?? [];
    flatTree.push({
      id: node.id,
      parentId,
      children,
      hasChildren: children.length > 0,
      level,
      data: node.data
    });

    node.children?.forEach((child) => {
      flattenNode(child, node.id, level + 1);
    });
  }

  flattenNode(tree, undefined, 0);

  return flatTree;
}

/**
 * Generates hierarchical BOM IDs for a flattened tree.
 * Root node gets "1", children get "1.1", "1.2", etc.
 * Grandchildren get "1.1.1", "1.1.2", etc.
 *
 * @param nodes - A flattened tree with level information
 * @returns An array of BOM IDs in the same order as the input nodes
 */
export function generateBomIds<TData>(nodes: FlatTreeItem<TData>[]): string[] {
  const ids = new Array<string>(nodes.length);
  const levelCounters = new Map<number, number>();

  nodes.forEach((node, index) => {
    const level = node.level;

    // Reset deeper level counters when moving to shallower level
    if (index > 0 && level <= nodes[index - 1].level) {
      for (const [key] of levelCounters) {
        if (key > level) levelCounters.delete(key);
      }
    }

    // Update counter for current level
    levelCounters.set(level, (levelCounters.get(level) || 0) + 1);

    // Build ID string from all level counters
    ids[index] = Array.from(
      { length: level + 1 },
      (_, i) => levelCounters.get(i) || 1
    ).join(".");
  });

  return ids;
}
