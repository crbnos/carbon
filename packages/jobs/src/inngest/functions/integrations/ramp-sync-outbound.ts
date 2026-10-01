// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Outbound reconciliation candidates for a spend platform (Ramp today).
 *
 * Lives beside `ramp-sync.ts` rather than inside it for two reasons: the package
 * convention is that `ramp-sync.ts` stays the durable coordinator only, and the
 * Inngest-function module validates the server env at import time, which would
 * make this unit-testable only through a booted environment.
 *
 * Scope, never decisions. `computeReconcileDecision` and the syncers' own
 * `shouldSync` remain the deciders; this module answers "which rows should we
 * even look at", gated on the provider's OWN sync config exactly as the
 * accounting outbound sweep gates its bill and invoice walks.
 */

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { SyncProvider } from "@carbon/ee/accounting";
import { today } from "@internationalized/date";
import {
  getSweepFloorDate,
  SWEPT_BILL_STATUSES
} from "./accounting-sync-operations";
import type { ReconcileRef } from "./reconcile";

/** Page size and bound for the outbound candidate walk — the accounting sweep's. */
export const OUTBOUND_PAGE_SIZE = 200;
export const OUTBOUND_MAX_PAGES = 25;
/** Refs per `reconcileEntities` call — bounds the executor's `.in()` lists. */
export const OUTBOUND_RECONCILE_BATCH_SIZE = 200;

/**
 * Purchase-order statuses that are structurally never pushable, used to keep a
 * company's draft backlog out of an hourly walk.
 *
 * This is a BOUNDING superset, not the eligibility rule — that stays in
 * `packages/ee/src/spend/gates.ts` and runs in the syncer's `shouldSync`. Stated
 * as an exclusion of unreleased states rather than an enumeration of pushable
 * ones so the drift is safe in the direction that matters: a new pushable status
 * added upstream is not in this list, so it is still reconciled and the syncer
 * still decides. `reconcileMasterData` has no parked-disposition guard — it
 * enqueues whenever a row is unmapped — so without this every Draft order would
 * mint a Skipped ledger row every hour.
 */
const UNRELEASED_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "Needs Approval",
  "To Review",
  "Rejected",
  "Planned"
] as const;

/**
 * One ascending, offset-paged walk of a candidate table from the window floor —
 * the accounting sweep's `pageIds`, narrowed to the two tables Ramp pushes.
 */
async function pageOutboundIds(args: {
  client: ReturnType<typeof getCarbonServiceRole>;
  companyId: string;
  table: "purchaseOrder" | "purchaseInvoice";
  dateColumn: string;
  floor: string;
  statuses?: readonly string[];
  excludeStatuses?: readonly string[];
}): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;

  for (let page = 0; page < OUTBOUND_MAX_PAGES; page++) {
    // `any` matches the accounting sweep's `pageIds`: the PostgREST builder's
    // type changes shape with every conditional filter.
    let query: any = args.client
      .from(args.table)
      .select("id")
      .eq("companyId", args.companyId)
      .gte(args.dateColumn, args.floor);
    if (args.statuses) query = query.in("status", args.statuses);
    if (args.excludeStatuses) {
      query = query.not(
        "status",
        "in",
        `(${args.excludeStatuses.map((status) => `"${status}"`).join(",")})`
      );
    }

    const result = await query
      .order("id", { ascending: true })
      .range(offset, offset + OUTBOUND_PAGE_SIZE - 1);

    if (result.error) {
      throw new Error(
        `Failed to page ${args.table} for the Ramp outbound reconcile: ${result.error.message}`
      );
    }
    const rows = (result.data ?? []) as Array<{ id: string }>;
    ids.push(...rows.map((row) => row.id));
    if (rows.length < OUTBOUND_PAGE_SIZE) break;
    offset += OUTBOUND_PAGE_SIZE;
  }

  return ids;
}

export type RampOutboundCandidates = {
  refs: ReconcileRef[];
  scanned: { purchaseOrders: number; invoices: number };
  skippedReasons: string[];
};

/**
 * Candidate outbound refs for one company — scope, never decisions.
 *
 * Gated per entity on the provider's OWN config, exactly as the accounting
 * sweep gates its bill/invoice walks, so `pushPurchaseOrders` / `pushInvoices`
 * and the install mode's ceiling are honoured before a single row is read.
 * Eligibility beyond that belongs to `computeReconcileDecision` and the syncer.
 */
export async function loadRampOutboundCandidates(args: {
  client: ReturnType<typeof getCarbonServiceRole>;
  companyId: string;
  provider: Pick<SyncProvider, "getSyncConfig">;
  /** The window's "today". Defaults to UTC, matching the accounting sweep. */
  todayIso?: string;
}): Promise<RampOutboundCandidates> {
  const todayIso = args.todayIso ?? today("UTC").toString();
  const refs: ReconcileRef[] = [];
  const scanned = { purchaseOrders: 0, invoices: 0 };
  const skippedReasons: string[] = [];

  const purchaseOrderConfig = args.provider.getSyncConfig("purchaseOrder");
  if (
    purchaseOrderConfig?.enabled &&
    purchaseOrderConfig.direction !== "pull-from-accounting"
  ) {
    const ids = await pageOutboundIds({
      client: args.client,
      companyId: args.companyId,
      table: "purchaseOrder",
      dateColumn: "updatedAt",
      floor: getSweepFloorDate({
        todayIso,
        syncFromDate: purchaseOrderConfig.syncFromDate
      }),
      excludeStatuses: UNRELEASED_PURCHASE_ORDER_STATUSES
    });
    scanned.purchaseOrders = ids.length;
    refs.push(
      ...ids.map(
        (id): ReconcileRef => ({ entityType: "purchaseOrder", entityId: id })
      )
    );
  } else {
    skippedReasons.push("purchase orders: push disabled");
  }

  const billConfig = args.provider.getSyncConfig("bill");
  if (billConfig?.enabled && billConfig.direction !== "pull-from-accounting") {
    const ids = await pageOutboundIds({
      client: args.client,
      companyId: args.companyId,
      table: "purchaseInvoice",
      dateColumn: "postingDate",
      floor: getSweepFloorDate({
        todayIso,
        syncFromDate: billConfig.syncFromDate
      }),
      statuses: SWEPT_BILL_STATUSES
    });
    scanned.invoices = ids.length;
    refs.push(
      ...ids.map((id): ReconcileRef => ({ entityType: "bill", entityId: id }))
    );
  } else {
    skippedReasons.push("invoices: push disabled");
  }

  return { refs, scanned, skippedReasons };
}
