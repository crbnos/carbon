import type { FlatTreeItem } from "~/components/TreeView";
import type { Method } from "~/modules/items";
import type { QuoteMethod } from "~/modules/sales/types";

export const calculateTotalQuantity = (
  node: FlatTreeItem<QuoteMethod> | FlatTreeItem<Method>,
  nodes: FlatTreeItem<QuoteMethod>[] | FlatTreeItem<Method>[]
): number => {
  // Create lookup map for faster parent finding
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let quantity = node.data.quantity || 1;
  let currentNode = node;

  while (currentNode.parentId) {
    const parent = nodeMap.get(currentNode.parentId);
    if (!parent) break;
    quantity *= parent.data.quantity || 1;
    currentNode = parent;
  }

  return quantity;
};

export const generateBomIds = (
  nodes: FlatTreeItem<QuoteMethod>[] | FlatTreeItem<Method>[]
): string[] => {
  const ids = new Array(nodes.length);
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
};
