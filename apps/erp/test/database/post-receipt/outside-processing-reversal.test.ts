// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What takes an outside processing receipt's journal back or settles it: the
// void, the admin force delete, and the supplier's invoice. Each one must
// leave the WIP and GR/IR accounts as the ledger says, whichever document a
// receipt's journal lines name.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { expect } from "vitest";
import {
  getForceDeleteDocument,
  postPurchaseInvoice,
  reverseDocumentByJournal
} from "../../../app/modules/invoicing/invoicing.service";
import { resolveForceDeleteReversalAccounting } from "../../../app/modules/purchasing/purchasing.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "../fixtures/always-post";
import { databaseTest } from "../fixtures/local-database";
import { operationContext, postgrestTest } from "../fixtures/local-supabase";
import {
  outsideProcessingOrder,
  postReceiptOf,
  receive,
  wipAccount
} from "../fixtures/outside-processing";

/** The balance of one of the fixture's accounts, from the ledger. */
async function balanceOf(
  f: Fixture,
  account: Parameters<Fixture["account"]>[0]
) {
  const row = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.sum<number>("amount").as("balance"))
    .where("companyId", "=", f.companyId)
    .where("accountId", "=", f.account(account))
    .executeTakeFirstOrThrow();
  return row.balance ?? 0;
}

databaseTest(
  "voiding an outside processing receipt takes its cost out of WIP and GR/IR",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Our own operation follows, so the receipt does not complete the job.
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      const receiptId = await receive(f, order.purchaseOrderId, 10);
      expect(await wipAccount(f)).toBe(50);
      expect(await balanceOf(f, "grni")).toBe(50);

      await postReceiptOf(f, receiptId, "void");

      expect(await wipAccount(f)).toBe(0);
      expect(await balanceOf(f, "grni")).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a force delete of an outside processing receipt takes its cost out of WIP and GR/IR",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      const receiptId = await receive(f, order.purchaseOrderId, 10);

      const document = await getForceDeleteDocument(f.db, {
        companyId: f.companyId,
        documentType: "receipt",
        documentId: receiptId
      });
      const reversal = await resolveForceDeleteReversalAccounting(f.db, {
        companyId: f.companyId,
        userId: USER
      });
      await reverseDocumentByJournal(f.db, {
        companyId: f.companyId,
        userId: USER,
        document: document!,
        reversal
      });

      expect(await wipAccount(f)).toBe(0);
      expect(await balanceOf(f, "grni")).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

// The funds gate reads the order through PostgREST.
postgrestTest(
  "the supplier's invoice for an outside processing receipt clears GR/IR",
  async (serviceRole) => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      await receive(f, order.purchaseOrderId, 10);

      const invoiceId = `${f.prefix}-outside-invoice`;
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
            invoiceId: "PI-OUTSIDE",
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
            itemId: f.assemblyId,
            locationId: f.locationId,
            quantity: 10,
            supplierUnitPrice: 5,
            exchangeRate: 1,
            conversionFactor: 1,
            purchaseOrderId: order.purchaseOrderId,
            purchaseOrderLineId: order.lineIds[0],
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      unwrap(
        await invokePosting(
          operationContext(f, serviceRole, USER),
          "post-purchase-invoice",
          { type: "post", invoiceId },
          postPurchaseInvoice
        )
      );

      expect(await balanceOf(f, "grni")).toBe(0);
      expect(await balanceOf(f, "payables")).toBe(50);
      // The invoice is at the receipt's price: the job's cost is unchanged.
      expect(await wipAccount(f)).toBe(50);
    } finally {
      await f.cleanup();
    }
  }
);
