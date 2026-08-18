// Reconciling a Carbon make method's material list against an Onshape BOM.
//
// The v1 writer deleted every methodMaterial row for the method and re-inserted
// from scratch. That is why "keep the BOP" is impossible there:
// `methodMaterial.methodOperationId` is what ties a BOM line to the routing
// step that consumes it, `methodMaterialStep` rows hang off the line, and an
// 8-column re-insert also resets scrapQuantity, kit, sourcingType,
// storageUnitIds and tags. Every one of those is lost on every sync, silently.
//
// Reconciling keeps the rows that survive, so everything hanging off them
// survives too. Only the fields Onshape owns are written.

/** An existing methodMaterial row, reduced to what reconciliation needs. */
export type ExistingMaterial = {
  id: string;
  itemId: string;
  quantity: number;
  order: number;
};

/** A BOM line, already resolved to the Carbon item it refers to. */
export type DesiredMaterial = {
  itemId: string;
  quantity: number;
  order: number;
};

/**
 * Components the import REFUSED to resolve, which must therefore be left
 * exactly as they are.
 *
 * Without this, a refusal is worse than a no-op: a row the import declined to
 * touch is simply absent from `desired`, so reconciliation reads it as "Onshape
 * no longer has this" and DELETES the existing line. Refusing to act on a line
 * and deleting it are opposite outcomes, and the user was told the row was
 * "skipped".
 */
export type ReconcileOptions = {
  /** Item ids that must never appear in `remove`, whatever `desired` says. */
  protectedItemIds?: Iterable<string>;
};

export type ReconcilePlan = {
  /** Lines Onshape has that Carbon does not. */
  insert: DesiredMaterial[];
  /** Lines both have, where a field Onshape owns changed. */
  update: Array<{
    id: string;
    itemId: string;
    quantity: number;
    order: number;
  }>;
  /** Lines Carbon has that Onshape no longer does. */
  remove: ExistingMaterial[];
  /** Lines both have, unchanged — reported so a no-op sync can say so. */
  unchanged: ExistingMaterial[];
  /** Lines kept only because the import refused to resolve their component. */
  protected: ExistingMaterial[];
};

/**
 * Plan the changes to one make method's material list.
 *
 * Keyed on the component `itemId`. That is the only stable join available:
 * `methodMaterial` has no Onshape back-pointer, and Onshape's own row ids are
 * scoped to a single response rather than stable across calls. Onshape
 * aggregates repeated instances of a part into one row with a quantity, so a
 * component appearing twice at one level does not occur — but if it ever does,
 * the FIRST desired line wins and the rest are ignored rather than producing
 * duplicate rows Carbon cannot tell apart.
 *
 * Quantity and order are the only fields updated. Everything else on a
 * surviving row — the routing link, scrap, kit flag, sourcing, storage units,
 * tags, and its methodMaterialStep children — is deliberately untouched.
 */
export function reconcileMethodMaterials(
  existing: ExistingMaterial[],
  desired: DesiredMaterial[],
  options: ReconcileOptions = {}
): ReconcilePlan {
  const plan: ReconcilePlan = {
    insert: [],
    update: [],
    remove: [],
    unchanged: [],
    protected: []
  };

  const protectedItemIds = new Set(options.protectedItemIds ?? []);

  const existingByItem = new Map<string, ExistingMaterial>();
  for (const row of existing) {
    // A pre-existing duplicate is data Carbon already has; keep the first and
    // let the rest fall through to `remove`, which is the only way to converge.
    if (!existingByItem.has(row.itemId)) existingByItem.set(row.itemId, row);
  }

  const seen = new Set<string>();

  for (const want of desired) {
    if (seen.has(want.itemId)) continue;
    seen.add(want.itemId);

    const current = existingByItem.get(want.itemId);
    if (!current) {
      plan.insert.push(want);
      continue;
    }

    if (current.quantity !== want.quantity || current.order !== want.order) {
      plan.update.push({
        id: current.id,
        itemId: want.itemId,
        quantity: want.quantity,
        order: want.order
      });
    } else {
      plan.unchanged.push(current);
    }
  }

  for (const row of existing) {
    const kept = existingByItem.get(row.itemId);
    const wanted = seen.has(row.itemId) && kept === row;
    if (wanted) continue;

    // A component the import REFUSED to resolve is not "a component Onshape
    // dropped" — the import simply has nothing to say about it, so the existing
    // line stands.
    if (protectedItemIds.has(row.itemId)) {
      plan.protected.push(row);
      continue;
    }

    // Remove anything Onshape did not ask for, plus any duplicate rows beyond
    // the first for a component it did.
    plan.remove.push(row);
  }

  return plan;
}

/** True when nothing about the material list would change. */
export function isNoOpPlan(plan: ReconcilePlan): boolean {
  return (
    plan.insert.length === 0 &&
    plan.update.length === 0 &&
    plan.remove.length === 0
  );
}
