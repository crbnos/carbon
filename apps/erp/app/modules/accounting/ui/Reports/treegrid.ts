// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { UseTreeStateOutput } from "~/components/TreeView";

/*
 * Report trees are tables: each row has an account plus value columns. The
 * report frame carries role="treegrid" and each rendered row is the
 * role="row" (with the cells). These adapt TreeView's tree/treeitem props:
 * the scroller becomes the treegrid's row group (keeping its keyboard
 * handling) and the per-node wrapper stays a plain container.
 */
export const treegridBodyProps =
  (
    getTreeProps: UseTreeStateOutput["getTreeProps"]
  ): UseTreeStateOutput["getTreeProps"] =>
  () => ({
    ...getTreeProps(),
    role: "rowgroup",
    "aria-multiselectable": false
  });

export const treegridNodeWrapperProps: UseTreeStateOutput["getNodeProps"] =
  () => ({});

/**
 * The ARIA of a role="row" in a report treegrid (the row sets its own role):
 * aria-level per depth, aria-expanded only on rows that have children.
 */
export const treegridRowProps = ({
  level,
  hasChildren,
  expanded,
  rowIndex
}: {
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  /** 1-based, counting the header row; omit when rows can be collapsed away. */
  rowIndex?: number;
}) => ({
  "aria-level": level + 1,
  "aria-expanded": hasChildren ? expanded : undefined,
  "aria-rowindex": rowIndex
});

/**
 * Where an arrow key moves the focus from a row's cell (ARIA treegrid): Right
 * to the next cell (staying on the last), Left to the previous cell, or back
 * to the row from the first. `null` for a key the cell leaves to the tree
 * (Up/Down move between rows).
 */
export function treegridCellTarget(
  key: string,
  index: number,
  count: number
): number | "row" | null {
  if (key === "ArrowRight") return Math.min(index + 1, count - 1);
  if (key === "ArrowLeft") return index > 0 ? index - 1 : "row";
  return null;
}
