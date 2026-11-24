// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An invoice with a posted payment applied cannot be voided: the void would
// leave the settlement standing against a voided invoice. Payment posting
// never writes Paid to the invoice; its status is derived from the
// settlements, so that is what the void must read.

import { expect } from "vitest";
import {
  postPayment,
  postPurchaseInvoice,
  postSalesInvoice
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

    expect(voided.error).not.toBeNull();
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

      expect(voided.error).not.toBeNull();
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
