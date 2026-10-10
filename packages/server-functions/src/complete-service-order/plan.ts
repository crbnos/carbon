// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The completion of a Refurbishment order, kept pure so the server function
// and the ERP preview compute the same answer and it can be tested without a
// database. Spec: .ai/specs/2026-10-08-field-service.md (Accounting →
// Refurbishment completion); plan decisions C1–C4.
//
// The order's WIP moves into one serial's cost:
// - FIFO / LIFO: the serial gets a cost layer of its own (a split from the
//   layer calculateCOGS would take next, C1, with one unit of that layer's
//   open children, C2), a 'Revaluation' child of the WIP total on it, and a
//   write-down child when the new unit cost passes the sale price (C4).
// - Average: the WIP re-averages the item's unit cost; a 'Revaluation' child
//   keeps the cost in the cost ledger (C3).
// - Standard, or abnormal rework under any method: the unit keeps its cost and
//   the WIP goes to material variance.

import type { Database } from "@carbon/database";
import { round } from "@carbon/utils";
import { orderLayersForConsumption } from "../lib/cost-layer-order";

export type RefurbishmentLayer = {
  id: string;
  quantity: number;
  remainingQuantity: number;
  cost: number;
  trackedEntityId: string | null;
  /** YYYY-MM-DD */
  postingDate: string;
  /** A fixed-width UTC timestamp, so it sorts as text. */
  createdAt: string;
};

export type RefurbishmentChild = {
  id: string;
  appliesToCostLedgerId: string;
  quantity: number;
  remainingQuantity: number;
  cost: number;
  /** calculateCOGS applies a layer's children in this order. */
  createdAt: string;
};

export type RefurbishmentCompletionInput = {
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
  wipTotal: number;
  serialId: string;
  /** The item's open layers, as calculateCOGS selects them (any order). */
  openLayers: RefurbishmentLayer[];
  /** The open children of those layers. */
  openChildren: RefurbishmentChild[];
  /** Average only: the item's on-hand quantity, the serial included. */
  onHandQuantity: number;
  /** Average only: `itemCost.unitCost`. */
  currentUnitCost: number;
  /** The sale price cap (C4); null skips the cap with a warning. */
  cap: number | null;
  abnormalRework: boolean;
};

/** The account a journal line posts to; the server function resolves it. */
export type RefurbishmentAccount =
  | "inventory"
  | "workInProgress"
  | "materialVariance"
  | "inventoryAdjustmentVariance";

export type RefurbishmentJournalLine = {
  account: RefurbishmentAccount;
  side: "debit" | "credit";
  amount: number;
  description: string;
};

export type RefurbishmentSplit = {
  sourceLayerId: string;
  /** The source layer after one unit leaves it. */
  sourceQuantity: number;
  sourceRemainingQuantity: number;
  sourceCost: number;
  /** The new layer: one unit, stamped with the serial. */
  cost: number;
};

export type RefurbishmentChildMove = {
  childId: string;
  /** The child after the moved share leaves it. */
  quantity: number;
  remainingQuantity: number;
  cost: number;
  /** The new child on the serial's layer. */
  movedQuantity: number;
  movedCost: number;
};

export type RefurbishmentCompletionPlan = {
  /** What happens to the WIP. */
  treatment: "Capitalize" | "Material Variance";
  /** The serial's own open layer, when it already has one. */
  serialLayerId: string | null;
  /** Set when the serial gets a new layer; its children attach to it. */
  split: RefurbishmentSplit | null;
  childMoves: RefurbishmentChildMove[];
  /**
   * The 'Revaluation' child of the WIP total. `attached` puts it on the
   * serial's layer (the existing one or the split); an unattached child
   * (Average with no layer for the serial) only keeps the cost history.
   */
  revaluation: { cost: number; attached: boolean } | null;
  /** The write-down over the cap, ≥ 0; a negative child when > 0. */
  writeDown: number;
  /** Average only: the re-averaged `itemCost.unitCost`. */
  averageUnitCost: number | null;
  /** The serial's unit cost before and after (FIFO / LIFO), else null. */
  currentSerialUnitCost: number | null;
  newSerialUnitCost: number | null;
  capitalizedAmount: number;
  journal: RefurbishmentJournalLine[];
  warnings: string[];
};

export const NO_CAP_WARNING = "No sale price; the cost was not capped";

export const NO_SOURCE_LAYER_MESSAGE =
  "No open cost layer holds this serial. Correct the item's stock before you complete the refurbishment.";

export function planRefurbishmentCompletion(
  input: RefurbishmentCompletionInput
): RefurbishmentCompletionPlan {
  const wipTotal = round(input.wipTotal);
  const warnings: string[] = [];
  const empty = {
    serialLayerId: null,
    split: null,
    childMoves: [],
    revaluation: null,
    writeDown: 0,
    averageUnitCost: null,
    currentSerialUnitCost: null,
    newSerialUnitCost: null
  };

  // Abnormal rework is never part of the unit's cost; under Standard the unit
  // stays at standard. Either way the WIP goes to material variance.
  if (input.abnormalRework || input.costingMethod === "Standard") {
    return {
      ...empty,
      treatment: "Material Variance",
      capitalizedAmount: 0,
      journal: journalPair(
        "materialVariance",
        "workInProgress",
        wipTotal,
        input.abnormalRework ? "Abnormal Rework" : "Refurbishment Variance"
      ),
      warnings
    };
  }

  const childrenByLayer = groupChildren(input.openChildren);
  const ownLayer =
    input.openLayers.find(
      (layer) => layer.trackedEntityId === input.serialId
    ) ?? null;

  if (input.costingMethod === "Average") {
    const onHand = Math.max(input.onHandQuantity, 1);
    return {
      ...empty,
      treatment: "Capitalize",
      serialLayerId: ownLayer?.id ?? null,
      revaluation:
        wipTotal === 0 ? null : { cost: wipTotal, attached: ownLayer !== null },
      averageUnitCost: round(
        (onHand * input.currentUnitCost + wipTotal) / onHand
      ),
      capitalizedAmount: wipTotal,
      journal: journalPair(
        "inventory",
        "workInProgress",
        wipTotal,
        "Refurbishment"
      ),
      warnings
    };
  }

  // FIFO / LIFO. The serial's own layer, else the layer calculateCOGS would
  // take next for this item (C1).
  let serialLayerId: string | null = null;
  let split: RefurbishmentSplit | null = null;
  const childMoves: RefurbishmentChildMove[] = [];
  let serialUnitCost: number;

  if (ownLayer) {
    serialLayerId = ownLayer.id;
    serialUnitCost =
      unitCostOf(ownLayer) +
      (childrenByLayer.get(ownLayer.id) ?? []).reduce(
        (sum, child) =>
          sum + unitCostOf(child) * Math.min(child.remainingQuantity, 1),
        0
      );
  } else {
    const direction = input.costingMethod === "FIFO" ? 1 : -1;
    const ordered = [...input.openLayers].sort(
      (a, b) =>
        direction *
        (compare(a.postingDate, b.postingDate) ||
          compare(a.createdAt, b.createdAt))
    );
    const source = orderLayersForConsumption(ordered, [input.serialId]).find(
      (layer) => layer.trackedEntityId === null && layer.remainingQuantity >= 1
    );
    if (!source) throw new Error(NO_SOURCE_LAYER_MESSAGE);

    const unitCost = round(unitCostOf(source));
    split = {
      sourceLayerId: source.id,
      sourceQuantity: round(source.quantity - 1),
      sourceRemainingQuantity: round(source.remainingQuantity - 1),
      sourceCost: round(source.cost - unitCost),
      cost: unitCost
    };
    serialUnitCost = unitCost;

    // C2: the unit takes the child cost calculateCOGS would apply to it —
    // the source's open children in their order, one unit in total.
    let unapplied = 1;
    for (const child of childrenByLayer.get(source.id) ?? []) {
      if (unapplied <= 0) break;
      const moved = Math.min(child.remainingQuantity, unapplied);
      if (moved <= 0) continue;
      const movedCost = round(unitCostOf(child) * moved);
      childMoves.push({
        childId: child.id,
        quantity: round(child.quantity - moved),
        remainingQuantity: round(child.remainingQuantity - moved),
        cost: round(child.cost - movedCost),
        movedQuantity: round(moved),
        movedCost
      });
      serialUnitCost += movedCost;
      unapplied -= moved;
    }
  }

  const currentSerialUnitCost = round(serialUnitCost);
  const capitalized = round(currentSerialUnitCost + wipTotal);

  let writeDown = 0;
  if (input.cap === null) {
    warnings.push(NO_CAP_WARNING);
  } else if (capitalized > input.cap) {
    writeDown = round(capitalized - input.cap);
  }

  return {
    treatment: "Capitalize",
    serialLayerId,
    split,
    childMoves,
    revaluation: wipTotal === 0 ? null : { cost: wipTotal, attached: true },
    writeDown,
    averageUnitCost: null,
    currentSerialUnitCost,
    newSerialUnitCost: round(capitalized - writeDown),
    capitalizedAmount: wipTotal,
    journal: [
      ...journalPair("inventory", "workInProgress", wipTotal, "Refurbishment"),
      ...journalPair(
        "inventoryAdjustmentVariance",
        "inventory",
        writeDown,
        "Refurbishment Write-Down"
      )
    ],
    warnings
  };
}

function journalPair(
  debitAccount: RefurbishmentAccount,
  creditAccount: RefurbishmentAccount,
  amount: number,
  description: string
): RefurbishmentJournalLine[] {
  if (amount === 0) return [];
  return [
    { account: debitAccount, side: "debit", amount, description },
    { account: creditAccount, side: "credit", amount, description }
  ];
}

function unitCostOf(row: { quantity: number; cost: number }): number {
  return row.quantity > 0 ? row.cost / row.quantity : 0;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupChildren(
  children: RefurbishmentChild[]
): Map<string, RefurbishmentChild[]> {
  const byLayer = new Map<string, RefurbishmentChild[]>();
  for (const child of [...children].sort((a, b) =>
    compare(a.createdAt, b.createdAt)
  )) {
    if (child.remainingQuantity <= 0) continue;
    const list = byLayer.get(child.appliesToCostLedgerId) ?? [];
    list.push(child);
    byLayer.set(child.appliesToCostLedgerId, list);
  }
  return byLayer;
}
