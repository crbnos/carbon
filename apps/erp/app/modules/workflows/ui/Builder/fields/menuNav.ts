import type { VariableMenuItem, VariableTreeNode } from "./variableMenu";

// The keyboard behaviour of the variable menu, with no React and no DOM, so the two
// hosts (the editor popup and the popover) can never drift apart and the whole table
// can be unit-tested.

export type NavState = {
  /** Node keys from the root down to the level currently shown. */
  path: string[];
  index: number;
};

export type NavResult =
  /** The host should do whatever it would normally do with this key. */
  | { handled: false }
  | { handled: true; state: NavState }
  | { handled: true; select: VariableMenuItem }
  | { handled: true; close: true };

export const INITIAL_NAV: NavState = { path: [], index: 0 };

/** The rows visible at `path`. An unknown key resolves to the root, so a tree that changed
 * under the menu degrades to the top level instead of rendering nothing. */
export function rowsAt(
  tree: VariableTreeNode[],
  path: string[]
): VariableTreeNode[] {
  let rows = tree;
  for (const key of path) {
    const next = rows.find((r) => r.key === key)?.children;
    if (!next?.length) return tree;
    rows = next;
  }
  return rows;
}

/** Every selectable item at or below `path`, in tree order. Search runs on this, so
 * drilling into a record searches that record instead of every step in the workflow —
 * the same field name usually exists under several of them. */
export function itemsUnder(
  tree: VariableTreeNode[],
  path: string[]
): VariableMenuItem[] {
  const items: VariableMenuItem[] = [];
  const walk = (nodes: VariableTreeNode[]) => {
    for (const node of nodes) {
      if (node.item) items.push(node.item);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(rowsAt(tree, path));
  return items;
}

type NavOptions = {
  /** True in the popover host, where Backspace on an empty query pops a level.
   * False in the editor host, where Backspace must delete the `{`. */
  backspacePops: boolean;
  /** Search is flat, so level keys are meaningless while a query is present. */
  queryEmpty: boolean;
};

export function navigate(
  key: string,
  state: NavState,
  tree: VariableTreeNode[],
  opts: NavOptions
): NavResult {
  const rows = rowsAt(tree, state.path);
  if (rows.length === 0) {
    return key === "Escape"
      ? { handled: true, close: true }
      : { handled: false };
  }
  const row = rows[state.index] ?? rows[0]!;

  const move = (index: number): NavResult => ({
    handled: true,
    state: { ...state, index }
  });

  const descend = (): NavResult => ({
    handled: true,
    state: { path: [...state.path, row.key], index: 0 }
  });

  const ascend = (): NavResult => {
    const path = state.path.slice(0, -1);
    const parentKey = state.path[state.path.length - 1];
    const index = Math.max(
      rowsAt(tree, path).findIndex((r) => r.key === parentKey),
      0
    );
    return { handled: true, state: { path, index } };
  };

  switch (key) {
    case "ArrowDown":
      return move((state.index + 1) % rows.length);
    case "ArrowUp":
      return move((state.index + rows.length - 1) % rows.length);
    case "Home":
      return move(0);
    case "End":
      return move(rows.length - 1);
    case "ArrowRight":
      // A leaf swallows the key rather than jumping the caret out of the query.
      return row.children?.length ? descend() : { handled: true, state };
    case "ArrowLeft":
      // Unhandled at the root: the editor host then moves the caret normally.
      return state.path.length ? ascend() : { handled: false };
    case "Backspace":
      return opts.backspacePops && opts.queryEmpty && state.path.length
        ? ascend()
        : { handled: false };
    case "Enter":
      if (row.item) return { handled: true, select: row.item };
      if (row.children?.length) return descend();
      return { handled: true, state };
    case "Escape":
      return { handled: true, close: true };
    default:
      return { handled: false };
  }
}
