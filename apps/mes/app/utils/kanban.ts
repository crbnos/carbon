// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Whether a scan completes this kanban: its completed barcode override, or its
 * printed complete label. The label holds the origin it was printed from,
 * which need not be this deployment's ERP_URL, so only the path is compared.
 */
export function isKanbanCompleteScan(
  input: string,
  kanban: { id?: string; completedBarcodeOverride?: string | null }
): boolean {
  if (
    kanban.completedBarcodeOverride &&
    input === kanban.completedBarcodeOverride
  ) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return !!kanban.id && url.pathname === `/api/kanban/complete/${kanban.id}`;
}

/**
 * The operation's one unit, when it works exactly one: a single entity in the
 * operation's scope and a unit count of 1. The count is checked too because
 * the entity list can run short of the units the operation makes.
 */
export function soleUnitId(
  entities: { id: string; inOperationScope?: boolean }[],
  unitCount: number | null | undefined
): string | null {
  // A correction or rework operation lists every unit of the job but works
  // only the ones sent into it.
  const inScope = entities.filter(
    (entity) => entity.inOperationScope !== false
  );
  if (inScope.length !== 1) return null;
  if ((unitCount ?? 1) !== 1) return null;
  return inScope[0]!.id;
}

/**
 * Which unit a kanban Complete scan completes in the operation and assembly
 * views. A serial part completes the unit on screen when it is still open at
 * this operation. With no such unit, the first operation lets the end route
 * take the next unit in order (units flow through it unscanned). A later
 * operation completes the job's only unit when it makes one, since that unit
 * must be the one in hand; with several it asks the operator to scan or select
 * one, since the route's own pick need not be the unit in their hands. Batch
 * and untracked parts name no unit.
 */
export function kanbanCompleteTarget({
  requiresSerialTracking,
  isFirstOperation,
  selectedEntityId,
  selectedIsIncomplete,
  soleUnitId = null
}: {
  requiresSerialTracking: boolean;
  isFirstOperation: boolean;
  selectedEntityId: string | null;
  selectedIsIncomplete: boolean;
  /** The job's only unit, from `soleUnitId`; null when it makes several. */
  soleUnitId?: string | null;
}): { action: "complete"; trackedEntityId?: string } | { action: "select" } {
  if (!requiresSerialTracking) return { action: "complete" };
  if (selectedEntityId && selectedIsIncomplete) {
    return { action: "complete", trackedEntityId: selectedEntityId };
  }
  if (isFirstOperation) return { action: "complete" };
  // Named, so the end route refuses it if it is already done here instead of
  // recording a second completion for it.
  if (soleUnitId) return { action: "complete", trackedEntityId: soleUnitId };
  return { action: "select" };
}
