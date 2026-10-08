// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A customer deposit (a receipt naming a rental agreement or sales order) funds
// only invoices that bill its own document. Before this, any later payment of
// the customer drew it in date order — RA000001's deposit paid RA000003's
// invoice. Posting re-derives funding, so these run through the post itself: a
// crafted Draft cannot get past it.
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "./payment-test-fixture";
import { postPaymentTransaction } from "./post-payment-transaction";

async function depositFixture() {
  const f = await paymentFixture();
  const locationId = `${f.companyId}-location`;
  const agreement = (n: number) => `${f.companyId}-ra-${n}`;
  await f.db
    .updateTable("accountDefault")
    .set({ prepaymentAccount: f.account("employee-payable") })
    .where("companyId", "=", f.companyId)
    .execute();
  await f.db
    .insertInto("location")
    .values({
      id: locationId,
      name: "Headquarters",
      addressLine1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      timezone: "America/New_York",
      companyId: f.companyId,
      createdBy: "system"
    })
    .execute();
  await f.db
    .insertInto("rentalAgreement")
    .values(
      [1, 3].map((n) => ({
        id: agreement(n),
        rentalAgreementId: `RA-DEP-${n}`,
        customerId: f.customerId,
        locationId,
        currencyCode: "EUR",
        discountRate: 0,
        startDate: "2026-09-01",
        status: "Active" as const,
        companyId: f.companyId,
        createdBy: "system"
      }))
    )
    .execute();
  /** Make an invoice bill a rental agreement, as a rent line does. */
  const bills = (invoiceId: string, n: number) =>
    f.db
      .updateTable("salesInvoiceLine")
      .set({ rentalAgreementId: agreement(n) })
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", f.companyId)
      .execute();
  /** Make a Draft payment a deposit for a rental agreement. */
  const depositFor = (paymentId: string, n: number) =>
    f.db
      .updateTable("payment")
      .set({ rentalAgreementId: agreement(n) })
      .where("id", "=", paymentId)
      .where("companyId", "=", f.companyId)
      .execute();
  return { ...f, agreement, bills, depositFor };
}

databaseTest(
  "a posted deposit pays only invoices of its own rental agreement",
  async () => {
    const f = await depositFixture();
    try {
      // The fixture's invoice bills RA 3; a second invoice bills RA 1.
      await f.bills(f.invoiceId, 3);
      const ownInvoice = await f.invoice();
      await f.bills(ownInvoice, 1);

      const depositId = await f.payment({ noApplication: true });
      await f.depositFor(depositId, 1);
      await postPaymentTransaction(f.db, { ...f.args, paymentId: depositId });

      // A zero-cash payment for RA 3's invoice has only RA 1's deposit to draw
      // on, which it may not.
      const other = await f.payment({ amount: 0, invoiceId: f.invoiceId });
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId: other })
      ).rejects.toThrow(
        `Insufficient payment funding for target: ${f.invoiceId}`
      );
      const unposted = await f.db
        .selectFrom("payment")
        .select(["status", "journalId"])
        .where("id", "=", other)
        .executeTakeFirstOrThrow();
      expect(unposted).toEqual({ status: "Draft", journalId: null });

      // The same deposit pays RA 1's invoice, released off the prepayment
      // account rather than receivables.
      const own = await f.payment({ amount: 0, invoiceId: ownInvoice });
      const posted = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId: own
      });
      const settlement = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", own)
        .executeTakeFirstOrThrow();
      expect(settlement).toMatchObject({
        targetSalesInvoiceId: ownInvoice,
        sourcePaymentId: depositId,
        sourceAmount: 110,
        appliedAmount: 100
      });
      const prepayment = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("journalId", "=", posted.journalId!)
        .where("accountId", "=", f.account("employee-payable"))
        .execute();
      expect(prepayment.length).toBeGreaterThan(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a deposit payment is refused on another rental agreement's invoice",
  async () => {
    const f = await depositFixture();
    try {
      await f.bills(f.invoiceId, 3);
      const paymentId = await f.payment({ invoiceId: f.invoiceId });
      await f.depositFor(paymentId, 1);
      await expect(
        postPaymentTransaction(f.db, { ...f.args, paymentId })
      ).rejects.toThrow(
        "A deposit for RA-DEP-1 can only be applied to that agreement's invoices"
      );
      // Applied to its own agreement's invoice, it posts.
      await f.bills(f.invoiceId, 1);
      await postPaymentTransaction(f.db, { ...f.args, paymentId });
      const settlement = await f.db
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("paymentId", "=", paymentId)
        .executeTakeFirstOrThrow();
      expect(settlement).toMatchObject({
        sourcePaymentId: null,
        sourceAmount: 110,
        appliedAmount: 100
      });
    } finally {
      await f.cleanup();
    }
  }
);
