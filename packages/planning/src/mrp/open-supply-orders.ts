// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The open supply the change actions target: every open purchase order line
// and job, as `OpenSupplyOrder`s per item, location and netting segment.
// Pure: no I/O. The planning worklist (`generatePlanningActions`) calls
// `buildOpenSupplyOrders` with the rows it loads; the MRP engine can call it
// with rows it loads itself, and gets the same orders.

import type { Database } from "@carbon/database";
import { COMMON_SEGMENT, KEY_SEP } from "@carbon/database/mrp-engine";
import { parseDate } from "@internationalized/date";
import type {
  OpenSupplyOrder,
  PlannedOrderRelease
} from "./planning-action-types.ts";
import { daysBetween } from "./row-sizing.ts";
import {
  jobCompletionDate,
  purchaseOrderLineArrivalDate
} from "./supply-date.ts";

type PurchaseOrderStatus = Database["public"]["Enums"]["purchaseOrderStatus"];
type JobStatus = Database["public"]["Enums"]["jobStatus"];

/** The columns read from one `openPurchaseOrderLines` row. */
export type OpenPurchaseOrderLineRow = {
  id: string | null;
  purchaseOrderId: string | null;
  itemId: string | null;
  locationId: string | null;
  planningSegmentId: string | null;
  status: PurchaseOrderStatus | null;
  quantityToReceive: number | null;
  promisedDate: string | null;
  dueDate: string | null;
  orderDate: string | null;
  leadTime: number | null;
  supplierId: string | null;
};

/** The columns read from one `openProductionOrders` row. */
export type OpenProductionOrderRow = {
  id: string | null;
  itemId: string | null;
  locationId: string | null;
  planningSegmentId: string | null;
  quantityToReceive: number | null;
  dueDate: string | null;
  deadlineType: Database["public"]["Enums"]["deadlineType"] | null;
  leadTime: number | null;
};

/** A job's status, which the view does not expose. */
export type OpenJobDetails = {
  status: JobStatus;
};

/** The map key of an item at a location in one netting segment. */
export function itemLocationSegmentKey(
  itemId: string,
  locationId: string,
  segmentId: string = COMMON_SEGMENT
): string {
  return itemId + KEY_SEP + locationId + KEY_SEP + segmentId;
}

/**
 * The view only yields open POs ('Planned' | 'To Receive' | 'To Receive and
 * Invoice'); anything past 'Planned'/'Draft' has been sent to the supplier
 * (mirrors PURCHASE_ORDER_LOCKED_STATUSES in purchasing.models.ts). Never gate
 * on orderDate — insertPurchaseOrder defaults it to today for planned POs.
 */
export function isCommittedPurchaseOrderStatus(
  status: PurchaseOrderStatus | null | undefined
): boolean {
  return status !== "Planned" && status !== "Draft";
}

/** Job statuses at/after release-to-floor are committed supply. */
export function isCommittedJobStatus(
  status: JobStatus | null | undefined
): boolean {
  return status === "Ready" || status === "In Progress" || status === "Paused";
}

/**
 * The last day to release a planned order so it still arrives on time: its
 * due date less the item's lead time, less one more day. Due in 8 days with a
 * 7-day lead time is today.
 */
export function releaseByDate(dueDate: string, leadTimeDays: number): string {
  return parseDate(dueDate)
    .subtract({ days: Math.max(leadTimeDays, 0) + 1 })
    .toString();
}

/** The earlier of two releases (a purchase order is released once, for the
 *  line that needs it first). */
export function earlierRelease(
  a: PlannedOrderRelease | null | undefined,
  b: PlannedOrderRelease
): PlannedOrderRelease {
  // daysBetween(a, b) is a − b
  return a && daysBetween(a.date, b.date) <= 0 ? a : b;
}

/**
 * The open purchase order lines and jobs as `OpenSupplyOrder`s, keyed by
 * `itemLocationSegmentKey`, in row order. Each order is dated where the
 * projection buckets it (`supply-date.ts`). A Planned order carries its
 * release; a committed one requires manual action.
 */
export function buildOpenSupplyOrders(args: {
  poLineRows: OpenPurchaseOrderLineRow[];
  jobRows: OpenProductionOrderRow[];
  jobDetailsById: Map<string, OpenJobDetails>;
  /** Inventory units per purchase unit; a line not in the map is 1. */
  conversionFactorByLineId: Map<string, number>;
  todayDate: string;
}): Map<string, OpenSupplyOrder[]> {
  const {
    poLineRows,
    jobRows,
    jobDetailsById,
    conversionFactorByLineId,
    todayDate
  } = args;

  const openOrdersByItemLocation = new Map<string, OpenSupplyOrder[]>();
  const pushOrder = (key: string, order: OpenSupplyOrder) => {
    const list = openOrdersByItemLocation.get(key) ?? [];
    list.push(order);
    openOrdersByItemLocation.set(key, list);
  };
  // A Planned purchase order is released once, for whichever of its lines
  // needs it first — every line's Release carries that date.
  const releaseByPurchaseOrder = new Map<string, PlannedOrderRelease>();
  for (const line of poLineRows) {
    if (line.status !== "Planned" || !line.purchaseOrderId) continue;
    if ((Number(line.quantityToReceive) || 0) <= 0) continue;
    const dueDate = purchaseOrderLineArrivalDate(line, todayDate);
    const leadTime = Number(line.leadTime) || 0;
    releaseByPurchaseOrder.set(
      line.purchaseOrderId,
      earlierRelease(releaseByPurchaseOrder.get(line.purchaseOrderId), {
        date: releaseByDate(dueDate, leadTime),
        dueDate,
        leadTime
      })
    );
  }

  for (const line of poLineRows) {
    if (!line.id || !line.itemId || !line.locationId) continue;
    const quantity = Number(line.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    // the same arrival date the projection buckets this line on
    const dueDate = purchaseOrderLineArrivalDate(line, todayDate);
    pushOrder(
      itemLocationSegmentKey(
        line.itemId,
        line.locationId,
        line.planningSegmentId || COMMON_SEGMENT
      ),
      {
        purchaseOrderLineId: line.id,
        quantity,
        dueDate,
        requiresManualAction: isCommittedPurchaseOrderStatus(line.status),
        dateIsPromised: Boolean(line.promisedDate),
        supplierId: line.supplierId,
        conversionFactor: conversionFactorByLineId.get(line.id) ?? 1,
        release:
          line.status === "Planned" && line.purchaseOrderId
            ? (releaseByPurchaseOrder.get(line.purchaseOrderId) ?? null)
            : null
      }
    );
  }
  for (const job of jobRows) {
    if (!job.id || !job.itemId || !job.locationId) continue;
    const details = jobDetailsById.get(job.id);
    // Good units left (the view leaves out the scrap allowance), the units a
    // change action applies to `job.quantity` in.
    const quantity = Number(job.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    // the same date the projection buckets this job on — an undated job is
    // supply there, so it is supply here too
    const dueDate = jobCompletionDate(job, todayDate);
    const leadTime = Number(job.leadTime) || 0;
    pushOrder(
      itemLocationSegmentKey(
        job.itemId,
        job.locationId,
        job.planningSegmentId || COMMON_SEGMENT
      ),
      {
        jobId: job.id,
        quantity,
        dueDate,
        requiresManualAction: isCommittedJobStatus(details?.status),
        release:
          details?.status === "Planned"
            ? { date: releaseByDate(dueDate, leadTime), dueDate, leadTime }
            : null
      }
    );
  }
  return openOrdersByItemLocation;
}
