// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Pure decisions behind `scrap.server.ts`, testable without a database.

/**
 * The cost one unit of a material writes off, by the item's costing method,
 * as the posting values it: a Standard item at its standard cost, any other
 * at its unit cost, else its standard cost. A new item often has a unit cost
 * of 0 and a standard cost; reading the 0 would let its scrap pass under
 * every tier.
 */
export function materialUnitCost(cost: {
  costingMethod?: string | null;
  unitCost: number | null;
  standardCost: number | null;
}): number {
  if (cost.costingMethod === "Standard") return cost.standardCost ?? 0;
  if (cost.unitCost != null && cost.unitCost > 0) return cost.unitCost;
  return cost.standardCost ?? 0;
}

/** The item types an operation's backflush issues. */
export const BACKFLUSHED_ITEM_TYPES = ["Material", "Part", "Consumable"];

export type ScrapValuationMaterial = {
  itemId: string;
  /** Per unit of what the operation makes. */
  quantity: number;
  jobOperationId: string | null;
  itemType: string | null;
  estimatedQuantity: number | null;
  requiresBatchTracking: boolean | null;
  requiresSerialTracking: boolean | null;
};

/** A material the operation's backflush would issue: a stocked type, untracked, still planned. */
export function isBackflushed(material: ScrapValuationMaterial): boolean {
  return (
    BACKFLUSHED_ITEM_TYPES.includes(material.itemType ?? "") &&
    (material.estimatedQuantity ?? 0) > 0 &&
    !material.requiresBatchTracking &&
    !material.requiresSerialTracking
  );
}

/**
 * The material cost of one unit scrapped at an operation, on the basis the
 * scrap posting relieves from WIP (labor and overhead stay in WIP):
 * - the materials this operation backflushes, its kitted children's
 *   included (`kitMaterials`);
 * - every non Make to Order material of the earlier operations of the make
 *   method (`materials` holds the method's non Make to Order rows).
 */
export function operationScrapUnitValue(args: {
  operation: { id: string; jobMakeMethodId: string | null; order: number };
  routing: { id: string; jobMakeMethodId: string | null; order: number }[];
  materials: ScrapValuationMaterial[];
  kitMaterials: ScrapValuationMaterial[];
  costs: Map<string, number>;
}): number {
  const { operation, costs } = args;
  const earlier = new Set(
    args.routing
      .filter(
        (step) =>
          step.jobMakeMethodId === operation.jobMakeMethodId &&
          step.order < operation.order
      )
      .map((step) => step.id)
  );
  const counted = [
    ...args.materials.filter(
      (material) =>
        material.jobOperationId === operation.id && isBackflushed(material)
    ),
    ...args.kitMaterials.filter(isBackflushed),
    ...args.materials.filter(
      (material) =>
        material.jobOperationId !== null && earlier.has(material.jobOperationId)
    )
  ];
  return counted.reduce(
    (sum, material) =>
      sum +
      (Number(material.quantity) || 0) * (costs.get(material.itemId) ?? 0),
    0
  );
}

/**
 * A batch completion's scrap as one approval: the summed quantity and value of
 * every member that scrapped. The job and item are named only when every
 * member shares them.
 */
export function sumBatchScrap(
  members: { jobOperationId: string; scrapQuantity: number }[],
  values: Map<
    string,
    { jobId: string; itemId: string | null; unitValue: number }
  >
): {
  jobId: string | null;
  itemId: string | null;
  quantity: number;
  value: number;
} {
  let quantity = 0;
  let value = 0;
  const jobIds = new Set<string>();
  const itemIds = new Set<string | null>();
  for (const member of members) {
    const operation = values.get(member.jobOperationId);
    if (!operation || member.scrapQuantity <= 0) continue;
    quantity += member.scrapQuantity;
    value += operation.unitValue * member.scrapQuantity;
    jobIds.add(operation.jobId);
    itemIds.add(operation.itemId);
  }
  return {
    jobId: jobIds.size === 1 ? [...jobIds][0]! : null,
    itemId: itemIds.size === 1 ? ([...itemIds][0] ?? null) : null,
    quantity,
    value
  };
}

export type ScrapApproverRefusal =
  | { error: null }
  | { error: { code: "self" | "forbidden"; message: string } };

/**
 * Whether an approver may sign this scrap. The person who records a scrap
 * never signs it at the tablet: the second person is the control.
 */
export function scrapApproverRefusal(args: {
  approverId: string;
  recordedBy: string;
  canApprove: boolean;
  allowSelf: boolean;
}): ScrapApproverRefusal {
  if (args.approverId === args.recordedBy && !args.allowSelf) {
    return {
      error: {
        code: "self",
        message: "You cannot approve your own scrap. Ask another approver."
      }
    };
  }
  if (!args.canApprove) {
    return {
      error: {
        code: "forbidden",
        message: "This person cannot approve scrap of this value."
      }
    };
  }
  return { error: null };
}
