// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The assembly review as a tree: each row under the assembly whose BOM lists
// it, as Onshape structures it. Pure, so the panel only renders it.

type TreePlan = {
  root: { partNumber: string };
  items: Array<{ partNumber: string }>;
  methods: Array<{
    parentPartNumber: string;
    writes: Array<{ partNumber: string; quantity: number }>;
  }>;
};

export type ReviewTreeRow = {
  /** Unique per place in the tree: a part used in two modules has two rows. */
  key: string;
  partNumber: string;
  /** 0 for the pushed assembly. */
  depth: number;
  /** Null for the root. */
  parentKey: string | null;
  /** The quantity its parent's BOM line gives; null for the root. */
  quantity: number | null;
  childKeys: string[];
};

/**
 * Rows in BOM order, depth first. A plan item no BOM line reaches (a refused
 * method's children) sits under the root, last. A part number met again on
 * its own path (a cycle) is not expanded twice.
 */
export function assemblyReviewTree(plan: TreePlan): ReviewTreeRow[] {
  const writesByParent = new Map(
    plan.methods.map((method) => [method.parentPartNumber, method.writes])
  );
  const rows: ReviewTreeRow[] = [];
  const placed = new Set<string>([plan.root.partNumber]);

  const visit = (
    partNumber: string,
    depth: number,
    parentKey: string | null,
    quantity: number | null,
    path: string[]
  ): string => {
    const key = [...path, partNumber].join("/");
    const row: ReviewTreeRow = {
      key,
      partNumber,
      depth,
      parentKey,
      quantity,
      childKeys: []
    };
    rows.push(row);
    const writes = writesByParent.get(partNumber) ?? [];
    if (!path.includes(partNumber)) {
      writes.forEach((line, index) => {
        placed.add(line.partNumber);
        row.childKeys.push(
          visit(line.partNumber, depth + 1, key, line.quantity, [
            ...path,
            partNumber,
            String(index)
          ])
        );
      });
    }
    return key;
  };

  visit(plan.root.partNumber, 0, null, null, []);
  const root = rows[0]!;
  for (const item of plan.items) {
    if (placed.has(item.partNumber)) continue;
    placed.add(item.partNumber);
    root.childKeys.push(
      visit(item.partNumber, 1, root.key, null, [root.partNumber, "unplaced"])
    );
  }
  return rows;
}

/** The rows to show: every row whose ancestors are all open. */
export function visibleReviewRows(
  rows: ReviewTreeRow[],
  open: ReadonlySet<string>
): ReviewTreeRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const isShown = (row: ReviewTreeRow): boolean => {
    let parentKey = row.parentKey;
    while (parentKey) {
      if (!open.has(parentKey)) return false;
      parentKey = byKey.get(parentKey)?.parentKey ?? null;
    }
    return true;
  };
  return rows.filter(isShown);
}

/** Part numbers of a row and every row below it. */
export function subtreePartNumbers(
  rows: ReviewTreeRow[],
  key: string
): string[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const out: string[] = [];
  const walk = (current: string) => {
    const row = byKey.get(current);
    if (!row) return;
    out.push(row.partNumber);
    for (const child of row.childKeys) walk(child);
  };
  walk(key);
  return [...new Set(out)];
}

/** The rows `keep` picks and their ancestors, so the tree stays readable. */
export function rowsWithAncestors(
  rows: ReviewTreeRow[],
  keep: (row: ReviewTreeRow) => boolean
): ReviewTreeRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const shown = new Set<string>();
  for (const row of rows) {
    if (!keep(row)) continue;
    let current: ReviewTreeRow | undefined = row;
    while (current && !shown.has(current.key)) {
      shown.add(current.key);
      current = current.parentKey ? byKey.get(current.parentKey) : undefined;
    }
  }
  return rows.filter((row) => shown.has(row.key));
}
