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
 * Which unit a kanban Complete scan completes in the operation and assembly
 * views. A serial part completes the unit on screen when it is still open at
 * this operation. With no such unit, the first operation lets the end route
 * take the next unit in order (units flow through it unscanned); a later
 * operation asks the operator to scan or select one, since the route's own
 * pick need not be the unit in their hands. Batch and untracked parts name no
 * unit.
 */
export function kanbanCompleteTarget({
  requiresSerialTracking,
  isFirstOperation,
  selectedEntityId,
  selectedIsIncomplete
}: {
  requiresSerialTracking: boolean;
  isFirstOperation: boolean;
  selectedEntityId: string | null;
  selectedIsIncomplete: boolean;
}): { action: "complete"; trackedEntityId?: string } | { action: "select" } {
  if (!requiresSerialTracking) return { action: "complete" };
  if (selectedEntityId && selectedIsIncomplete) {
    return { action: "complete", trackedEntityId: selectedEntityId };
  }
  return isFirstOperation ? { action: "complete" } : { action: "select" };
}
