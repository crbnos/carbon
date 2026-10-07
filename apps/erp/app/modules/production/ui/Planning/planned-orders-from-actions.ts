// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helpers that turn the persisted MRP worklist into the order drawer's
// suggested orders. No JSX, no lingui — unit-tested by
// apps/erp/test/planned-orders-from-actions.test.ts.
//
// The planning action is the source of truth for a suggestion (spec §P1.8).
// The drawer and the grid's Order / Make button used to size orders again in
// the browser from the weekly projections, and missed what MRP does after
// sizing: it moves expedited supply, folds a shortfall into an open order as
// an Increase, and sums each week into one action. The two lists then
// disagreed, and ordering from the drawer bought the Increase's quantity a
// second time.

import type { Database, Json } from "@carbon/database";
import { RoundingMode, round } from "@carbon/utils";
import { z } from "zod";
import type { ProductionOrder } from "~/modules/production/production.models";
import type { PlannedOrder } from "~/modules/purchasing/purchasing.models";

type NewSupplyActionFields = {
  type: Database["public"]["Enums"]["planningActionType"];
  status: Database["public"]["Enums"]["planningActionStatus"];
  purchaseOrderLineId: string | null;
  jobId: string | null;
  periodId: string;
  suggestedQuantity: number;
  suggestedDate: string;
  latestOrderDate: string | null;
  isASAP: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: Json | null;
};

/**
 * The item's open suggestions for NEW supply of one kind: an Order (buy) or a
 * Make (job) with no order or job behind it. A dismissed suggestion is the
 * planner's "no", so it never seeds the drawer.
 */
export function openNewSupplyActions<A extends NewSupplyActionFields>(
  actions: A[] | undefined,
  type: "Order" | "Make"
): A[] {
  return (actions ?? []).filter(
    (action) =>
      action.type === type &&
      action.status === "Open" &&
      !action.purchaseOrderLineId &&
      !action.jobId
  );
}

/** One job suggestion per open Make action, in the item's own units. */
export function productionOrdersFromActions(
  actions: NewSupplyActionFields[]
): ProductionOrder[] {
  return actions.map((action) => ({
    startDate: action.latestOrderDate ?? action.suggestedDate,
    dueDate: action.suggestedDate,
    periodId: action.periodId,
    quantity: Number(action.suggestedQuantity),
    isASAP: action.isASAP
  }));
}

/**
 * One purchase suggestion per open Order action. The action's quantity is in
 * inventory units; the order is in the supplier's purchase units, rounded up
 * to a whole unit.
 */
export function plannedOrdersFromActions(
  actions: NewSupplyActionFields[],
  context: {
    /** Inventory units in one purchase unit, from the chosen supplier part. */
    conversionFactor: number;
    /** The supplier chosen for the row; the action's own supplier otherwise. */
    supplierId?: string | null;
    itemReadableId?: string;
    description?: string;
    unitOfMeasureCode?: string;
  }
): PlannedOrder[] {
  const { conversionFactor } = context;
  return actions.map((action) => {
    const quantity = Number(action.suggestedQuantity);
    return {
      startDate: action.latestOrderDate ?? action.suggestedDate,
      dueDate: action.suggestedDate,
      periodId: action.periodId,
      quantity:
        conversionFactor > 0
          ? round(quantity / conversionFactor, 0, RoundingMode.Up)
          : quantity,
      supplierId: context.supplierId ?? action.supplierId ?? undefined,
      itemReadableId: context.itemReadableId,
      description: context.description,
      unitOfMeasureCode: context.unitOfMeasureCode,
      policyName: action.policyName ?? undefined,
      reason: action.reason ?? undefined,
      triggerValues: triggerValuesOf(action.triggerValues)
    };
  });
}

/** MRP writes the policy's trigger values as a flat object of numbers. */
function triggerValuesOf(value: Json | null): PlannedOrder["triggerValues"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const numbers: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number") numbers[key] = entry;
  }
  return numbers;
}

const supplierPartsValidator = z.array(
  z.object({ supplierId: z.string(), conversionFactor: z.number() })
);

/**
 * Inventory units in one purchase unit for the chosen supplier, read from the
 * planning row's supplier parts; 1 when the supplier has no part for the item.
 */
export function supplierConversionFactor(
  suppliers: unknown,
  supplierId: string | null | undefined
): number {
  const parts = supplierPartsValidator.safeParse(suppliers);
  return (
    parts.data?.find((part) => part.supplierId === supplierId)
      ?.conversionFactor ?? 1
  );
}
