// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type StepBackflushMaterial = {
  id: string;
  itemId: string;
  quantity: number | null;
  quantityIssued: number | null;
  jobOperationId: string | null;
};

export type StepBackflushLink = {
  jobMaterialId: string;
  jobOperationStepId: string;
  // NULL = the full BOM line quantity.
  quantity: number | null;
};

export type StepBackflushIssue = {
  materialId: string;
  itemId: string;
  quantity: number;
};

/**
 * A loose part belongs to its own operation, or to any operation when it has
 * none, as the completion backflush attributes it.
 */
export function ownsLooseMaterial(
  material: Pick<StepBackflushMaterial, "jobOperationId">,
  operationId: string
) {
  return (
    material.jobOperationId === null || material.jobOperationId === operationId
  );
}

/**
 * What recording one of an operation's steps issues. Step ownership:
 *   • A step-assigned part (jobMaterialStep) is owned by its assigned step(s)
 *     and issues when any of those steps is recorded for a unit.
 *   • A loose part (no step assignment) is owned by its operation's FIRST step,
 *     where the operator sees it. A loose part on another operation is skipped.
 * Per material the target is (distinct units that recorded an owning step) ×
 * per-unit quantity, and only the shortfall against `quantityIssued` is issued,
 * so re-records, undo/redo, manual issues and the completion backflush overlap
 * without double-issuing. A part assigned to several steps is counted once per
 * unit, so its requirement never multiplies. A line split across steps (per-link
 * quantities) issues each step's share, capped at the line.
 */
export function planStepBackflush(args: {
  operationId: string;
  // The operation's steps, in order.
  stepIds: string[];
  materials: StepBackflushMaterial[];
  stepLinks: StepBackflushLink[];
  records: { jobOperationStepId: string; index: number }[];
}): StepBackflushIssue[] {
  const firstStepId = args.stepIds[0];
  if (!firstStepId) return [];

  const ownedSteps = new Map<string, Set<string>>();
  const linkQuantities = new Map<string, Map<string, number | null>>();
  for (const link of args.stepLinks) {
    const set = ownedSteps.get(link.jobMaterialId) ?? new Set<string>();
    set.add(link.jobOperationStepId);
    ownedSteps.set(link.jobMaterialId, set);
    const quantities =
      linkQuantities.get(link.jobMaterialId) ??
      new Map<string, number | null>();
    quantities.set(link.jobOperationStepId, link.quantity);
    linkQuantities.set(link.jobMaterialId, quantities);
  }

  const unitsByStep = new Map<string, Set<number>>();
  for (const r of args.records) {
    const set = unitsByStep.get(r.jobOperationStepId) ?? new Set<number>();
    set.add(r.index);
    unitsByStep.set(r.jobOperationStepId, set);
  }

  const issues: StepBackflushIssue[] = [];
  for (const material of args.materials) {
    const perUnit = material.quantity ?? 0;
    if (perUnit <= 0) continue;
    const owning = ownedSteps.get(material.id);
    const isLoose = !owning || owning.size === 0;
    if (isLoose && !ownsLooseMaterial(material, args.operationId)) continue;
    const triggerStepIds = isLoose
      ? [firstStepId]
      : args.stepIds.filter((id) => owning.has(id));
    const quantities = linkQuantities.get(material.id);
    const hasSplitQuantities = triggerStepIds.some(
      (id) => (quantities?.get(id) ?? null) !== null
    );
    const units = new Set<number>();
    for (const id of triggerStepIds) {
      for (const idx of unitsByStep.get(id) ?? []) units.add(idx);
    }
    let target: number;
    if (hasSplitQuantities) {
      // A link with no quantity of its own takes the full per-unit quantity.
      target = Math.min(
        triggerStepIds.reduce(
          (sum, id) =>
            sum +
            (unitsByStep.get(id)?.size ?? 0) * (quantities?.get(id) ?? perUnit),
          0
        ),
        units.size * perUnit
      );
    } else {
      target = units.size * perUnit;
    }
    const delta = target - (material.quantityIssued ?? 0);
    if (delta <= 0) continue;
    issues.push({
      materialId: material.id,
      itemId: material.itemId,
      quantity: delta
    });
  }
  return issues;
}
