// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting and voiding a lessee lease's purchase invoice, against a live
// database: the account each Lease line debits, and the lines it refuses.

import { expect } from "vitest";
import createLeaseInvoices from "../create-lease-invoices";
import { databaseTest } from "../local-database-test-fixture";
import postLease from "../post-lease";
import { leaseFixture } from "../post-lease/lease-test-fixture";
import postPurchaseInvoice from "./index";

type Fixture = Awaited<ReturnType<typeof leaseFixture>>;

async function activate(f: Fixture) {
  const result = await postLease(f.ctx, {
    type: "activate",
    leaseId: f.leaseId
  });
  expect(result.error).toBeNull();
}

/** Drafts the invoices due by `asOf`, in due date order. */
async function draft(f: Fixture, asOf: string): Promise<string[]> {
  const result = await createLeaseInvoices(f.ctx, { asOf });
  expect(result.error).toBeNull();
  expect(result.data!.failures).toEqual([]);
  const invoices = await f.db
    .selectFrom("purchaseInvoice")
    .select("id")
    .where("companyId", "=", f.companyId)
    .where("id", "in", result.data!.invoiceIds)
    .orderBy("dateIssued")
    .execute();
  return invoices.map((invoice) => invoice.id);
}

/** The invoice's Lease lines, with the asset each payment row is for. */
async function leaseLines(f: Fixture, invoiceId: string) {
  return f.db
    .selectFrom("purchaseInvoiceLine as line")
    .leftJoin("leasePayment as p", (join) =>
      join
        .onRef("p.id", "=", "line.leasePaymentId")
        .onRef("p.companyId", "=", "line.companyId")
    )
    .select(["line.id", "line.leasePaymentId", "p.leaseLineId"])
    .where("line.companyId", "=", f.companyId)
    .where("line.invoiceId", "=", invoiceId)
    .orderBy("line.sortOrder")
    .execute();
}

async function post(f: Fixture, invoiceId: string) {
  return postPurchaseInvoice(f.ctx, { type: "post", invoiceId });
}

/** Signed amount per account of the invoice's journal. */
async function journalByAccount(f: Fixture, invoiceId: string) {
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("companyId", "=", f.companyId)
    .where("documentId", "=", invoiceId)
    .execute();
  const byAccount: Record<string, number> = {};
  for (const { accountId, amount } of lines) {
    if (!accountId) continue;
    byAccount[accountId] = (byAccount[accountId] ?? 0) + Number(amount);
  }
  return byAccount;
}

databaseTest(
  "a capitalized payment debits the lease liability with its nominal amount; its tax, shipping and freight go to lease expense",
  async () => {
    // One Operating asset and one Finance asset (36 of a 40-month life).
    const f = await leaseFixture({ assets: [{}, { economicLifeMonths: 40 }] });
    try {
      await activate(f);
      const classifications = await f.db
        .selectFrom("leaseLine")
        .select(["id", "lesseeClassification"])
        .where("leaseId", "=", f.leaseId)
        .orderBy("sortOrder")
        .execute();
      expect(classifications.map((l) => l.lesseeClassification)).toEqual([
        "Operating",
        "Finance"
      ]);

      const [invoiceId] = await draft(f, "2027-01-31");
      // 825 tax and 50 shipping on each line, and 100 of header freight.
      await f.db
        .updateTable("purchaseInvoiceLine")
        .set({ supplierTaxAmount: 825, supplierShippingCost: 50 })
        .where("companyId", "=", f.companyId)
        .where("invoiceId", "=", invoiceId!)
        .execute();
      await f.db
        .updateTable("purchaseInvoiceDelivery")
        .set({ supplierShippingCost: 100 })
        .where("companyId", "=", f.companyId)
        .where("id", "=", invoiceId!)
        .execute();

      expect((await post(f, invoiceId!)).error).toBeNull();

      // Each asset's liability takes the 10,000 its schedule took out; the
      // 875 of tax and shipping per line and the 100 of freight are expense.
      // AP owes the whole 21,850.
      expect(await journalByAccount(f, invoiceId!)).toEqual({
        [f.accounts.liability]: -20000,
        [f.accounts.opex]: 1850,
        [f.accounts.other]: 21850
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a short-term payment and a variable charge debit their expense in full",
  async () => {
    // Twelve months: Short-Term.
    const f = await leaseFixture({ endDate: "2027-12-31" });
    try {
      // The variable charge's own account, to tell it from the short-term
      // payment's.
      await f.db
        .updateTable("accountDefault")
        .set({ variableLeaseExpenseAccount: f.accounts.amortization })
        .where("companyId", "=", f.companyId)
        .execute();
      await activate(f);
      const [invoiceId] = await draft(f, "2027-01-31");
      const [rent] = await leaseLines(f, invoiceId!);
      await f.db
        .updateTable("purchaseInvoiceLine")
        .set({ supplierTaxAmount: 100 })
        .where("companyId", "=", f.companyId)
        .where("id", "=", rent!.id)
        .execute();
      const lease = await f.db
        .selectFrom("lease")
        .select("locationId")
        .where("id", "=", f.leaseId)
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId: invoiceId!,
          invoiceLineType: "Lease",
          leaseId: f.leaseId,
          locationId: lease.locationId,
          description: "Maintenance",
          quantity: 1,
          supplierUnitPrice: 250,
          supplierShippingCost: 0,
          supplierTaxAmount: 0,
          taxPercent: 0,
          exchangeRate: 1,
          sortOrder: 2,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      expect((await post(f, invoiceId!)).error).toBeNull();

      expect(await journalByAccount(f, invoiceId!)).toEqual({
        [f.accounts.opex]: 10100,
        [f.accounts.amortization]: 250,
        [f.accounts.other]: 10350
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a capitalized payment is refused at another amount, compared in base currency",
  async () => {
    const f = await leaseFixture();
    try {
      await activate(f);
      const [invoiceId] = await draft(f, "2027-01-31");
      const [line] = await leaseLines(f, invoiceId!);
      const setLine = (values: {
        supplierUnitPrice?: number;
        exchangeRate?: number;
      }) =>
        f.db
          .updateTable("purchaseInvoiceLine")
          .set(values)
          .where("companyId", "=", f.companyId)
          .where("id", "=", line!.id)
          .execute();
      const refusal = "line must be 10000, its payment's amount";

      await setLine({ supplierUnitPrice: 9000 });
      expect((await post(f, invoiceId!)).error?.message).toContain(refusal);

      // 10,000 at 2 per base unit is 5,000 in base: the liability would be
      // relieved by half the payment.
      await setLine({ supplierUnitPrice: 10000, exchangeRate: 2 });
      expect((await post(f, invoiceId!)).error?.message).toContain(refusal);

      expect(await journalByAccount(f, invoiceId!)).toEqual({});
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Draft or Cancelled lease's line is refused", async () => {
  const f = await leaseFixture();
  try {
    await activate(f);
    const [invoiceId] = await draft(f, "2027-01-31");
    const setStatus = (status: "Draft" | "Cancelled") =>
      f.db
        .updateTable("lease")
        .set({ status })
        .where("companyId", "=", f.companyId)
        .where("id", "=", f.leaseId)
        .execute();

    await setStatus("Draft");
    expect((await post(f, invoiceId!)).error?.message).toBe(
      "Activate the lease before invoicing it"
    );
    await setStatus("Cancelled");
    expect((await post(f, invoiceId!)).error?.message).toBe(
      "The lease is cancelled; remove its line from this invoice"
    );
    expect(await journalByAccount(f, invoiceId!)).toEqual({});
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a line naming a payment row another invoice line bills is refused",
  async () => {
    const f = await leaseFixture();
    try {
      await activate(f);
      const [january, february] = await draft(f, "2027-02-28");
      const [januaryLine] = await leaseLines(f, january!);
      const [februaryLine] = await leaseLines(f, february!);
      // February's line now names January's row, which January's line bills.
      await f.db
        .updateTable("purchaseInvoiceLine")
        .set({ leasePaymentId: januaryLine!.leasePaymentId })
        .where("companyId", "=", f.companyId)
        .where("id", "=", februaryLine!.id)
        .execute();

      expect((await post(f, february!)).error?.message).toContain(
        "payment is billed by another invoice line"
      );
      expect(await journalByAccount(f, february!)).toEqual({});
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("voiding the invoice returns its rows to Pending", async () => {
  const f = await leaseFixture();
  try {
    await activate(f);
    const [invoiceId] = await draft(f, "2027-01-31");
    const [line] = await leaseLines(f, invoiceId!);
    expect((await post(f, invoiceId!)).error).toBeNull();

    expect(
      (
        await postPurchaseInvoice(f.ctx, {
          type: "void",
          invoiceId: invoiceId!
        })
      ).error
    ).toBeNull();

    const row = await f.db
      .selectFrom("leasePayment")
      .select(["status", "purchaseInvoiceLineId", "voidedPurchaseInvoiceId"])
      .where("companyId", "=", f.companyId)
      .where("id", "=", line!.leasePaymentId!)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      status: "Pending",
      purchaseInvoiceLineId: null,
      voidedPurchaseInvoiceId: invoiceId
    });
    // The void reverses the journal: the liability is back where it was.
    expect((await journalByAccount(f, invoiceId!))[f.accounts.liability]).toBe(
      0
    );
  } finally {
    await f.cleanup();
  }
});
