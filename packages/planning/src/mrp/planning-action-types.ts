// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The shape of one planning action candidate and of the open orders the
// change actions target. Shared by the row sizing (`row-sizing.ts`) and the
// action generator (`planning-actions.ts`), so neither imports the other's types.

export type PlanningActionType =
  | "Order"
  | "Make"
  | "Expedite"
  | "Defer"
  | "Cancel"
  | "Increase"
  | "Decrease"
  | "Release"
  | "Transfer"
  | "Borrow";

/**
 * The netting segment and, for a Transfer or Borrow, the owners the stock
 * moves between. Absent is common ('') with no owners.
 */
export type PlanningActionSegment = {
  /** '' is common; a project id is a project with project stock. */
  planningSegmentId?: string;
  /** Transfer / Borrow: the owner the stock leaves; null is common stock. */
  fromProjectId?: string | null;
  /** Transfer / Borrow: the owner the stock joins; null is common stock. */
  toProjectId?: string | null;
};

export type PlanningActionCandidate = {
  itemId: string;
  locationId: string;
  periodId: string;
  type: PlanningActionType;
  suggestedQuantity: number;
  suggestedDate: string;
  /**
   * The date that decides whether this action is inside a planning horizon:
   * the earlier of the target order's current date and `suggestedDate`. A Defer
   * counts from where its order sits today, an Expedite from when it is needed.
   */
  horizonDate: string;
  /**
   * New-supply actions (Order / Make, and the Increase one folds into): the
   * required date less the item's lead time — the last day to place the order.
   */
  latestOrderDate: string | null;
  isASAP: boolean;
  purchaseOrderLineId: string | null;
  jobId: string | null;
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  /** A Borrow carries its payback date (`paybackDueDate`) as a string. */
  triggerValues: Record<string, number | string | null | undefined> | null;
  assignee: string | null;
} & PlanningActionSegment;

export type OpenSupplyOrder = {
  purchaseOrderLineId?: string;
  jobId?: string;
  quantity: number;
  /** the date the order is currently expected to land (ISO) */
  dueDate: string;
  requiresManualAction: boolean;
  /**
   * `dueDate` is the supplier's promise (a PO line's or its delivery's
   * promised date). Apply moves only the required date, which a promise
   * outranks, so a date change on such a line is the planner's to agree with
   * the supplier: Expedite / Defer become "Review on PO".
   */
  dateIsPromised?: boolean;
  supplierId?: string | null;
  /**
   * A PO line's inventory units per purchase unit (`purchaseOrderLine.
   * conversionFactor`). `quantity` is in inventory units; Apply writes the
   * line in whole purchase units. Missing or not positive means 1.
   */
  conversionFactor?: number | null;
  /**
   * When a PLANNED order is due to be released (`releaseByDate`); null or
   * absent once it is past Planned — a Release applies only while it is.
   */
  release?: PlannedOrderRelease | null;
};

export type PlannedOrderRelease = {
  /** The last day to release it: due date − lead time − 1 day. */
  date: string;
  /** The due date and lead time that set it — for a purchase order, those of
   *  the line that needs releasing first. */
  dueDate: string;
  leadTime: number;
};

/** One action of a row before the item, location and assignee are set. */
export type ChangeCandidate = Omit<
  PlanningActionCandidate,
  "itemId" | "locationId" | "assignee"
>;
