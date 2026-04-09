import type { FlatTreeItem } from "~/components/TreeView";
import type { Method } from "~/modules/items";
import type { JobMethod } from "~/modules/production/types";
import type { QuoteMethod } from "~/modules/sales/types";

export interface WorkCenterRate {
  id: string;
  active: boolean;
  laborRate: number | null;
  machineRate: number | null;
  overheadRate: number | null;
  processes: string[] | null;
}

export function resolveOperationRates(
  workCenterId: string | null,
  processId: string,
  laborRate: number | null,
  machineRate: number | null,
  overheadRate: number | null,
  workCenters: WorkCenterRate[]
): { laborRate: number; machineRate: number; overheadRate: number } {
  // If a work center is explicitly set and has rates, use them
  if (workCenterId) {
    const wc = workCenters.find((w) => w.id === workCenterId && w.active);
    if (wc) {
      return {
        laborRate: wc.laborRate ?? 0,
        machineRate: wc.machineRate ?? 0,
        overheadRate: wc.overheadRate ?? 0
      };
    }
    // Fall back to the joined rates from the operation
    return {
      laborRate: laborRate ?? 0,
      machineRate: machineRate ?? 0,
      overheadRate: overheadRate ?? 0
    };
  }

  // No work center selected — average rates from active work centers for this process
  const related = workCenters.filter(
    (wc) => wc.active && (wc.processes ?? []).some((p) => p === processId)
  );

  if (related.length > 0) {
    return {
      laborRate:
        related.reduce((sum, wc) => sum + (wc.laborRate ?? 0), 0) /
        related.length,
      machineRate:
        related.reduce((sum, wc) => sum + (wc.machineRate ?? 0), 0) /
        related.length,
      overheadRate:
        related.reduce((sum, wc) => sum + (wc.overheadRate ?? 0), 0) /
        related.length
    };
  }

  return { laborRate: 0, machineRate: 0, overheadRate: 0 };
}

export interface BomOperation {
  operationType: string;
  setupTime: number | null;
  setupUnit: string;
  laborTime: number | null;
  laborUnit: string;
  machineTime: number | null;
  machineUnit: string;
  operationUnitCost: number;
  operationMinimumCost: number;
  laborRate: number;
  machineRate: number | null;
  overheadRate: number;
}

export function normalizeTime(
  time: number,
  unit: string
): { fixedHours: number; hoursPerUnit: number } {
  let fixedHours = 0;
  let hoursPerUnit = 0;
  switch (unit) {
    case "Total Hours":
      fixedHours = time;
      break;
    case "Total Minutes":
      fixedHours = time / 60;
      break;
    case "Hours/Piece":
      hoursPerUnit = time;
      break;
    case "Hours/100 Pieces":
      hoursPerUnit = time / 100;
      break;
    case "Hours/1000 Pieces":
      hoursPerUnit = time / 1000;
      break;
    case "Minutes/Piece":
      hoursPerUnit = time / 60;
      break;
    case "Minutes/100 Pieces":
      hoursPerUnit = time / 100 / 60;
      break;
    case "Minutes/1000 Pieces":
      hoursPerUnit = time / 1000 / 60;
      break;
    case "Pieces/Hour":
      hoursPerUnit = 1 / time;
      break;
    case "Pieces/Minute":
      hoursPerUnit = 1 / (time / 60);
      break;
    case "Seconds/Piece":
      hoursPerUnit = time / 3600;
      break;
  }
  return { fixedHours, hoursPerUnit };
}

function calculateOperationUnitCost(
  op: BomOperation,
  batchSize: number
): number {
  if (op.operationType === "Outside") {
    return Math.max(op.operationMinimumCost, op.operationUnitCost);
  }

  const batch = batchSize > 1 ? batchSize : 1;
  let cost = 0;

  if (op.setupTime) {
    const { fixedHours, hoursPerUnit } = normalizeTime(
      op.setupTime,
      op.setupUnit
    );
    const hoursPerPart = fixedHours / batch + hoursPerUnit;
    cost += hoursPerPart * (op.laborRate ?? 0);
    cost += hoursPerPart * (op.overheadRate ?? 0);
  }

  let laborHoursPerPart = 0;
  let machineHoursPerPart = 0;

  if (op.laborTime) {
    const { fixedHours, hoursPerUnit } = normalizeTime(
      op.laborTime,
      op.laborUnit
    );
    laborHoursPerPart = fixedHours / batch + hoursPerUnit;
    cost += laborHoursPerPart * (op.laborRate ?? 0);
  }

  if (op.machineTime) {
    const { fixedHours, hoursPerUnit } = normalizeTime(
      op.machineTime,
      op.machineUnit
    );
    machineHoursPerPart = fixedHours / batch + hoursPerUnit;
    cost += machineHoursPerPart * (op.machineRate ?? 0);
  }

  cost +=
    Math.max(laborHoursPerPart, machineHoursPerPart) * (op.overheadRate ?? 0);

  return cost;
}

export function calculateMadePartCosts<
  TData extends {
    methodType: string;
    unitCost: number;
    quantity: number;
    itemId: string;
  }
>(
  nodes: FlatTreeItem<TData>[],
  operationsByKey: Record<string, BomOperation[]>,
  getOperationKey: (node: FlatTreeItem<TData>) => string,
  lotSizesByItemId?: Map<string, number>
): Map<string, number> {
  const costMap = new Map<string, number>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Iterate in reverse (bottom-up since flattenTree is depth-first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];

    if (node.data.methodType !== "Make to Order" && !node.hasChildren) {
      costMap.set(node.id, node.data.unitCost ?? 0);
      continue;
    }

    // Sum children material costs
    let materialCost = 0;
    for (const childId of node.children) {
      const child = nodeMap.get(childId);
      if (!child) continue;
      const childUnitCost = costMap.get(childId) ?? child.data.unitCost ?? 0;
      materialCost += childUnitCost * (child.data.quantity ?? 0);
    }

    // Sum operation costs, amortizing fixed costs over the batch size
    const batchSize = lotSizesByItemId?.get(node.data.itemId) ?? 1;
    let operationCost = 0;
    const key = getOperationKey(node);
    const ops = operationsByKey[key] ?? [];
    for (const op of ops) {
      operationCost += calculateOperationUnitCost(op, batchSize);
    }

    costMap.set(node.id, materialCost + operationCost);
  }

  return costMap;
}

export const calculateTotalQuantity = (
  node:
    | FlatTreeItem<QuoteMethod>
    | FlatTreeItem<Method>
    | FlatTreeItem<JobMethod>,
  nodes:
    | FlatTreeItem<QuoteMethod>[]
    | FlatTreeItem<Method>[]
    | FlatTreeItem<JobMethod>[]
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
  nodes:
    | FlatTreeItem<QuoteMethod>[]
    | FlatTreeItem<Method>[]
    | FlatTreeItem<JobMethod>[]
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
