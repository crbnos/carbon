// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shop-floor rules the MES screens and the server share: when a serial unit
// counts as done at an operation, which units an operation works, and the
// Outside Processing refusal. Browser-safe: the MES screens (`useWorkUnit`)
// and the server (`resolveWorkUnit`, `startOperationTimer`) read the same code.

import type { Database } from "@carbon/database";
import { isUnitOnHold, type UnitHolds } from "./unit-hold";

/** Subcontracted work runs at the supplier and is never started on the floor. */
export const OUTSIDE_PROCESSING_REFUSAL =
  "Outside processing is done by the supplier and can't be run on the shop floor";

export type UnitLike = {
  id: string;
  inOperationScope?: boolean;
  completedOperationId?: string;
  attributes?: unknown;
  status?: string | null;
};

/** The marker records the unit index, including index zero. Legacy scalar
 * attributes carry no operation marker. */
export function completedAtOperation(
  unit: Pick<UnitLike, "attributes" | "completedOperationId">,
  operationId: string
): boolean {
  const { attributes } = unit;
  return (
    unit.completedOperationId === operationId ||
    (attributes !== null &&
      typeof attributes === "object" &&
      Object.prototype.hasOwnProperty.call(
        attributes,
        `Operation ${operationId}`
      ))
  );
}

/** Keep the step-record order. Completed units consume capacity. A blocked
 * serial remains visible for review and leaves its place available to a replacement. */
export function operationUnits<T extends UnitLike>(
  entities: T[],
  unitCount: number | null | undefined,
  quality?: { operationId: string; holds: UnitHolds | undefined }
): T[] {
  const inScope = entities.filter(
    (entity) => entity.inOperationScope !== false
  );
  if (!unitCount || unitCount <= 0 || inScope.length <= unitCount)
    return inScope;
  if (!quality) return inScope.slice(0, unitCount);
  const completedHere = (unit: T) =>
    completedAtOperation(unit, quality.operationId);
  let remaining = unitCount - inScope.filter(completedHere).length;
  return inScope.filter((unit) => {
    if (
      completedHere(unit) ||
      isUnitOnHold(quality.holds, unit.id) ||
      unit.status === "Consumed" ||
      unit.status === "Scrapped"
    )
      return true;
    if (remaining <= 0) return false;
    remaining--;
    return true;
  });
}

export type SerialEntityForSelection = Pick<
  Database["public"]["Tables"]["trackedEntity"]["Row"],
  "attributes" | "status"
> & {
  /**
   * False when the operation applies to other units only (a rework copy
   * scoped to the units sent into it). Set by `getTrackedEntitiesForOperation`;
   * absent means the operation applies to every unit.
   */
  inOperationScope?: boolean;
  completedOperationId?: string;
};

/**
 * A serial tracked entity is still "incomplete" for a job operation when its
 * attributes and production genealogy carry no completion here and it has
 * not been consumed. Shared by the serial auto-selection (routes) and the manual
 * serial picker (`useOperation`) so both agree on "done for this operation".
 */
export function isSerialEntityIncompleteForOperation(
  entity: SerialEntityForSelection,
  jobOperationId: string
): boolean {
  // Scrapped is terminal like Consumed — a scrapped unit is never a work
  // candidate; its replacement is the spawned Reserved entity.
  return (
    entity.inOperationScope !== false &&
    !completedAtOperation(entity, jobOperationId) &&
    entity.status !== "Consumed" &&
    entity.status !== "Scrapped"
  );
}
