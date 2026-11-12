// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type RequiredScanMaterial = {
  id: string | null;
  jobMakeMethodId: string | null;
  jobOperationId: string | null;
  requiresSerialTracking: boolean | null;
  requiresBatchTracking: boolean | null;
  quantity: number | null;
  quantityIssued: number | null;
};

/**
 * The serial and batch materials an operation consumes that are not yet
 * issued for the units it will have completed. A material with no
 * operation is consumed at the last operation of its make method.
 */
export function unissuedTrackedMaterials<T extends RequiredScanMaterial>(args: {
  materials: T[];
  operationId: string;
  jobMakeMethodId: string;
  isLastOperation: boolean;
  unitsAfterCompletion: number;
}): T[] {
  const {
    materials,
    operationId,
    jobMakeMethodId,
    isLastOperation,
    unitsAfterCompletion
  } = args;

  return materials.filter((material) => {
    if (!material.requiresSerialTracking && !material.requiresBatchTracking) {
      return false;
    }
    if (material.jobMakeMethodId !== jobMakeMethodId) return false;

    const consumedHere =
      material.jobOperationId === operationId ||
      (material.jobOperationId === null && isLastOperation);
    if (!consumedHere) return false;

    return (
      (material.quantityIssued ?? 0) <
      (material.quantity ?? 0) * unitsAfterCompletion
    );
  });
}

export function requiredScanMessage(
  rows: { itemReadableId: string; issued: number; required: number }[]
): string | null {
  if (rows.length === 0) return null;
  return `Scan in these parts first: ${rows
    .map((row) => `${row.itemReadableId} (${row.issued} of ${row.required})`)
    .join(", ")}`;
}
