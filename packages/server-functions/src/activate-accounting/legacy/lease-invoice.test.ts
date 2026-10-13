// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A legacy purchase invoice's Lease line is journaled as `post-purchase-invoice`
// posts it (`resolveLeasePostingLine`): the liability takes the nominal
// payment, and a line the posting would refuse is refused here too.

import { expect } from "vitest";
import createLeaseInvoices from "../../create-lease-invoices";
import { databaseTest } from "../../local-database-test-fixture";
import postLease from "../../post-lease";
import { leaseFixture } from "../../post-lease/lease-test-fixture";
import { buildLegacyPurchaseInvoiceJournals } from "./purchase-invoice";

type Fixture = Awaited<ReturnType<typeof leaseFixture>>;

/** Drafts the invoices due by `asOf` and marks them posted with no journal,
 *  as an invoice posted before accounting was enabled. */
async function legacyInvoices(f: Fixture, asOf: string): Promise<string[]> {
  expect(
    (await postLease(f.ctx, { type: "activate", leaseId: f.leaseId })).error
  ).toBeNull();
  const drafted = await createLeaseInvoices(f.ctx, { asOf });
  expect(drafted.data?.failures).toEqual([]);
  const invoiceIds = drafted.data!.invoiceIds;
  await f.db
    .updateTable("purchaseInvoice")
    .set({ status: "Open", postingDate: asOf })
    .where("companyId", "=", f.companyId)
    .where("id", "in", invoiceIds)
    .execute();
  const invoices = await f.db
    .selectFrom("purchaseInvoice")
    .select("id")
    .where("companyId", "=", f.companyId)
    .where("id", "in", invoiceIds)
    .orderBy("dateIssued")
    .execute();
  return invoices.map((invoice) => invoice.id);
}

async function build(f: Fixture) {
  const company = await f.db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const defaults = await f.db
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return f.db.transaction().execute((trx) =>
    buildLegacyPurchaseInvoiceJournals(trx, {
      companyId: f.companyId,
      companyGroupId: company.companyGroupId!,
      cutoverDate: "2026-01-01",
      defaults
    })
  );
}

databaseTest(
  "a legacy capitalized lease line debits the liability with the nominal payment and its tax to lease expense",
  async () => {
    const f = await leaseFixture();
    try {
      const [invoiceId] = await legacyInvoices(f, "2027-01-31");
      await f.db
        .updateTable("purchaseInvoiceLine")
        .set({ supplierTaxAmount: 825 })
        .where("companyId", "=", f.companyId)
        .where("invoiceId", "=", invoiceId!)
        .execute();

      const [journal] = await build(f);
      expect(
        journal!.lines.map(({ accountId, amount }) => ({ accountId, amount }))
      ).toEqual([
        { accountId: f.accounts.liability, amount: -10000 },
        { accountId: f.accounts.opex, amount: 825 },
        { accountId: f.accounts.other, amount: 10825 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a legacy lease line naming a payment row another line bills is refused",
  async () => {
    const f = await leaseFixture();
    try {
      const [january, february] = await legacyInvoices(f, "2027-02-28");
      const lineOf = (invoiceId: string) =>
        f.db
          .selectFrom("purchaseInvoiceLine")
          .select(["id", "leasePaymentId"])
          .where("companyId", "=", f.companyId)
          .where("invoiceId", "=", invoiceId)
          .executeTakeFirstOrThrow();
      const januaryLine = await lineOf(january!);
      const februaryLine = await lineOf(february!);
      await f.db
        .updateTable("purchaseInvoiceLine")
        .set({ leasePaymentId: januaryLine.leasePaymentId })
        .where("companyId", "=", f.companyId)
        .where("id", "=", februaryLine.id)
        .execute();

      await expect(build(f)).rejects.toThrow(
        "payment is billed by another invoice line"
      );
    } finally {
      await f.cleanup();
    }
  }
);
