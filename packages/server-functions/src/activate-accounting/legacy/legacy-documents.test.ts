// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Legacy invoices dated on or after the cutover (spec section 5a). A company
// with no cutover posts a sales invoice and a purchase invoice after the
// cutover date, and their journals are deleted, as the reset deleted them.
// The enable writes them again: line for line what the posting wrote, so the
// receivables, payables and GR/IR carry the invoices, and a payment against
// the sales invoice finds its control line.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../../local-database-test-fixture";
import postPayment from "../../post-payment";
import postPurchaseInvoice from "../../post-purchase-invoice";
import activateAccounting from "..";
import {
  activationFixture,
  type Fixture,
  glBalance,
  pay,
  postServiceInvoice,
  receiveFiveParts,
  USER,
  unwrap
} from "../activation-test-fixture";

const INVOICE_SOURCES = ["Sales Invoice", "Purchase Invoice"] as const;

databaseTest(
  "enabling accounting writes the journals of legacy invoices dated on or after the cutover",
  async () => {
    const f = await activationFixture();
    try {
      // Dimensions the postings write, so the rebuild must write them too.
      await f.db
        .insertInto("dimension")
        .values(
          (["Customer", "Supplier", "Item", "Location"] as const).map(
            (entityType) => ({
              name: entityType,
              entityType,
              companyGroupId: f.groupId,
              createdBy: USER
            })
          )
        )
        .execute();

      // After the cutover date: 5 parts received at 8 and invoiced at 9,
      // with a G/L line of 20; a sales invoice of 100.
      const purchaseOrderLineId = await receiveFiveParts(f, {
        id: "po-1",
        unitPrice: 8
      });
      await postPartAndGlInvoice(f, purchaseOrderLineId);
      const salesInvoiceId = await postServiceInvoice(f);

      // What the postings wrote, then gone, as the reset left them.
      const posted = await invoiceJournals(f);
      expect(posted.map((journal) => journal.sourceType).sort()).toEqual([
        "Purchase Invoice",
        "Sales Invoice"
      ]);
      // Every line carries its party dimension, at least.
      const postedLines = posted.flatMap((journal) => journal.pairs.flat());
      expect(postedLines.length).toBeGreaterThanOrEqual(7);
      for (const line of postedLines) {
        expect(
          line.dimensions.some(
            (dimension) =>
              dimension === `Customer=${f.customerId}` ||
              dimension === `Supplier=${f.supplierId}`
          )
        ).toBe(true);
      }
      await deleteInvoiceJournals(f);
      expect(await invoiceJournals(f)).toEqual([]);

      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();

      const result = unwrap(
        await activateAccounting(f.ctx, {
          cutoverDate: f.cutoverDate,
          confirmation: f.companyName
        })
      );
      expect(result.legacyJournals).toEqual({
        salesInvoices: 1,
        purchaseInvoices: 1
      });

      // The same journals, now Posted.
      const rebuilt = await invoiceJournals(f);
      expect(rebuilt.map(({ status, ...journal }) => journal)).toEqual(
        posted.map(({ status, ...journal }) => journal)
      );
      expect(rebuilt.map((journal) => journal.status)).toEqual([
        "Posted",
        "Posted"
      ]);
      const provisional = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("status", "=", "Provisional")
        .execute();
      expect(provisional).toEqual([]);

      expect(await glBalance(f, "receivables")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "sales")).toBeCloseTo(100, 6);
      // 45 for the parts and 20 for the G/L line.
      expect(await glBalance(f, "payables")).toBeCloseTo(65, 6);
      expect(await glBalance(f, "scrap")).toBeCloseTo(20, 6);
      // The receipt credited 40 and the invoice cleared it.
      expect(await glBalance(f, "grni")).toBeCloseTo(0, 6);
      // Received at 40, written up by the 5 the invoice added to the layer.
      expect(await glBalance(f, "inventory")).toBeCloseTo(45, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);

      // A payment after the enable finds the rebuilt control line.
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, {
            id: "pay-1",
            invoiceId: salesInvoiceId,
            amount: 100
          })
        })
      );
      expect(await glBalance(f, "receivables")).toBeCloseTo(0, 6);
    } finally {
      await f.cleanup();
    }
  }
);

/** Invoices 5 parts at 9 on the PO line and a G/L line of 20. */
async function postPartAndGlInvoice(
  f: Fixture,
  purchaseOrderLineId: string
): Promise<string> {
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
        supplierReference: "SUP-REF-1",
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
      .values([
        {
          invoiceId,
          invoiceLineType: "Part",
          itemId: f.partId,
          purchaseOrderId: `${f.prefix}-po-1`,
          purchaseOrderLineId,
          quantity: 5,
          supplierUnitPrice: 9,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          purchaseUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        },
        {
          invoiceId,
          invoiceLineType: "G/L Account",
          accountId: f.account("scrap"),
          quantity: 1,
          supplierUnitPrice: 20,
          exchangeRate: 1,
          conversionFactor: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/**
 * The company's invoice journals: the header, and each pair of lines (by
 * journal line reference) with its dimensions, in an order that does not
 * depend on ids.
 */
async function invoiceJournals(f: Fixture) {
  const journals = await f.db
    .selectFrom("journal")
    .select(["id", "description", "postingDate", "sourceType", "status"])
    .where("companyId", "=", f.companyId)
    .where("sourceType", "in", [...INVOICE_SOURCES])
    .orderBy("sourceType")
    .execute();
  if (journals.length === 0) return [];
  const lines = await f.db
    .selectFrom("journalLine")
    .select([
      "id",
      "journalId",
      "accountId",
      "accountDefaultRole",
      "description",
      "amount",
      "quantity",
      "accrual",
      "documentType",
      "documentId",
      "documentLineReference",
      "externalDocumentId",
      "intercompanyPartnerId",
      "journalLineReference"
    ])
    .where("companyId", "=", f.companyId)
    .where(
      "journalId",
      "in",
      journals.map((journal) => journal.id)
    )
    .execute();
  const dimensions = await f.db
    .selectFrom("journalLineDimension")
    .innerJoin("dimension", "dimension.id", "journalLineDimension.dimensionId")
    .select([
      "journalLineDimension.journalLineId",
      "dimension.entityType",
      "journalLineDimension.valueId"
    ])
    .where("journalLineDimension.companyId", "=", f.companyId)
    .where(
      "journalLineDimension.journalLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();
  const describe = (line: (typeof lines)[number]) => ({
    accountId: line.accountId,
    accountDefaultRole: line.accountDefaultRole,
    description: line.description,
    amount: Number(line.amount),
    quantity: Number(line.quantity),
    accrual: line.accrual,
    documentType: line.documentType,
    documentId: line.documentId,
    documentLineReference: line.documentLineReference,
    externalDocumentId: line.externalDocumentId,
    intercompanyPartnerId: line.intercompanyPartnerId,
    dimensions: dimensions
      .filter((dimension) => dimension.journalLineId === line.id)
      .map((dimension) => `${dimension.entityType}=${dimension.valueId}`)
      .sort()
  });
  const key = (value: unknown) => JSON.stringify(value);
  return journals.map((journal) => {
    const groups = new Map<string, ReturnType<typeof describe>[]>();
    for (const line of lines) {
      if (line.journalId !== journal.id) continue;
      const group = groups.get(line.journalLineReference) ?? [];
      group.push(describe(line));
      groups.set(line.journalLineReference, group);
    }
    return {
      description: journal.description,
      postingDate: String(journal.postingDate),
      sourceType: journal.sourceType,
      status: journal.status,
      pairs: [...groups.values()]
        .map((group) => group.sort((a, b) => key(a).localeCompare(key(b))))
        .sort((a, b) => key(a).localeCompare(key(b)))
    };
  });
}

/** Deletes the invoice journals, as the reset did. */
async function deleteInvoiceJournals(f: Fixture) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    const journalIds = trx
      .selectFrom("journal")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("sourceType", "in", [...INVOICE_SOURCES]);
    const lineIds = trx
      .selectFrom("journalLine")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("journalId", "in", journalIds);
    await trx
      .deleteFrom("journalLineDimension")
      .where("companyId", "=", f.companyId)
      .where("journalLineId", "in", lineIds)
      .execute();
    await trx
      .deleteFrom("journalLine")
      .where("companyId", "=", f.companyId)
      .where("journalId", "in", journalIds)
      .execute();
    await trx
      .deleteFrom("journal")
      .where("companyId", "=", f.companyId)
      .where("sourceType", "in", [...INVOICE_SOURCES])
      .execute();
  });
}
