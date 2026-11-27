// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// MRP v2 Phase 2a: the reads of planned-order planning (`PlannedOrderInputs`)
// that `runMrp` does beside its other inputs. The planned orders themselves
// come from the run's snapshot (`readPlannedOrderSnapshot`).

import type { DB } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { buildOpenSupplyOrders } from "./open-supply-orders.ts";
import type {
  ExistingPlannedOrder,
  PlannedOrderInputs
} from "./planned-orders.ts";
import { loadOpenSupplyDetails } from "./planning-actions.ts";
import { planningPolicyRowOf } from "./row-sizing.ts";

/**
 * MRP v2: what `planCompany` needs to plan the common segment with planned
 * orders (`PlannedOrderInputs`). Kysely reads, so no PostgREST row cap.
 *
 * - The policy rows join `itemPlanning`, `item` and `itemReplenishment` with
 *   INNER JOINs, as the planning RPCs do: an item with no `itemPlanning` row
 *   at a location has no planning row there and gets no planned order.
 * - The open jobs and PO lines are the views `runMrp` already read, built
 *   into orders by `buildOpenSupplyOrders` as the planning actions build them.
 * - The existing planned orders are the run's snapshot
 *   (`readPlannedOrderSnapshot` with `withOrders`), read before every other
 *   input.
 * - The scrap rate is every item's (`replenishments`), planning row or not:
 *   job creation adds an item's scrap whatever its planning rows, and the
 *   explosion sizes as job creation does.
 */
export async function loadPlannedOrderInputs(
  db: Kysely<DB>,
  args: {
    companyId: string;
    todayDate: string;
    locations: { id: string; planningTimeFenceDays: number | null }[];
    plannedOrderRows: ExistingPlannedOrder[];
    replenishments: { itemId: string; scrapPercentage: number | null }[];
    productionLines: Parameters<typeof buildOpenSupplyOrders>[0]["jobRows"];
    purchaseOrderLines: Parameters<
      typeof buildOpenSupplyOrders
    >[0]["poLineRows"];
  }
): Promise<PlannedOrderInputs> {
  const { companyId } = args;
  const [policyRows, settings, openSupplyDetails] = await Promise.all([
    db
      .selectFrom("itemPlanning as ip")
      .innerJoin("item as i", (join) =>
        join.onRef("i.id", "=", "ip.itemId").on("i.companyId", "=", companyId)
      )
      .innerJoin("itemReplenishment as ir", (join) =>
        join
          .onRef("ir.itemId", "=", "ip.itemId")
          .on("ir.companyId", "=", companyId)
      )
      .select([
        "ip.itemId",
        "ip.locationId",
        "i.active",
        "i.itemTrackingType",
        "i.replenishmentSystem",
        "ip.reorderingPolicy",
        "ip.reorderPoint",
        "ip.reorderQuantity",
        "ip.minimumOrderQuantity",
        "ip.maximumOrderQuantity",
        "ip.orderMultiple",
        "ip.maximumInventoryQuantity",
        "ip.demandAccumulationPeriod",
        "ip.demandAccumulationSafetyStock",
        "ip.planningTimeFenceDays",
        "ir.lotSize",
        "ir.leadTime",
        "ir.preferredSupplierId"
      ])
      .where("ip.companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("companySettings")
      .select(["rescheduleToleranceDays"])
      .where("id", "=", companyId)
      .executeTakeFirst(),
    loadOpenSupplyDetails(db, companyId)
  ]);

  const scrapRateByItem = new Map<string, number>();
  for (const row of args.replenishments) {
    scrapRateByItem.set(row.itemId, Number(row.scrapPercentage) || 0);
  }
  const preferredSupplierByItem = new Map<string, string | null>();
  for (const row of policyRows) {
    preferredSupplierByItem.set(row.itemId, row.preferredSupplierId ?? null);
  }

  return {
    planningPolicies: policyRows.map((row) => ({
      ...planningPolicyRowOf(row),
      itemId: row.itemId,
      locationId: row.locationId,
      active: row.active,
      itemTrackingType: row.itemTrackingType,
      replenishmentSystem: row.replenishmentSystem,
      reorderingPolicy: row.reorderingPolicy,
      planningTimeFenceDays:
        row.planningTimeFenceDays === null ||
        row.planningTimeFenceDays === undefined
          ? null
          : Number(row.planningTimeFenceDays)
    })),
    locationTimeFenceDays: new Map(
      args.locations.map((location) => [
        location.id,
        Number(location.planningTimeFenceDays) || 0
      ])
    ),
    scrapRateByItem,
    preferredSupplierByItem,
    openSupplyOrders: buildOpenSupplyOrders({
      poLineRows: args.purchaseOrderLines,
      jobRows: args.productionLines,
      jobDetailsById: openSupplyDetails.jobDetailsById,
      conversionFactorByLineId: openSupplyDetails.conversionFactorByLineId,
      todayDate: args.todayDate
    }),
    existingPlannedOrders: args.plannedOrderRows,
    toleranceDays: Number(settings?.rescheduleToleranceDays ?? 7)
  };
}
