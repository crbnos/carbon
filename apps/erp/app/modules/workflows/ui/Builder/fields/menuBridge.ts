import type { VariableMenuItem, VariableTreeNode } from "./variableMenu";

export type VariableMenuData = {
  tree: VariableTreeNode[];
  flat: VariableMenuItem[];
  /** Why the tree is empty, when the field only accepts one type. Undefined on a
   * template field, which accepts anything. */
  emptyReason?: string;
};

/** The suggestion popup mounts outside the React tree, so the focused editor leaves its
 * data here. Publish on focus, never on mount — every value field mounts an editor. */
let owner: (() => VariableMenuData) | null = null;

export function publishVariableMenuData(get: () => VariableMenuData) {
  owner = get;
}

/** No-op unless `get` still holds the slot: an unmounting editor must not blank the menu
 * of the one the user has since focused. */
export function retractVariableMenuData(get: () => VariableMenuData) {
  if (owner === get) owner = null;
}

export function readVariableMenuData(): VariableMenuData {
  return owner?.() ?? { tree: [], flat: [] };
}
