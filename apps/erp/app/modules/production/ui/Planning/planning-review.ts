// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure helpers: whether a planning action can be applied from the page or must
// be reviewed on its order, and what the order's own menu offers. No JSX, no
// lingui — unit-tested by apps/erp/test/planning-review.test.ts.
//
// MRP stamps `requiresManualAction` as of its run. Read on its own, a PO
// reopened since stayed on "Review" until the next run, though Apply (which
// re-reads the order) would already go through. The live status decides
// instead; the stamp is only the fallback when the order was not read.

import type { Database } from "@carbon/database";
import { isJobEditableFromPlanning } from "~/modules/production/production.models";
import {
  canCreatePurchaseOrderRevision,
  isPurchaseOrderEditableFromPlanning
} from "~/modules/purchasing/purchasing.models";

type PurchaseOrderStatus = Database["public"]["Enums"]["purchaseOrderStatus"];

const DATE_ACTION_TYPES: ReadonlySet<string> = new Set(["Expedite", "Defer"]);

export type ReviewableAction = {
  type: string;
  requiresManualAction: boolean;
  purchaseOrderLineId: string | null;
  purchaseOrderStatus: PurchaseOrderStatus | null;
  /** The line's promised date, else its delivery's: the supplier's promise. */
  purchaseOrderLinePromisedDate: string | null;
  jobId: string | null;
  jobStatus: Database["public"]["Enums"]["jobStatus"] | null;
};

/**
 * Review rather than Apply: the order is past what planning may change (a PO
 * in approval or sent, a released job), or a date move would have to change a
 * supplier's promised date — Apply writes the required date, which a promise
 * outranks. The same rules the planning.update routes apply.
 */
export function planningActionNeedsReview(action: ReviewableAction): boolean {
  if (action.purchaseOrderLineId) {
    if (!action.purchaseOrderStatus) return action.requiresManualAction;
    if (!isPurchaseOrderEditableFromPlanning(action.purchaseOrderStatus)) {
      return true;
    }
    return (
      DATE_ACTION_TYPES.has(action.type) &&
      Boolean(action.purchaseOrderLinePromisedDate)
    );
  }
  if (action.jobId) {
    if (!action.jobStatus) return action.requiresManualAction;
    return !isJobEditableFromPlanning(action.jobStatus);
  }
  return action.requiresManualAction;
}

/**
 * The action types that can be LATE: each one adds supply or brings it
 * forward, so missing its date leaves stock short. A Decrease, Defer or
 * Cancel takes away supply nothing needs — its date is only where the order
 * sits now, and waiting costs nothing but excess — so it is never urgent,
 * whatever its date or flag.
 */
const URGENCY_TYPES: ReadonlySet<string> = new Set([
  "Order",
  "Make",
  "Expedite",
  "Increase"
]);

/** Late: an urgent type whose date has passed, or that MRP flagged ASAP.
 *  A Release is late once its release day has passed — on the day itself it
 *  is due, not late. */
export function isPlanningActionLate(
  action: {
    type: string;
    status: string;
    isASAP: boolean;
    suggestedDate: string;
  },
  todayIso: string
): boolean {
  if (action.status !== "Open") return false;
  if (action.type === "Release") return action.suggestedDate < todayIso;
  if (!URGENCY_TYPES.has(action.type)) return false;
  return action.isASAP || action.suggestedDate < todayIso;
}

/** The dot on a row's Order / Make button. It asks for MORE or EARLIER
 *  supply, so only an open action that adds or advances it lights it — an
 *  Increase on an existing order counts even with nothing new to order: red
 *  when one is ASAP, green otherwise. A Release lights it red once its day
 *  has come (MRP flags it ASAP then) and not before — every planned order
 *  has one, so a green dot for each would say nothing. A Decrease, Defer or
 *  Cancel never lights it; they stay in the Actions column and the expanded
 *  row. Null when nothing does. */
export function planningActionDot(
  actions: { type: string; status: string; isASAP: boolean }[]
): "red" | "green" | null {
  const open = actions.filter((a) => a.status === "Open");
  if (open.some((a) => a.type === "Release" && a.isASAP)) return "red";
  const supply = open.filter((a) => URGENCY_TYPES.has(a.type));
  if (supply.length === 0) return null;
  return supply.some((a) => a.isASAP) ? "red" : "green";
}

/**
 * A Release whose order is no longer Planned (sent, in approval, released to
 * the floor) since MRP ran: it no longer applies, and the planning pages drop
 * it until the next run deletes it. Unknown status keeps it.
 */
export function isStaleRelease(action: {
  type: string;
  purchaseOrderLineId: string | null;
  purchaseOrderStatus: PurchaseOrderStatus | null;
  jobId: string | null;
  jobStatus: Database["public"]["Enums"]["jobStatus"] | null;
}): boolean {
  if (action.type !== "Release") return false;
  if (action.purchaseOrderLineId) {
    return (
      action.purchaseOrderStatus !== null &&
      action.purchaseOrderStatus !== "Planned"
    );
  }
  if (action.jobId) {
    return action.jobStatus !== null && action.jobStatus !== "Planned";
  }
  return false;
}

export type PlanningPurchaseOrder = {
  id: string;
  /** The PO number, for confirmations. */
  readableId?: string | null;
  status: PurchaseOrderStatus | null;
  /** Set at finalize: the PO reached the supplier. */
  orderDate: string | null;
};

/**
 * What a purchase order's menu offers on the planning pages. A PO planning
 * cannot change can be reopened — to Planned, so it stays MRP supply — and a
 * released one reopened as its next revision; a Draft or Planned PO can be
 * finalized. The status route holds the permissions and the approval rules.
 */
export function purchaseOrderPlanningMenu(order: PlanningPurchaseOrder): {
  canReopen: boolean;
  canReopenAsRevision: boolean;
  canFinalize: boolean;
} {
  if (!order.status) {
    return { canReopen: false, canReopenAsRevision: false, canFinalize: false };
  }
  const isEditable = isPurchaseOrderEditableFromPlanning(order.status);
  return {
    canReopen: !isEditable,
    canReopenAsRevision: canCreatePurchaseOrderRevision({
      newStatus: "Planned",
      currentStatus: order.status,
      orderDate: order.orderDate
    }),
    canFinalize: isEditable
  };
}
