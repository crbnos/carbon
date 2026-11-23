// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The panel's structured BOM view, rebuilt from the dotted item numbers the
 * status route returns. A malformed index (skipped level, missing parent)
 * becomes a top-level row rather than a dropped line.
 */

export type BomViewLine = {
  index: string;
  partNumber: string | null;
  quantity: number;
};

export type BomViewNode<T extends BomViewLine> = {
  line: T;
  children: BomViewNode<T>[];
};

export function bomViewLevel(index: string): number {
  if (!index) return 1;
  return index.split(".").length;
}

function byIndex(a: { index: string }, b: { index: string }): number {
  return a.index.localeCompare(b.index, undefined, { numeric: true });
}

export function buildBomViewTree<T extends BomViewLine>(
  lines: T[]
): BomViewNode<T>[] {
  const nodes = new Map<string, BomViewNode<T>>();
  const roots: BomViewNode<T>[] = [];

  // Shallowest first, so a parent is in the map before its children.
  const ordered = [...lines].sort(
    (a, b) => bomViewLevel(a.index) - bomViewLevel(b.index) || byIndex(a, b)
  );

  for (const line of ordered) {
    const node: BomViewNode<T> = { line, children: [] };
    nodes.set(line.index, node);
    const dot = line.index.lastIndexOf(".");
    const parent = dot === -1 ? undefined : nodes.get(line.index.slice(0, dot));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (list: BomViewNode<T>[]) => {
    list.sort((a, b) => byIndex(a.line, b.line));
    for (const node of list) sortRec(node.children);
  };
  sortRec(roots);
  return roots;
}

export type BomViewRow<T extends BomViewLine> = {
  line: T;
  /** 1-based. */
  level: number;
  hasChildren: boolean;
  /** Lines beneath it at any depth. */
  descendantCount: number;
  open: boolean;
};

/** The top level plus the subtrees of open sub-assemblies. */
export function visibleBomRows<T extends BomViewLine>(
  nodes: BomViewNode<T>[],
  open: ReadonlySet<string>
): BomViewRow<T>[] {
  const out: BomViewRow<T>[] = [];
  const walk = (list: BomViewNode<T>[], level: number) => {
    for (const node of list) {
      const hasChildren = node.children.length > 0;
      const isOpen = hasChildren && open.has(node.line.index);
      out.push({
        line: node.line,
        level,
        hasChildren,
        descendantCount: hasChildren ? countDescendants(node) : 0,
        open: isOpen
      });
      if (isOpen) walk(node.children, level + 1);
    }
  };
  walk(nodes, 1);
  return out;
}

function countDescendants<T extends BomViewLine>(node: BomViewNode<T>): number {
  let total = 0;
  for (const child of node.children) total += 1 + countDescendants(child);
  return total;
}

/** Every sub-assembly's index, for Expand all. */
export function bomParentIndexes<T extends BomViewLine>(
  nodes: BomViewNode<T>[]
): string[] {
  const out: string[] = [];
  const walk = (list: BomViewNode<T>[]) => {
    for (const node of list) {
      if (node.children.length === 0) continue;
      out.push(node.line.index);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
