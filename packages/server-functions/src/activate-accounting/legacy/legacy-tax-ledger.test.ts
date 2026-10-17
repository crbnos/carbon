// The enable writes the tax ledger of each legacy invoice beside its journal,
// as the posting writes it (.ai/specs/2026-10-16-multi-jurisdiction-tax.md,
// "The tax subledger"): the same rows, now on the rebuilt journal.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../../local-database-test-fixture";
import postPurchaseInvoice from "../../post-purchase-invoice";
import postSalesInvoice from "../../post-sales-invoice";
import activateAccounting from "..";
import {
  activationFixture,
  deleteJournals,
  type Fixture,
  USER,
  unwrap
} from "../activation-test-fixture";

async function taxCode(
  f: Fixture,
  key: string,
  components: Array<{
    name: string;
    taxPercent: number;
    recoverablePercent?: number;
    taxReceivedAccountId?: string;
  }>
): Promise<string> {
  const id = `${f.prefix}-tax-${key}`;
  await f.db
    .insertInto("taxCode")
    .values({ id, name: id, companyId: f.companyId, createdBy: USER })
    .execute();
  await f.db
    .insertInto("taxCodeComponent")
    .values(
      components.map((c, index) => ({
        id: `${id}-${index}`,
        taxCodeId: id,
        name: c.name,
        taxPercent: c.taxPercent,
        recoverablePercent: c.recoverablePercent ?? 0,
        taxReceivedAccountId: c.taxReceivedAccountId ?? null,
        sequence: index + 1,
        companyId: f.companyId,
        createdBy: USER
      }))
    )
    .execute();
  return id;
}

async function ledgerOf(f: Fixture) {
  return f.db
    .selectFrom("taxLedger")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "taxLedger.journalId")
        .onRef("journal.companyId", "=", "taxLedger.companyId")
    )
    .select([
      "taxLedger.documentId",
      "taxLedger.componentName",
      "taxLedger.taxableAmount",
      "taxLedger.taxAmount",
      "taxLedger.recoverableAmount",
      "taxLedger.documentTaxAmount",
      "journal.sourceType"
    ])
    .where("taxLedger.companyId", "=", f.companyId)
    .orderBy("taxLedger.documentId")
    .orderBy("taxLedger.componentName")
    .execute();
}

async function taxLines(f: Fixture) {
  return f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount", "description"])
    .where("companyId", "=", f.companyId)
    .where("description", "in", ["Tax Received", "Tax Paid"])
    .orderBy("description")
    .orderBy("amount")
    .execute();
}

databaseTest(
  "enabling accounting writes the tax ledger of legacy invoices beside their rebuilt journals",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({
          taxReceivedAccount: f.account("grni"),
          taxPaidAccount: f.account("filler")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const salesCode = await taxCode(f, "austin", [
        { name: "TX State", taxPercent: 0.0625 },
        {
          name: "City of Austin",
          taxPercent: 0.02,
          taxReceivedAccountId: f.account("deferred-revenue")
        }
      ]);
      const purchaseCode = await taxCode(f, "uk20", [
        { name: "VAT", taxPercent: 0.2, recoverablePercent: 1 }
      ]);

      const salesInvoiceId = `${f.prefix}-taxed-sale`;
      const purchaseInvoiceId = `${f.prefix}-taxed-bill`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("salesInvoice")
          .values({
            id: salesInvoiceId,
            invoiceId: "INV-TAX",
            customerId: f.customerId,
            currencyCode: "USD",
            exchangeRate: 1,
            status: "Draft",
            postingDate: f.today,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: salesInvoiceId,
            shippingCost: 0,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesInvoiceLine")
          .values({
            invoiceId: salesInvoiceId,
            invoiceLineType: "Service",
            itemId: f.serviceId,
            quantity: 1,
            unitPrice: 1000,
            taxPercent: 0.0825,
            taxCodeId: salesCode,
            exchangeRate: 1,
            unitOfMeasureCode: "EA",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();

        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId: f.supplierId, companyId: f.companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("purchaseInvoice")
          .values({
            id: purchaseInvoiceId,
            invoiceId: "PI-VAT",
            supplierId: f.supplierId,
            supplierInteractionId: interaction.id,
            currencyCode: "USD",
            exchangeRate: 1,
            status: "Draft",
            postingDate: f.today,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseInvoiceDelivery")
          .values({ id: purchaseInvoiceId, companyId: f.companyId })
          .execute();
        await trx
          .insertInto("purchaseInvoiceLine")
          .values({
            invoiceId: purchaseInvoiceId,
            invoiceLineType: "G/L Account",
            accountId: f.account("travel"),
            quantity: 1,
            supplierUnitPrice: 500,
            supplierTaxAmount: 100,
            taxPercent: 0.2,
            taxCodeId: purchaseCode,
            exchangeRate: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      unwrap(
        await postSalesInvoice(f.ctx, {
          type: "post",
          invoiceId: salesInvoiceId
        })
      );
      unwrap(
        await postPurchaseInvoice(f.ctx, {
          type: "post",
          invoiceId: purchaseInvoiceId
        })
      );

      const posted = await ledgerOf(f);
      const postedTaxLines = await taxLines(f);
      expect(
        posted.map((row) => [row.componentName, Number(row.taxAmount)])
      ).toEqual([
        ["VAT", 100],
        ["City of Austin", 20],
        ["TX State", 62.5]
      ]);

      // Gone, as the reset left them.
      await deleteJournals(f, ["Sales Invoice", "Purchase Invoice"]);
      expect(await ledgerOf(f)).toEqual([]);

      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();
      unwrap(
        await activateAccounting(f.ctx, {
          cutoverDate: f.cutoverDate,
          confirmation: f.companyName
        })
      );

      expect(await ledgerOf(f)).toEqual(posted);
      expect(await taxLines(f)).toEqual(postedTaxLines);
    } finally {
      await f.cleanup();
    }
  }
);
