// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import {
  postLeaseAction as postLease,
  createLeaseInvoices
} from "../../../app/modules/purchasing/purchasing.service";
import { leaseFixture } from "../fixtures/lease";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";

type Fixture = Awaited<ReturnType<typeof leaseFixture>>;

async function draft(f: Fixture, asOf: string) {
  const result = await invokePosting(
    handlesOf(f.ctx),
    "create-lease-invoices",
    { asOf },
    createLeaseInvoices
  );
  expect(result.error).toBeNull();
  return result.data!;
}

async function payments(f: Fixture) {
  return f.db
    .selectFrom("leasePayment")
    .select(["id", "status", "purchaseInvoiceLineId"])
    .where("leaseId", "=", f.leaseId)
    .orderBy("dueDate")
    .execute();
}

databaseTest(
  "drafts one invoice per due date, once, and never a skipped row",
  async () => {
    const f = await leaseFixture();
    try {
      expect(
        (
          await invokePosting(
            handlesOf(f.ctx),
            "post-lease",
            { type: "activate", leaseId: f.leaseId },
            postLease
          )
        ).error
      ).toBeNull();
      // The first month was paid outside Carbon.
      const [first] = await payments(f);
      await f.db
        .updateTable("leasePayment")
        .set({ status: "Skipped" })
        .where("id", "=", first!.id)
        .execute();

      // Arrears: months 2 and 3 are due by the end of March.
      const result = await draft(f, "2027-03-31");
      expect(result.failures).toEqual([]);
      expect(result.invoices).toHaveLength(2);

      const lines = await f.db
        .selectFrom("purchaseInvoiceLine")
        .innerJoin(
          "purchaseInvoice",
          "purchaseInvoice.id",
          "purchaseInvoiceLine.invoiceId"
        )
        .select([
          "purchaseInvoice.status",
          "purchaseInvoice.dateIssued",
          "purchaseInvoice.supplierId",
          "purchaseInvoiceLine.id",
          "purchaseInvoiceLine.invoiceLineType",
          "purchaseInvoiceLine.leasePaymentId",
          "purchaseInvoiceLine.supplierUnitPrice",
          "purchaseInvoiceLine.description"
        ])
        .where("purchaseInvoiceLine.companyId", "=", f.companyId)
        .orderBy("purchaseInvoice.dateIssued")
        .execute();
      expect(lines).toHaveLength(2);
      expect(lines.map((line) => line.dateIssued)).toEqual([
        "2027-02-28",
        "2027-03-31"
      ]);
      for (const line of lines) {
        expect(line.status).toBe("Draft");
        expect(line.supplierId).toBe(f.supplierId);
        expect(line.invoiceLineType).toBe("Lease");
        expect(Number(line.supplierUnitPrice)).toBe(10000);
      }
      expect(lines[0]!.description).toBe(
        "Forklift FL-12 — 2027-02-01 to 2027-02-28"
      );

      const rows = await payments(f);
      expect(rows[0]!.status).toBe("Skipped");
      expect(rows.slice(1, 3)).toEqual([
        {
          id: lines[0]!.leasePaymentId,
          status: "Invoiced",
          purchaseInvoiceLineId: lines[0]!.id
        },
        {
          id: lines[1]!.leasePaymentId,
          status: "Invoiced",
          purchaseInvoiceLineId: lines[1]!.id
        }
      ]);
      expect(rows[3]!.status).toBe("Pending");

      // A second run for the same day drafts nothing.
      expect((await draft(f, "2027-03-31")).invoices).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Draft lease is never invoiced", async () => {
  const f = await leaseFixture();
  try {
    expect((await draft(f, "2027-03-31")).invoices).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a lease with two assets drafts one invoice per due date with a line per asset",
  async () => {
    const f = await leaseFixture({ assets: [{}, { paymentAmount: 5000 }] });
    try {
      await invokePosting(
        handlesOf(f.ctx),
        "post-lease",
        { type: "activate", leaseId: f.leaseId },
        postLease
      );
      const result = await draft(f, "2027-01-31");
      expect(result.invoices).toHaveLength(1);

      const lines = await f.db
        .selectFrom("purchaseInvoiceLine")
        .select(["description", "supplierUnitPrice"])
        .where("invoiceId", "=", result.invoices[0]!.invoiceId)
        .orderBy("sortOrder")
        .execute();
      expect(lines).toEqual([
        {
          description: "Forklift FL-12 — 2027-01-01 to 2027-01-31",
          supplierUnitPrice: 10000
        },
        {
          description: "Forklift FL-13 — 2027-01-01 to 2027-01-31",
          supplierUnitPrice: 5000
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an open-ended lease's rows roll forward as the invoices are drafted",
  async () => {
    const f = await leaseFixture({ endDate: null });
    try {
      await invokePosting(
        handlesOf(f.ctx),
        "post-lease",
        { type: "activate", leaseId: f.leaseId },
        postLease
      );
      // Set up through 2027-03 (Arrears: the March row is due 2027-03-31).
      expect(await payments(f)).toHaveLength(3);

      const result = await draft(f, "2027-05-10");
      // Due by May 10: January to April.
      expect(result.invoices).toHaveLength(4);
      const rows = await f.db
        .selectFrom("leasePayment")
        .select([
          sql<string>`"periodStart"::text`.as("periodStart"),
          "status",
          "amount"
        ])
        .where("leaseId", "=", f.leaseId)
        .orderBy("periodStart")
        .execute();
      // One period past May: rows through June, whole and unprorated.
      expect(rows.map((row) => row.periodStart)).toEqual([
        "2027-01-01",
        "2027-02-01",
        "2027-03-01",
        "2027-04-01",
        "2027-05-01",
        "2027-06-01"
      ]);
      expect(rows.every((row) => Number(row.amount) === 10000)).toBe(true);
      expect(rows.filter((row) => row.status === "Invoiced")).toHaveLength(4);

      // A second run the same day cuts and drafts nothing.
      expect((await draft(f, "2027-05-10")).invoices).toHaveLength(0);
      expect(await payments(f)).toHaveLength(6);
    } finally {
      await f.cleanup();
    }
  }
);
