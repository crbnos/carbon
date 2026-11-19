// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Ctx } from "../types.ts";

/**
 * The line triggers that stamp part number display skip a dataset apply
 * (`app.dataset_apply`), so the apply stamps the seeded lines here as those
 * triggers do outside a seed.
 */
const LINE_STAMPS: readonly string[] = [
  // The order's supplier override, else the company default.
  `UPDATE "purchaseOrderLine" pl
   SET "partNumberDisplay" = COALESCE(s."partNumberDisplay", cs."supplierPartNumberDisplay")
   FROM "purchaseOrder" po
   JOIN "supplier" s
     ON s.id = po."supplierId" AND s."companyId" = po."companyId"
   JOIN "companySettings" cs ON cs.id = po."companyId"
   WHERE po.id = pl."purchaseOrderId"
     AND po."companyId" = pl."companyId"
     AND pl."companyId" = $1
     AND pl."partNumberDisplay" IS NULL`,
  // The item's supplier part number for the order's supplier.
  `UPDATE "purchaseOrderLine" pl
   SET "supplierPartId" = sp."supplierPartId"
   FROM "purchaseOrder" po
   JOIN "supplierPart" sp
     ON sp."supplierId" = po."supplierId" AND sp."companyId" = po."companyId"
   WHERE po.id = pl."purchaseOrderId"
     AND po."companyId" = pl."companyId"
     AND sp."itemId" = pl."itemId"
     AND pl."companyId" = $1
     AND pl."supplierPartId" IS NULL
     AND sp."supplierPartId" IS NOT NULL`
];

export async function stampPartNumberDisplay(ctx: Ctx): Promise<void> {
  for (const sql of LINE_STAMPS) {
    await ctx.client.query(sql, [ctx.companyId]);
  }
}
