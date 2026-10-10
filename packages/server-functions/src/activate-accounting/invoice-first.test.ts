// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Invoice-first purchasing across the accounting enable. A purchase invoice
// posted before the cutover for parts not yet received accrues GR/IR on
// `purchase-invoice:<poLineId>`. The enable supersedes that journal, so the
// opening journal must carry the accrual, or a receipt after the cutover
// costs the parts at PO cost and GR/IR keeps the difference.

import {
  getCutoverInventory,
  getMigrationClearing,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import { databaseTest } from "../local-database-test-fixture";
import postPurchaseInvoice from "../post-purchase-invoice";
import postReceipt from "../post-receipt";
import activateAccounting from ".";
import {
  activationFixture,
  type Fixture,
  glBalance,
  moveBeforeCutover,
  USER,
  unwrap
} from "./activation-test-fixture";

/** A purchase order for 5 parts at `unitPrice`; returns its line id. */
async function orderFiveParts(f: Fixture, unitPrice: number) {
  const purchaseOrderId = `${f.prefix}-po`;
  const line = await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-1",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: purchaseOrderId,
        locationId: f.locationId,
        companyId: f.companyId
      })
      .execute();
    return trx
      .insertInto("purchaseOrderLine")
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: 5,
        supplierUnitPrice: unitPrice,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
  return { purchaseOrderId, purchaseOrderLineId: line.id };
}

/** Invoices the 5 ordered parts at `unitPrice`, none of them received. */
async function invoiceFiveParts(
  f: Fixture,
  order: { purchaseOrderId: string; purchaseOrderLineId: string },
  unitPrice: number
) {
  const invoiceId = `${f.prefix}-purchase-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: invoiceId,
        invoiceId: "PI-1",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({ id: invoiceId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("purchaseInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Part",
        itemId: f.partId,
        purchaseOrderId: order.purchaseOrderId,
        purchaseOrderLineId: order.purchaseOrderLineId,
        quantity: 5,
        supplierUnitPrice: unitPrice,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

databaseTest(
  "a receipt after the enable clears the GR/IR accrual of an invoice posted before it, at the invoice's cost",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: 5 parts ordered at 8 and invoiced at 9, none
      // received. The invoice accrues 45 on GR/IR.
      const order = await orderFiveParts(f, 8);
      const invoiceId = await invoiceFiveParts(f, order, 9);
      await moveBeforeCutover(f);
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .updateTable("purchaseInvoice")
          .set({ postingDate: f.beforeCutover, dateIssued: f.beforeCutover })
          .where("companyId", "=", f.companyId)
          .where("id", "=", invoiceId)
          .execute();
      });

      // The prior system's trial balance: the payable and the accrual.
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      expect(await getCutoverInventory(f.db, args)).toEqual([]);
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("grni"), debit: 45, credit: 0 },
          { accountId: f.account("payables"), debit: 0, credit: 45 }
        ]
      });

      // Carbon opens the accrual on GR/IR, so GR/IR ties at 45.
      const reference = `purchase-invoice:${order.purchaseOrderLineId}`;
      const clearing = await getMigrationClearing(f.db, args);
      expect(
        clearing.items.filter(
          (item) => item.openItemType === "Invoiced Not Received"
        )
      ).toEqual([
        expect.objectContaining({
          accountId: f.account("grni"),
          amount: -45,
          documentLineReference: reference,
          description: "GR/IR Clearing",
          quantity: 5,
          accrual: true
        })
      ]);
      expect(
        clearing.rows.find((row) => row.accountId === f.account("grni"))
      ).toMatchObject({ trialBalance: 45, carbon: 45, difference: 0 });
      expect(clearing.total).toBe(0);

      unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );

      // The opening journal's accrual line, keyed as the invoice wrote it.
      const accrualLines = await f.db
        .selectFrom("journalLine as line")
        .innerJoin("journal", (join) =>
          join
            .onRef("journal.id", "=", "line.journalId")
            .onRef("journal.companyId", "=", "line.companyId")
        )
        .select(["line.amount", "line.quantity", "journal.sourceType"])
        .where("line.companyId", "=", f.companyId)
        .where("line.accountId", "=", f.account("grni"))
        .where("line.documentLineReference", "=", reference)
        .where("line.accrual", "=", true)
        .where("journal.status", "=", "Posted")
        .execute();
      expect(accrualLines).toEqual([
        { amount: -45, quantity: 5, sourceType: "Opening Balance" }
      ]);
      expect(await glBalance(f, "grni")).toBeCloseTo(-45, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);

      // After the cutover: the 5 parts arrive. The receipt costs them at
      // the accrual (9), not the PO price (8), and clears the accrual.
      const receipt = unwrap(
        await create(f.ctx, {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId: order.purchaseOrderId,
          locationId: f.locationId
        })
      );
      unwrap(await postReceipt(f.ctx, { type: "post", receiptId: receipt.id }));

      const layer = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", receipt.id)
        .executeTakeFirstOrThrow();
      expect(Number(layer.quantity)).toBe(5);
      expect(Number(layer.cost)).toBeCloseTo(45, 6);
      expect(await glBalance(f, "grni")).toBeCloseTo(0, 6);
      expect(await glBalance(f, "inventory")).toBeCloseTo(45, 6);
      expect(await glBalance(f, "payables")).toBeCloseTo(45, 6);
    } finally {
      await f.cleanup();
    }
  }
);
