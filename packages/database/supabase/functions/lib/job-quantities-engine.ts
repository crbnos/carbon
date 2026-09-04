// Pure job-quantity cascade shared by the recalculate edge function.
// Mirrors the mrp-engine pattern: the caller batch-reads its inputs into
// Maps, this module computes the whole tree in memory with no I/O, and the
// caller batch-writes the output. Cycles in the tree data are reported
// (`cycleNodeIds`) instead of recursing forever — the same contract as
// mrp-engine's `cycleItemIds`.

import { scrapAllowance } from "../shared/precision.ts";

export type JobQuantityTreeNode = {
  id: string;
  data: {
    isRoot: boolean;
    itemId: string;
    quantity: number;
    methodType: string;
    jobMaterialMakeMethodId?: string | null;
  };
  children?: JobQuantityTreeNode[] | null;
};

export type ComputedJobQuantityNode = {
  id: string;
  hasJobMaterial: boolean;
  jobMaterialMakeMethodId: string | null;
  quantityPerParent: number;
  targetQuantity: number;
  scrapQuantity: number;
  estimatedQuantity: number;
  totalWithScrap: number;
};

export type JobQuantitiesInput = {
  tree: JobQuantityTreeNode;
  parentEstimatedQuantity: number;
  // jobMaterial.itemScrapPercentage keyed by jobMaterial id. A stored 0 is
  // intentional (locked at job creation) — only a NULL falls back to the
  // item's current replenishment scrap percentage. The root node has no
  // jobMaterial row and always uses the fallback.
  storedScrapById: Map<string, number | null>;
  replenishmentScrapByItemId: Map<string, number>;
};

export type JobQuantitiesOutput = {
  computed: ComputedJobQuantityNode[];
  cycleNodeIds: Set<string>;
};

// Flatten the tree once so the caller can batch its reads (jobMaterial ids,
// item ids). A node re-entered on the current path is a cycle in the tree
// data — it is skipped and reported rather than looped on.
export function flattenJobQuantityTree(root: JobQuantityTreeNode): {
  nodes: JobQuantityTreeNode[];
  cycleNodeIds: Set<string>;
} {
  const nodes: JobQuantityTreeNode[] = [];
  const cycleNodeIds = new Set<string>();
  const walk = (node: JobQuantityTreeNode, path: Set<string>) => {
    if (path.has(node.id)) {
      cycleNodeIds.add(node.id);
      return;
    }
    path.add(node.id);
    nodes.push(node);
    for (const child of node.children ?? []) {
      walk(child, path);
    }
    path.delete(node.id);
  };
  walk(root, new Set());
  return { nodes, cycleNodeIds };
}

// Same math as the historical per-node recursion, walked top-down:
// - For root: targetQuantity = parentEstimatedQuantity
// - For children: targetQuantity = parent's totalWithScrap * quantity per parent
// - scrapQuantity = whole-unit scrap allowance; fractional targets flow through
// - estimatedQuantity: For Make = good quantity (without scrap), For Buy/Pick = total
export function computeJobQuantities(
  input: JobQuantitiesInput
): JobQuantitiesOutput {
  const { tree, parentEstimatedQuantity, storedScrapById } = input;
  const computed: ComputedJobQuantityNode[] = [];
  const cycleNodeIds = new Set<string>();

  const walk = (
    node: JobQuantityTreeNode,
    parentQuantity: number,
    path: Set<string>
  ) => {
    if (path.has(node.id)) {
      cycleNodeIds.add(node.id);
      return;
    }
    path.add(node.id);

    const targetQuantity = node.data.isRoot
      ? parentQuantity
      : node.data.quantity * parentQuantity;
    const stored = storedScrapById.get(node.id);
    const scrapPercentage =
      stored != null
        ? Number(stored)
        : input.replenishmentScrapByItemId.get(node.data.itemId) ?? 0;
    const scrapQuantity = scrapAllowance(targetQuantity, scrapPercentage);
    const totalWithScrap = targetQuantity + scrapQuantity;
    const estimatedQuantity =
      node.data.methodType === "Make to Order" ? targetQuantity : totalWithScrap;

    computed.push({
      id: node.id,
      hasJobMaterial: storedScrapById.has(node.id),
      jobMaterialMakeMethodId: node.data.jobMaterialMakeMethodId ?? null,
      quantityPerParent: node.data.quantity,
      targetQuantity,
      scrapQuantity,
      estimatedQuantity,
      totalWithScrap,
    });

    for (const child of node.children ?? []) {
      walk(child, totalWithScrap, path);
    }
    path.delete(node.id);
  };

  walk(tree, parentEstimatedQuantity, new Set());
  return { computed, cycleNodeIds };
}
