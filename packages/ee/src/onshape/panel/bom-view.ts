/**
 * Two ways to read an assembly's BOM in the panel, the same two Onshape's own
 * BOM table offers.
 *
 * The status route hands the panel one pre-order array of lines, each carrying
 * Onshape's dotted item number ("1", "1.1", "1.1.2") — the same `index`
 * `parseBomTree` assigns. That is enough to rebuild the hierarchy on the
 * client, so neither view costs a second Onshape call.
 *
 * Structured is the tree, collapsed to the top level. A real assembly runs to
 * hundreds of rows and the panel is about twenty tall, so showing every level
 * at once is unreadable; a sub-assembly opens when someone asks for it.
 *
 * Flat is one row per distinct part number with the quantity rolled up through
 * its ancestors, which is what "how many of these does this assembly take"
 * means. Sub-assemblies stay in the flat list even though their own contents
 * are listed too: each one becomes a Carbon item, so dropping them would
 * understate the push.
 *
 * Everything here is pure and total. A malformed index (a level that skips, a
 * parent that never appeared) resolves to a top-level row rather than throwing
 * or dropping the line — a line the user cannot see is worse than a line at the
 * wrong indent.
 */

/** The little a view needs from a BOM line; callers pass their own richer row. */
export type BomViewLine = {
  /** Onshape's dotted item number. */
  index: string;
  partNumber: string | null;
  quantity: number;
};

export type BomViewNode<T extends BomViewLine> = {
  line: T;
  children: BomViewNode<T>[];
};

/** 1 for a top-level line, 2 for its children, and so on. */
export function bomViewLevel(index: string): number {
  if (!index) return 1;
  return index.split(".").length;
}

function byIndex(a: { index: string }, b: { index: string }): number {
  return a.index.localeCompare(b.index, undefined, { numeric: true });
}

/** Rebuild the hierarchy from the dotted item numbers. */
export function buildBomViewTree<T extends BomViewLine>(
  lines: T[]
): BomViewNode<T>[] {
  const nodes = new Map<string, BomViewNode<T>>();
  const roots: BomViewNode<T>[] = [];

  // Shallowest first, so a parent is always in the map before its children —
  // whatever order the caller's array arrived in.
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
  /** 1-based, for the indent. */
  level: number;
  /** Sub-assembly: it has a row to open. */
  hasChildren: boolean;
  /** Every line beneath it, at any depth — what opening it reveals. */
  descendantCount: number;
  open: boolean;
};

/**
 * The structured view's rows: the top level, plus the subtrees of whichever
 * sub-assemblies are open. A closed sub-assembly hides its whole subtree, so
 * an index inside a closed one is never consulted.
 */
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

export type FlatBomRow<T extends BomViewLine> = {
  /** The first line that contributed, for the name, part number and state. */
  line: T;
  /** Quantity across the whole assembly, multiplied through the ancestors. */
  totalQuantity: number;
  /** BOM rows folded into this one. */
  occurrences: number;
};

/**
 * One row per distinct part number, in order of first appearance.
 *
 * A line with no part number cannot be folded together with anything — there is
 * nothing to match on — so each one stays its own row.
 */
export function flattenBomView<T extends BomViewLine>(
  lines: T[]
): FlatBomRow<T>[] {
  const tree = buildBomViewTree(lines);
  const rows: FlatBomRow<T>[] = [];
  const byKey = new Map<string, FlatBomRow<T>>();

  const walk = (list: BomViewNode<T>[], multiplier: number) => {
    for (const node of list) {
      const quantity = node.line.quantity * multiplier;
      // Both sides are prefixed, so a part number that happens to read like an
      // item number cannot fold two unrelated rows together.
      const key = node.line.partNumber
        ? `p:${node.line.partNumber}`
        : `i:${node.line.index}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.totalQuantity += quantity;
        existing.occurrences += 1;
      } else {
        const row: FlatBomRow<T> = {
          line: node.line,
          totalQuantity: quantity,
          occurrences: 1
        };
        byKey.set(key, row);
        rows.push(row);
      }
      walk(node.children, quantity);
    }
  };
  walk(tree, 1);
  return rows;
}
