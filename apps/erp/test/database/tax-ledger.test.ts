// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting a document with a tax code writes the tax ledger beside its journal
// (.ai/specs/2026-10-16-multi-jurisdiction-tax.md, "The tax subledger"), and a
// void negates those rows.

import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  journalLinesOf,
  newJournals,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import {
  postPurchaseInvoice,
  postSalesInvoice
} from "~/modules/invoicing/invoicing.service";
import { invokePosting } from "~/modules/shared/shared.service";

/** A tax code with its components; the tax accounts point at real leaves. */
async function taxCode(
  f: Fixture,
  key: string,
  components: Array<{
    name: string;
    taxPercent: number;
    recoverablePercent?: number;
  }>
): Promise<string> {
  const id = `${f.prefix}-tax-${key}`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("accountDefault")
      .set({
        taxReceivedAccount: f.account("grni"),
        taxPaidAccount: f.account("filler")
      })
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("taxCode")
      .values({ id, name: id, companyId: f.companyId, createdBy: USER })
      .execute();
    await trx
      .insertInto("taxCodeComponent")
      .values(
        components.map((c, index) => ({
          id: `${id}-${index}`,
          taxCodeId: id,
          name: c.name,
          taxPercent: c.taxPercent,
          recoverablePercent: c.recoverablePercent ?? 0,
          sequence: index + 1,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return id;
}

async function ledgerOf(f: Fixture, documentId: string) {
  return f.db
    .selectFrom("taxLedger")
    .select([
      "componentName",
      "taxableAmount",
      "taxAmount",
      "recoverableAmount",
      "journalId"
    ])
    .where("companyId", "=", f.companyId)
    .where("documentId", "=", documentId)
    .orderBy("createdAt")
    .orderBy("componentName")
    .execute();
}

databaseTest(
  "a sales invoice with a two-component code posts a tax leg and a ledger row per component, and its void nets them to zero",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const code = await taxCode(f, "austin", [
        { name: "TX State", taxPercent: 0.0625 },
        { name: "City of Austin", taxPercent: 0.02 }
      ]);
      const invoiceId = `${f.prefix}-sales-invoice`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("salesInvoice")
          .values({
            id: invoiceId,
            invoiceId: "INV-TAX",
            customerId: f.customerId,
            currencyCode: "USD",
            exchangeRate: 1,
            status: "Draft",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesInvoiceShipment")
          .values({
            id: invoiceId,
            shippingCost: 0,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("salesInvoiceLine")
          .values({
            invoiceId,
            invoiceLineType: "Service",
            itemId: f.serviceId,
            quantity: 1,
            unitPrice: 1000,
            taxPercent: 0.0825,
            taxCodeId: code,
            exchangeRate: 1,
            unitOfMeasureCode: "EA",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const journals = await newJournals(f, async () =>
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-sales-invoice",
            { type: "post", invoiceId },
            postSalesInvoice
          )
        )
      );
      const lines = await journalLinesOf(f, journals);
      expect(
        lines
          .filter((line) => line.accountId === f.account("grni"))
          .map((line) => line.amount)
          .sort()
      ).toEqual([20, 62.5]);

      const posted = await ledgerOf(f, invoiceId);
      expect(
        posted.map((r) => [r.componentName, r.taxableAmount, r.taxAmount])
      ).toEqual([
        ["City of Austin", 1000, 20],
        ["TX State", 1000, 62.5]
      ]);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-sales-invoice",
          { type: "void", invoiceId },
          postSalesInvoice
        )
      );
      const all = await ledgerOf(f, invoiceId);
      expect(all).toHaveLength(4);
      expect(all.reduce((t, r) => t + Number(r.taxAmount), 0)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a purchase invoice with recoverable VAT debits Tax Paid, keeps cost net and records the recoverable share",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const code = await taxCode(f, "uk20", [
        { name: "VAT", taxPercent: 0.2, recoverablePercent: 1 }
      ]);
      const invoiceId = `${f.prefix}-purchase-invoice-vat`;
      await seed(f, async (trx) => {
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId: f.supplierId, companyId: f.companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("purchaseInvoice")
          .values({
            id: invoiceId,
            invoiceId: "PI-VAT",
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
            invoiceLineType: "G/L Account",
            accountId: f.account("supplies"),
            quantity: 1,
            supplierUnitPrice: 1000,
            supplierTaxAmount: 200,
            taxPercent: 0.2,
            taxCodeId: code,
            exchangeRate: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      const journals = await newJournals(f, async () =>
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-purchase-invoice",
            { type: "post", invoiceId },
            postPurchaseInvoice
          )
        )
      );
      const lines = await journalLinesOf(f, journals);
      const amountOn = (name: "supplies" | "filler" | "payables") =>
        lines
          .filter((line) => line.accountId === f.account(name))
          .reduce((t, line) => t + Number(line.amount), 0);
      expect(amountOn("supplies")).toBe(1000);
      expect(amountOn("filler")).toBe(200);
      expect(amountOn("payables")).toBe(1200);

      const [row] = await ledgerOf(f, invoiceId);
      expect(row).toMatchObject({ taxAmount: 200, recoverableAmount: 200 });
    } finally {
      await f.cleanup();
    }
  }
);
