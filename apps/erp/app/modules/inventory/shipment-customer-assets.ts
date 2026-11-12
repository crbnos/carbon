// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A shipped serial is a customer asset: whose it is, where it is, and its
// warranty. Spec: .ai/specs/2026-10-22-service-jobs-and-returns.md (decision 15).

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { sql, type Transaction } from "kysely";

/**
 * Creates one customer asset per shipped serial, in one statement. The
 * warranty ends `shippedDate` + the item's `laborWarrantyMonths` and
 * `partsWarrantyMonths` (null without months). A serial that is already an
 * asset is a new sale: it moves to the new customer and site, and its ship
 * date, shipment and warranty dates start again.
 */
export async function upsertShippedCustomerAssets(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    shipmentId: string;
    trackedEntityIds: string[];
    customerId: string;
    customerLocationId: string | null;
    /** YYYY-MM-DD, the company's today. */
    shippedDate: string;
  }
): Promise<void> {
  const ids = [...new Set(args.trackedEntityIds)];
  if (ids.length === 0) return;

  // Postgres adds months as a calendar does: Jan 31 + 1 month is Feb 28.
  await sql`
    INSERT INTO "customerAsset" (
      "trackedEntityId", "itemId", "customerId", "customerLocationId",
      "status", "shippedDate", "laborWarrantyEndDate", "partsWarrantyEndDate",
      "shipmentId", "source", "companyId", "createdBy"
    )
    SELECT te."id", te."itemId", ${args.customerId}, ${args.customerLocationId},
      'In Service', ${args.shippedDate}::date,
      CASE WHEN price."laborWarrantyMonths" IS NULL THEN NULL
        ELSE (${args.shippedDate}::date + make_interval(months => price."laborWarrantyMonths"))::date END,
      CASE WHEN price."partsWarrantyMonths" IS NULL THEN NULL
        ELSE (${args.shippedDate}::date + make_interval(months => price."partsWarrantyMonths"))::date END,
      ${args.shipmentId}, 'Shipment', te."companyId", ${args.userId}
    FROM "trackedEntity" te
    LEFT JOIN LATERAL (
      SELECT p."laborWarrantyMonths", p."partsWarrantyMonths"
      FROM "itemUnitSalePrice" p
      WHERE p."itemId" = te."itemId" AND p."companyId" = te."companyId"
      ORDER BY p."createdAt"
      LIMIT 1
    ) price ON TRUE
    WHERE te."id" IN (${sql.join(ids)})
      AND te."companyId" = ${args.companyId}
      AND te."itemId" IS NOT NULL
    ON CONFLICT ("trackedEntityId", "companyId") DO UPDATE SET
      "customerId" = EXCLUDED."customerId",
      "customerLocationId" = EXCLUDED."customerLocationId",
      "status" = 'In Service',
      "shippedDate" = EXCLUDED."shippedDate",
      "laborWarrantyEndDate" = EXCLUDED."laborWarrantyEndDate",
      "partsWarrantyEndDate" = EXCLUDED."partsWarrantyEndDate",
      "shipmentId" = EXCLUDED."shipmentId",
      "updatedBy" = ${args.userId},
      "updatedAt" = NOW()
  `.execute(trx);
}
