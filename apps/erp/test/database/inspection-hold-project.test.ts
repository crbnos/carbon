// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { postReceipt as postReceiptBody } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { USER } from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { projectPostingFixture } from "./fixtures/project-posting";

databaseTest(
  "a line its project consumes at receipt opens no inspection lot and needs no held unit",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const charged = await f.addItem("inspected", {
        itemTrackingType: "Inventory"
      });
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        const document = await trx
          .insertInto("inspectionDocument")
          .values({
            partId: charged.itemId,
            companyId: f.companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("itemInspectionDocumentAssignment")
          .values({
            itemId: charged.itemId,
            usage: "Receipt",
            inspectionDocumentId: document.id,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      const po = await f.addPurchaseOrder("a", {
        locationId,
        lines: [
          { itemId: charged.itemId, quantity: 4, unitPrice: 10, charged: true }
        ]
      });
      const receipt = await f.addReceipt("a", {
        locationId,
        purchaseOrderId: po.purchaseOrderId,
        supplierId: po.supplierId,
        lines: [
          {
            lineId: po.lineIds[0]!,
            itemId: charged.itemId,
            quantity: 4,
            unitPrice: 10
          }
        ]
      });

      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { receiptId: receipt.receiptId },
        postReceiptBody
      );
      expect(posted.error).toBeNull();

      const lots = await f.db
        .selectFrom("inspection")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceDocumentId", "=", receipt.receiptId)
        .execute();
      expect(lots).toEqual([]);
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["documentType", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", charged.itemId)
        .orderBy("quantity", "desc")
        .execute();
      expect(
        ledger.map((row) => [row.documentType, Number(row.quantity)])
      ).toEqual([
        ["Purchase Receipt", 4],
        ["Project Issue", -4]
      ]);
    } finally {
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .deleteFrom("itemInspectionDocumentAssignment")
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .deleteFrom("inspectionDocument")
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await f.cleanup();
    }
  }
);
