// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Pure decisions behind `scrap.server.ts`, testable without a database.

import { equals, round } from "@carbon/utils";
import type { ScrapPartLine } from "./types";

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
 *   included (`kits`: each kit's quantity per unit made, and its materials
 *   per kit, so a unit holds the kit's quantity of them);
 * - every non Make to Order material of the earlier operations of the make
 *   method (`materials` holds the method's non Make to Order rows).
 */
export function operationScrapUnitValue(args: {
  operation: { id: string; jobMakeMethodId: string | null; order: number };
  routing: { id: string; jobMakeMethodId: string | null; order: number }[];
  materials: ScrapValuationMaterial[];
  kits: { quantity: number; materials: ScrapValuationMaterial[] }[];
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
  const valueOf = (materials: ScrapValuationMaterial[]) =>
    materials.reduce(
      (sum, material) =>
        sum +
        (Number(material.quantity) || 0) * (costs.get(material.itemId) ?? 0),
      0
    );
  const own = valueOf([
    ...args.materials.filter(
      (material) =>
        material.jobOperationId === operation.id && isBackflushed(material)
    ),
    ...args.materials.filter(
      (material) =>
        material.jobOperationId !== null && earlier.has(material.jobOperationId)
    )
  ]);
  return args.kits.reduce(
    (sum, kit) =>
      sum +
      (Number(kit.quantity) || 0) *
        valueOf(kit.materials.filter(isBackflushed)),
    own
  );
}

/**
 * The item each part line of a `parts` scrap writes off, read against what the
 * operation lists, as the scrapJobPart posting reads it: an untracked part by
 * item among its material's parts, a tracked one by the serial or batch used
 * on its material. Throws on a line the operation does not list, so the value
 * never leaves a part out.
 */
export function resolveScrapPartLines(
  materials: {
    id: string;
    parts: { itemId: string }[];
    tracked: { trackedEntityId: string; itemId: string }[];
  }[],
  lines: ScrapPartLine[]
): {
  materialId: string;
  itemId: string;
  trackedEntityId: string | null;
  quantity: number;
}[] {
  const materialById = new Map(materials.map((m) => [m.id, m]));
  return lines.map((line) => {
    const material = materialById.get(line.materialId);
    if ("trackedEntityId" in line) {
      const entity = material?.tracked.find(
        (e) => e.trackedEntityId === line.trackedEntityId
      );
      if (!entity) {
        throw new Error("This serial or batch was not used at this operation");
      }
      return {
        materialId: line.materialId,
        itemId: entity.itemId,
        trackedEntityId: entity.trackedEntityId,
        quantity: round(line.quantity)
      };
    }
    if (!material?.parts.some((p) => p.itemId === line.itemId)) {
      throw new Error("This part cannot be scrapped at this operation");
    }
    return {
      materialId: line.materialId,
      itemId: line.itemId,
      trackedEntityId: null,
      quantity: round(line.quantity)
    };
  });
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

/**
 * What a batch completion does with the scrap approvals recorded for its
 * batch, read once the batch is past phase 1 (`approvals`). With none of the
 * scrap's quantity it asks for approval (null). Otherwise the resume posts
 * without asking, and `scrapRequestId` names the record to mark posted after
 * it succeeds: the only record of that quantity, when it is unconfirmed.
 * Beside a second record of it, the one phase 1 used cannot be told, so none
 * is marked.
 */
export function batchScrapApprovalReuse(
  approvals: { id: string; quantity: number; posted: boolean }[],
  quantity: number
): { scrapRequestId: string | null } | null {
  const matching = approvals.filter((approval) =>
    equals(approval.quantity, quantity)
  );
  if (matching.length === 0) return null;
  const unconfirmed = matching.filter((approval) => !approval.posted);
  return {
    scrapRequestId:
      matching.length === 1 && unconfirmed.length === 1
        ? unconfirmed[0]!.id
        : null
  };
}

const PAST_PHASE_ONE = ["Completing", "Completed"];

/**
 * Whether a batch completion whose posting failed still recorded this
 * attempt's scrap. Only the move past phase 1 during this attempt says so: a
 * batch already past it before the attempt resumes with the quantities phase
 * 1 recorded, so its status says nothing of this attempt's approval.
 */
export function batchScrapPostedDespiteError(args: {
  statusBefore: string | null | undefined;
  statusAfter: string | null | undefined;
}): boolean | "unknown" {
  if (PAST_PHASE_ONE.includes(args.statusBefore ?? "")) return "unknown";
  return PAST_PHASE_ONE.includes(args.statusAfter ?? "");
}

/**
 * Splits the approvals of a write-off of several items by what the write-off
 * posted: the items with a Scrap movement are posted, the rest wrote off
 * nothing and are refused.
 */
export function stockScrapSettlement(
  approvals: { scrapRequestId: string; itemId: string | null }[],
  writtenOffItemIds: string[]
): { written: string[]; refused: string[] } {
  const writtenOff = new Set(writtenOffItemIds);
  const written: string[] = [];
  const refused: string[] = [];
  for (const approval of approvals) {
    (approval.itemId && writtenOff.has(approval.itemId)
      ? written
      : refused
    ).push(approval.scrapRequestId);
  }
  return { written, refused };
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

/**
 * What becomes of a scrap's approval record when its posting failed.
 * `committed` says whether the scrap posted anyway; "unknown" when that
 * could not be read. Only a refusal known not to have posted removes the
 * record: a record left with no `postedAt` shows as not confirmed, while a
 * removed one would leave posted scrap with no approval.
 */
export function failedScrapPostingSettlement(args: {
  refused: boolean;
  committed: boolean | "unknown";
}): "mark posted" | "discard" | "keep" {
  if (args.committed === true) return "mark posted";
  if (args.committed === false && args.refused) return "discard";
  return "keep";
}

/**
 * Whether a failed scrap write is known not to have happened. A refusal is:
 * a 4xx answer, or a database error (a SQLSTATE), which aborts the write. A lost answer is not (no status or a 5xx, a dropped
 * connection): the write may have committed, so its approval stays, not
 * confirmed.
 */
export function scrapWriteFailure(error: unknown): "refused" | "unknown" {
  if (!error || typeof error !== "object") return "unknown";
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (typeof status === "number") {
    return status >= 400 && status < 500 ? "refused" : "unknown";
  }
  if (typeof code === "string" && code !== "") {
    // SQLSTATE classes of a lost connection or a failing server, and the
    // driver's own socket errors.
    return /^(08|53|57|58)/.test(code) || /^E[A-Z]/.test(code)
      ? "unknown"
      : "refused";
  }
  // An untyped error (a dropped socket, a timeout, a failed commit) says
  // nothing of the outcome; a caller that knows its transaction rolled back
  // says "refused" itself.
  return "unknown";
}
