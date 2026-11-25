// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An invoice with a posted payment applied cannot be voided: the void would
// leave the settlement standing against a voided invoice. Payment posting
// never writes Paid to the invoice; its status is derived from the
// settlements, so that is what the void must read. An accounting sync does
// write Paid (a bill paid in Xero), and that refuses the void too.

import { expect } from "vitest";
import {
  PURCHASE_INVOICE_SETTLED_VOID_ERROR,
  postPayment,
  postPurchaseInvoice,
  postSalesInvoice,
  SALES_INVOICE_SETTLED_VOID_ERROR
} from "../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  payInvoice,
  postServiceInvoice,
  postSuppliesInvoice,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

/** Pays 30 of the supplies invoice's 60 with a posted disbursement. */
async function payPartOfPurchaseInvoice(f: Fixture, invoiceId: string) {
  const paymentId = `${f.prefix}-disbursement`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("payment")
      .values({
        id: paymentId,
        paymentId: "PAY-2",
        paymentType: "Disbursement",
        supplierId: f.supplierId,
        paymentDate: f.today,
        postingDate: f.today,
        currencyCode: "USD",
        totalAmount: 30,
        exchangeRate: 1,
        bankAccount: f.account("bank"),
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("invoiceSettlement")
      .values({
        paymentId,
        targetPurchaseInvoiceId: invoiceId,
        sourceAmount: 30,
        appliedAmount: 30,
        sourceExchangeRate: 1,
        targetExchangeRate: 1,
        appliedDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "post-payment",
      { type: "post", paymentId },
      postPayment
    )
  );
}

/** A Posted receipt settling the sales invoice with `amounts`, seeded as
 *  posted: the void reads the settlement, not the payment's journal. */
async function seedPostedReceipt(
  f: Fixture,
  invoiceId: string,
  amounts: {
    sourceAmount: number;
    appliedAmount: number;
    writeOffAmount?: number;
  }
) {
  const paymentId = `${f.prefix}-posted-receipt`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("payment")
      .values({
        id: paymentId,
        paymentId: "PAY-3",
        paymentType: "Receipt",
        customerId: f.customerId,
        paymentDate: f.today,
        postingDate: f.today,
        currencyCode: "USD",
        totalAmount: amounts.sourceAmount,
        exchangeRate: 1,
        bankAccount: f.account("bank"),
        status: "Posted",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("invoiceSettlement")
      .values({
        paymentId,
        targetSalesInvoiceId: invoiceId,
        sourceAmount: amounts.sourceAmount,
        appliedAmount: amounts.appliedAmount,
        writeOffAmount: amounts.writeOffAmount ?? 0,
        sourceExchangeRate: 1,
        targetExchangeRate: 1,
        appliedDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}

async function voidSales(f: Fixture, invoiceId: string) {
  return invokePosting(
    handlesOf(f.ctx),
    "post-sales-invoice",
    { type: "void", invoiceId },
    postSalesInvoice
  );
}

async function salesInvoiceStatus(f: Fixture, invoiceId: string) {
  return f.db
    .selectFrom("salesInvoice")
    .select("status")
    .where("id", "=", invoiceId)
    .executeTakeFirstOrThrow();
}

databaseTest("a paid sales invoice's void is refused", async () => {
  const f = await alwaysPostFixture();
  try {
    const invoiceId = await postServiceInvoice(f);
    await payInvoice(f, invoiceId);

    const voided = await invokePosting(
      handlesOf(f.ctx),
      "post-sales-invoice",
      { type: "void", invoiceId },
      postSalesInvoice
    );

    expect(voided.error?.message).toBe(SALES_INVOICE_SETTLED_VOID_ERROR);
    expect(
      await f.db
        .selectFrom("salesInvoices")
        .select("status")
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow()
    ).toEqual({ status: "Paid" });
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a partially paid purchase invoice's void is refused",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await postSuppliesInvoice(f);
      await payPartOfPurchaseInvoice(f, invoiceId);

      const voided = await invokePosting(
        handlesOf(f.ctx),
        "post-purchase-invoice",
        { type: "void", invoiceId },
        postPurchaseInvoice
      );

      expect(voided.error?.message).toBe(PURCHASE_INVOICE_SETTLED_VOID_ERROR);
      expect(
        await f.db
          .selectFrom("purchaseInvoices")
          .select("status")
          .where("id", "=", invoiceId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Partially Paid" });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice settled only by a write-off cannot be voided",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      // No cash applied: the receipt writes the balance off.
      await seedPostedReceipt(f, invoiceId, {
        sourceAmount: 0,
        appliedAmount: 0,
        writeOffAmount: 100
      });

      const voided = await voidSales(f, invoiceId);

      expect(voided.error?.message).toBe(SALES_INVOICE_SETTLED_VOID_ERROR);
      expect(await salesInvoiceStatus(f, invoiceId)).not.toEqual({
        status: "Voided"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales invoice whose settlement the view sums to nothing cannot be voided",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      // The view sums the source amount first, so this settlement counts
      // as 0 there and the invoice reads as neither Paid nor Partially Paid.
      await seedPostedReceipt(f, invoiceId, {
        sourceAmount: 0,
        appliedAmount: 1
      });
      const view = await f.db
        .selectFrom("salesInvoices")
        .select("status")
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(["Paid", "Partially Paid"]).not.toContain(view.status);

      const voided = await voidSales(f, invoiceId);

      expect(voided.error?.message).toBe(SALES_INVOICE_SETTLED_VOID_ERROR);
      expect(await salesInvoiceStatus(f, invoiceId)).not.toEqual({
        status: "Voided"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Credit Note Issued sales invoice with a posted payment cannot be voided",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      await seedPostedReceipt(f, invoiceId, {
        sourceAmount: 100,
        appliedAmount: 100
      });
      // The view shows a base status such as Credit Note Issued as it is,
      // never Paid, whatever settles the invoice.
      await seed(f, (trx) =>
        trx
          .updateTable("salesInvoice")
          .set({ status: "Credit Note Issued" })
          .where("id", "=", invoiceId)
          .execute()
      );

      const voided = await voidSales(f, invoiceId);

      expect(voided.error?.message).toBe(SALES_INVOICE_SETTLED_VOID_ERROR);
      expect(await salesInvoiceStatus(f, invoiceId)).toEqual({
        status: "Credit Note Issued"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a purchase invoice an accounting sync marked Paid cannot be voided",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await postSuppliesInvoice(f);
      // No settlement in Carbon: the bill was paid in the accounting system.
      await seed(f, (trx) =>
        trx
          .updateTable("purchaseInvoice")
          .set({ status: "Paid" })
          .where("id", "=", invoiceId)
          .execute()
      );

      const voided = await invokePosting(
        handlesOf(f.ctx),
        "post-purchase-invoice",
        { type: "void", invoiceId },
        postPurchaseInvoice
      );

      expect(voided.error?.message).toBe(PURCHASE_INVOICE_SETTLED_VOID_ERROR);
      expect(
        await f.db
          .selectFrom("purchaseInvoice")
          .select("status")
          .where("id", "=", invoiceId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Paid" });
    } finally {
      await f.cleanup();
    }
  }
);
