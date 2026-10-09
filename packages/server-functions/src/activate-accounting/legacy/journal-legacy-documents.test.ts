// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The repair for a company enabled before the enable wrote the journals of
// legacy documents (spec section 5a). The company enables with nothing to
// journal, then posts after the cutover, and the journals and the shipment's
// "Sale" cost row are taken away again, as an enable that predates step 1a
// left them. `journal-legacy-documents` writes them: Posted, in a period,
// with the shipment costed from the FIFO layers open now.

import type { Database } from "@carbon/database";
import { LEGACY_DOCUMENT_FAMILIES } from "@carbon/database/legacy-documents";
import { formatPeriodLabel } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import journalLegacyDocuments from "../../journal-legacy-documents";
import { findCompaniesWithLegacyDocuments } from "../../journal-legacy-documents/companies";
import { databaseTest } from "../../local-database-test-fixture";
import postPayment from "../../post-payment";
import postPurchaseInvoice from "../../post-purchase-invoice";
import activateAccounting from "..";
import {
  activationFixture,
  type Fixture,
  glBalance,
  journaledFamilies,
  legacyDocumentCounts,
  pay,
  postServiceInvoice,
  receiveFiveParts,
  shipFiveParts,
  USER,
  unwrap
} from "../activation-test-fixture";

type SourceType = Database["public"]["Enums"]["journalEntrySourceType"];

const LEGACY_SOURCES: SourceType[] = [
  "Purchase Receipt",
  "Purchase Invoice",
  "Sales Shipment",
  "Sales Invoice"
];

databaseTest(
  "writing the missing journals after the enable journals legacy documents and relieves the FIFO layers",
  async () => {
    const f = await activationFixture();
    try {
      // Nothing to repair before accounting is set up.
      const notSetUp = await journalLegacyDocuments(f.ctx, {});
      expect(notSetUp.error?.message).toBe("Set up accounting first.");

      // Enabled with no legacy documents.
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

      // After the cutover: 5 parts received at 8 and invoiced at 9, 5 at 12
      // received, 5 shipped (FIFO: the ones at 9), a sales invoice of 100.
      const purchaseOrderLineId = await receiveFiveParts(f, {
        id: "po-1",
        unitPrice: 8
      });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await postPartsInvoice(f, purchaseOrderLineId);
      await shipFiveParts(f);
      const salesInvoiceId = await postServiceInvoice(f);

      // As an enable that predates step 1a left them.
      await forgetJournalsAndSaleCost(f);
      expect(await glBalance(f, "receivables")).toBeCloseTo(0, 6);
      const counted = await legacyDocumentCounts(f);
      expect(counted).toMatchObject({
        salesInvoices: 1,
        purchaseInvoices: 1,
        purchaseReceipts: 2,
        salesShipments: 1
      });

      // The one-off script finds the company, to run as the enabling user.
      expect(
        (await findCompaniesWithLegacyDocuments(f.db)).find(
          (company) => company.companyId === f.companyId
        )
      ).toEqual({
        companyId: f.companyId,
        cutoverDate: f.cutoverDate,
        userId: USER,
        counts: counted
      });

      // A closed period refuses the whole call, and writes nothing.
      await setPeriodCloseStatus(f, "Closed");
      const refused = await journalLegacyDocuments(f.ctx, {});
      expect(refused.error?.message).toBe(
        `The period ${formatPeriodLabel(f.cutoverDate)} is closed. Reopen it, then write the missing journals.`
      );
      expect(await legacyDocumentCounts(f)).toEqual(counted);
      expect(await provisionalJournals(f)).toEqual([]);
      await setPeriodCloseStatus(f, "Open");

      const result = unwrap(await journalLegacyDocuments(f.ctx, {}));
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      // The shipment's "Sale" row.
      expect(result.legacyJournals.movementCostRows).toBe(1);

      // Posted, each in the period of its date.
      const journals = await f.db
        .selectFrom("journal")
        .leftJoin("accountingPeriod as period", (join) =>
          join
            .onRef("period.id", "=", "journal.accountingPeriodId")
            .onRef("period.companyId", "=", "journal.companyId")
        )
        .select([
          "journal.sourceType",
          "journal.status",
          sql<string>`"journal"."postingDate"::text`.as("postingDate"),
          sql<string | null>`"period"."startDate"::text`.as("periodStart"),
          sql<string | null>`"period"."endDate"::text`.as("periodEnd")
        ])
        .where("journal.companyId", "=", f.companyId)
        .where("journal.sourceType", "in", LEGACY_SOURCES)
        .execute();
      expect(journals.map((journal) => journal.sourceType).sort()).toEqual([
        "Purchase Invoice",
        "Purchase Receipt",
        "Purchase Receipt",
        "Sales Invoice",
        "Sales Shipment"
      ]);
      for (const journal of journals) {
        expect(journal.status).toBe("Posted");
        expect(journal.periodStart).not.toBeNull();
        expect(journal.periodStart! <= journal.postingDate).toBe(true);
        expect(journal.periodEnd! >= journal.postingDate).toBe(true);
      }
      expect(await provisionalJournals(f)).toEqual([]);

      expect(await glBalance(f, "receivables")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "sales")).toBeCloseTo(100, 6);
      expect(await glBalance(f, "payables")).toBeCloseTo(45, 6);
      // Received 100, of which the invoice cleared the 40 of po-1.
      expect(await glBalance(f, "grni")).toBeCloseTo(60, 6);

      // The shipment relieved the po-1 layer and its invoice write-up: 5 at 9.
      const sale = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "cost"])
        .where("companyId", "=", f.companyId)
        .where("itemLedgerType", "=", "Sale")
        .executeTakeFirstOrThrow();
      expect([Number(sale.quantity), Number(sale.cost)]).toEqual([-5, -45]);
      expect(await glBalance(f, "cogs")).toBeCloseTo(45, 6);
      const open = await f.db
        .selectFrom("costLedger")
        .select(["adjustment", "remainingQuantity", "cost", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("remainingQuantity", ">", 0)
        .execute();
      expect(
        open.map((row) => [row.adjustment, Number(row.remainingQuantity)])
      ).toEqual([[false, 5]]);
      expect(await openLayersValue(f)).toBeCloseTo(60, 4);
      expect(await glBalance(f, "inventory")).toBeCloseTo(60, 6);

      // A payment against the sales invoice finds its control line.
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

      // Nothing is left to write, and the script no longer finds it.
      expect(
        (await findCompaniesWithLegacyDocuments(f.db)).map(
          (company) => company.companyId
        )
      ).not.toContain(f.companyId);
      const again = unwrap(await journalLegacyDocuments(f.ctx, {}));
      expect(again.legacyJournals).toEqual({
        ...Object.fromEntries(
          LEGACY_DOCUMENT_FAMILIES.map((family) => [family, 0])
        ),
        movementCostRows: 0
      });
      expect(await glBalance(f, "inventory")).toBeCloseTo(60, 6);
    } finally {
      await f.cleanup();
    }
  }
);

/** Invoices the 5 parts of po-1 at 9. */
async function postPartsInvoice(
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
      })
      .execute();
  });
  unwrap(await postPurchaseInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/**
 * Takes away the journals of the documents posted after the enable, and the
 * shipment's "Sale" cost row with its relief of the layers, past the posted
 * journal's immutability.
 */
async function forgetJournalsAndSaleCost(f: Fixture) {
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    const journalIds = trx
      .selectFrom("journal")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("sourceType", "in", LEGACY_SOURCES);
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
      .where("sourceType", "in", LEGACY_SOURCES)
      .execute();
    await trx
      .deleteFrom("costLedger")
      .where("companyId", "=", f.companyId)
      .where("itemLedgerType", "=", "Sale")
      .execute();
    // The layers and the invoice's write-up of po-1, as before the shipment.
    await trx
      .updateTable("costLedger")
      .set({ remainingQuantity: sql`"quantity"` })
      .where("companyId", "=", f.companyId)
      .where("quantity", ">", 0)
      .execute();
  });
}

async function setPeriodCloseStatus(f: Fixture, status: "Open" | "Closed") {
  await f.db
    .updateTable("accountingPeriod")
    .set({
      closeStatus: status,
      closedAt: status === "Closed" ? sql`now()` : null
    })
    .where("companyId", "=", f.companyId)
    .where("startDate", "=", f.cutoverDate)
    .execute();
}

/** The value of the cost layers still open. */
async function openLayersValue(f: Fixture) {
  const row = await f.db
    .selectFrom("costLedger")
    .select(
      sql<number>`coalesce(sum("cost" * "remainingQuantity" / "quantity"), 0)`.as(
        "value"
      )
    )
    .where("companyId", "=", f.companyId)
    .where("remainingQuantity", ">", 0)
    .where("adjustment", "=", false)
    .executeTakeFirstOrThrow();
  return Number(row.value);
}

function provisionalJournals(f: Fixture) {
  return f.db
    .selectFrom("journal")
    .select(["description", "sourceType"])
    .where("companyId", "=", f.companyId)
    .where("status", "=", "Provisional")
    .execute();
}
