// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Invoicing a rental agreement's next periods early, against the live
// database: the preview, the period caps, the charges-only invoice, the
// automation hold, and deleting an early invoice.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { ExpandedClaims } from "@carbon/database/access";
import { RENTAL_HOLD_EARLY_INVOICE } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import { findInvoicesToAutomate } from "../../../../packages/jobs/src/invoicing/automate-invoice";
import { databaseTest } from "./fixtures/local-database";
import {
  localServiceRoleClient,
  postgrestTest
} from "./fixtures/local-supabase";
import { rentalFixture } from "./fixtures/rental";
import * as sales from "../../app/modules/sales/sales.server";
import {
  createRentalInvoices,
  deleteSalesInvoiceReleasingRentals,
  draftEarlyRentalInvoice,
  previewEarlyRentalInvoice,
  RentalEarlyInvoiceRefusal
} from "../../app/modules/sales/sales.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

type RentalFixture = Awaited<ReturnType<typeof rentalFixture>>;

/** The early invoice arguments for the fixture's agreement on 2026-10-05. */
function earlyArgs(
  f: RentalFixture,
  periods: number,
  fromPeriodStart?: string | null
) {
  return {
    companyId: f.companyId,
    userId: "system",
    today: "2026-10-05",
    rentalAgreementId: f.agreementId,
    periods,
    fromPeriodStart,
    canDraftCreditMemo: true
  };
}

/** An early invoice of the fixture's agreement on 2026-10-05. Without a
 *  `fromPeriodStart` it sends the preview's first period, as the dialog does. */
async function earlyInvoice(
  f: RentalFixture,
  periods: number,
  fromPeriodStart?: string | null
) {
  const from =
    fromPeriodStart !== undefined || periods === 0
      ? fromPeriodStart
      : (await previewEarlyRentalInvoice(f.db, earlyArgs(f, periods)))
          .firstPeriodStart;
  return draftEarlyRentalInvoice(f.db, earlyArgs(f, periods, from));
}

/** Every billing period, invoice and charge of the fixture's company, so a
 *  refused call can be shown to have written nothing. */
async function writtenRows(f: RentalFixture) {
  const periods = await f.db
    .selectFrom("rentalBillingPeriod")
    .select(["id", "status", "salesInvoiceLineId"])
    .where("companyId", "=", f.companyId)
    .orderBy("id")
    .execute();
  const invoices = await f.db
    .selectFrom("salesInvoice")
    .select("id")
    .where("companyId", "=", f.companyId)
    .execute();
  const memos = await f.db
    .selectFrom("memo")
    .select("id")
    .where("companyId", "=", f.companyId)
    .execute();
  return { periods, invoices, memos };
}

/** The period starts an invoice's Rent lines bill, in order. */
async function rentStarts(f: RentalFixture, invoiceId: string) {
  const rows = await f.db
    .selectFrom("salesInvoiceLine as sil")
    .innerJoin("rentalBillingPeriod as p", (join) =>
      join
        .onRef("p.id", "=", "sil.rentalBillingPeriodId")
        .onRef("p.companyId", "=", "sil.companyId")
    )
    .select(sql<string>`p."periodStart"::text`.as("periodStart"))
    .where("sil.companyId", "=", f.companyId)
    .where("sil.invoiceId", "=", invoiceId)
    .where("sil.rentalLineType", "=", "Rent")
    .orderBy("p.periodStart")
    .execute();
  return rows.map((row) => row.periodStart);
}

/** Each period of the first unit by start: its status, and whether it is
 *  stamped with an invoice line. */
async function periodStates(f: RentalFixture) {
  const rows = await f.db
    .selectFrom("rentalBillingPeriod")
    .select([
      sql<string>`"periodStart"::text`.as("periodStart"),
      "status",
      "salesInvoiceLineId"
    ])
    .where("companyId", "=", f.companyId)
    .where("rentalAgreementLineId", "=", f.lineIds[0]!)
    .where("isAdjustment", "=", false)
    .orderBy("periodStart")
    .execute();
  return Object.fromEntries(
    rows.map((row) => [
      row.periodStart,
      `${row.status}${row.salesInvoiceLineId ? " (stamped)" : ""}`
    ])
  );
}

databaseTest(
  "an early invoice of a fixed term bills the next periods on one Draft, and the daily run bills only the rest",
  async () => {
    const f = await rentalFixture({ endDate: "2026-12-31" });
    try {
      const drafted = await earlyInvoice(f, 2);
      expect(drafted.invoiceId).not.toBeNull();
      expect(await rentStarts(f, drafted.invoiceId!)).toEqual([
        "2026-10-01",
        "2026-11-01"
      ]);
      expect(await periodStates(f)).toEqual({
        "2026-09-01": "Invoiced",
        "2026-10-01": "Invoiced (stamped)",
        "2026-11-01": "Invoiced (stamped)",
        "2026-12-01": "Pending"
      });

      const daily = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-12-05" },
        createRentalInvoices
      );
      expect(daily.error).toBeNull();
      expect(daily.data!.invoices).toHaveLength(1);
      expect(
        await rentStarts(f, daily.data!.invoices[0]!.invoiceId)
      ).toEqual(["2026-12-01"]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a preview of an early invoice drafts nothing and counts the periods left",
  async () => {
    const f = await rentalFixture({ endDate: "2026-12-31" });
    try {
      const preview = await previewEarlyRentalInvoice(f.db, earlyArgs(f, 1));
      expect(preview.firstPeriodStart).toBe("2026-10-01");
      expect(preview.remainingPeriods).toBe(3);
      expect(preview.lines).toHaveLength(1);
      expect(await periodStates(f)).toEqual({
        "2026-09-01": "Invoiced",
        "2026-10-01": "Pending",
        "2026-11-01": "Pending",
        "2026-12-01": "Pending"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a retried early invoice with the preview's first period is refused, not billed again",
  async () => {
    const f = await rentalFixture({ endDate: "2026-12-31" });
    try {
      const first = await earlyInvoice(f, 1, "2026-10-01");
      expect(await rentStarts(f, first.invoiceId!)).toEqual(["2026-10-01"]);
      await expect(earlyInvoice(f, 1, "2026-10-01")).rejects.toThrow(
        RentalEarlyInvoiceRefusal
      );
      expect(await periodStates(f)).toEqual({
        "2026-09-01": "Invoiced",
        "2026-10-01": "Invoiced (stamped)",
        "2026-11-01": "Pending",
        "2026-12-01": "Pending"
      });
    } finally {
      await f.cleanup();
    }
  }
);

// An API or MCP retry that omits the first period would otherwise bill the
// following periods: drafting periods requires it.
databaseTest(
  "an early invoice of periods without the first period to bill is refused and writes nothing",
  async () => {
    const f = await rentalFixture({ endDate: "2026-12-31" });
    try {
      const before = await writtenRows(f);
      await expect(
        draftEarlyRentalInvoice(f.db, earlyArgs(f, 1))
      ).rejects.toThrow(RentalEarlyInvoiceRefusal);
      await expect(
        draftEarlyRentalInvoice(f.db, earlyArgs(f, 1, null))
      ).rejects.toThrow(RentalEarlyInvoiceRefusal);
      expect(await writtenRows(f)).toEqual(before);
    } finally {
      await f.cleanup();
    }
  }
);

// A unit treated as a sale bills its lease payments on their due dates (the
// daily run), so an early invoice bills only the operating units.
databaseTest(
  "an early invoice bills only the units treated as a rental, never a unit treated as a sale",
  async () => {
    const f = await rentalFixture({ units: 2, endDate: "2026-12-31" });
    try {
      await f.db
        .updateTable("rentalAgreementLine")
        .set({ lessorClassification: "Sale" })
        .where("companyId", "=", f.companyId)
        .where("id", "=", f.lineIds[1]!)
        .execute();

      const drafted = await earlyInvoice(f, 2);
      expect(
        drafted.lines.map((line) => [
          line.serviceStartDate,
          line.rentalAgreementLineId
        ])
      ).toEqual([
        ["2026-10-01", f.lineIds[0]],
        ["2026-11-01", f.lineIds[0]]
      ]);
      const salePeriods = await f.db
        .selectFrom("rentalBillingPeriod")
        .select("status")
        .where("companyId", "=", f.companyId)
        .where("rentalAgreementLineId", "=", f.lineIds[1]!)
        .where("periodStart", ">", "2026-09-01")
        .execute();
      expect(salePeriods.map((row) => row.status)).toEqual([
        "Pending",
        "Pending",
        "Pending"
      ]);

      // The sale unit's three Pending periods do not count as left.
      const preview = await previewEarlyRentalInvoice(f.db, earlyArgs(f, 1));
      expect(preview.remainingPeriods).toBe(1);
      expect(preview.firstPeriodStart).toBe("2026-12-01");
      await expect(earlyInvoice(f, 2, "2026-12-01")).rejects.toThrow(
        "Only 1 periods are left to invoice"
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an early invoice bills the next periods of each unit, in period order",
  async () => {
    const f = await rentalFixture({ units: 2, endDate: "2026-12-31" });
    try {
      const drafted = await earlyInvoice(f, 2);
      // The invoice's own line order, not a sorted read back.
      expect(
        drafted.lines.map((line) => [
          line.serviceStartDate,
          line.rentalAgreementLineId
        ])
      ).toEqual([
        ["2026-10-01", f.lineIds[0]],
        ["2026-10-01", f.lineIds[1]],
        ["2026-11-01", f.lineIds[0]],
        ["2026-11-01", f.lineIds[1]]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a unit with fewer periods left adds what it has, and the most left on a unit caps N",
  async () => {
    const f = await rentalFixture({ units: 2, endDate: "2026-12-31" });
    try {
      // The second unit owes only October: its later periods are billed.
      await f.db
        .updateTable("rentalBillingPeriod")
        .set({ status: "Invoiced" })
        .where("companyId", "=", f.companyId)
        .where("rentalAgreementLineId", "=", f.lineIds[1]!)
        .where("periodStart", ">", "2026-10-01")
        .execute();
      const drafted = await earlyInvoice(f, 3);
      expect(drafted.remainingPeriods).toBe(3);
      expect(await rentStarts(f, drafted.invoiceId!)).toEqual([
        "2026-10-01",
        "2026-10-01",
        "2026-11-01",
        "2026-12-01"
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an open-ended agreement is never invoiced more than 12 periods ahead, counting earlier early invoices",
  async () => {
    const f = await rentalFixture();
    try {
      // October is the current period; November to September are 11 ahead.
      await earlyInvoice(f, 12);
      await expect(earlyInvoice(f, 2)).rejects.toThrow(
        RentalEarlyInvoiceRefusal
      );
      const twelfth = await earlyInvoice(f, 1);
      expect(await rentStarts(f, twelfth.invoiceId!)).toEqual(["2027-10-01"]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a due early-return credit is drafted on its own credit memo, alone when nothing else is due",
  async () => {
    const f = await rentalFixture({ endDate: "2026-11-30" });
    try {
      await earlyInvoice(f, 2);
      const credit = await f.db
        .insertInto("rentalBillingPeriod")
        .values({
          rentalAgreementLineId: f.lineIds[0]!,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          days: 10,
          amount: -100,
          isAdjustment: true,
          dueOn: "2026-10-05",
          status: "Pending",
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const drafted = await earlyInvoice(f, 0);
      expect(drafted.invoiceId).toBeNull();
      expect(drafted.earlyReturnCredit).toBe(100);
      const row = await f.db
        .selectFrom("rentalBillingPeriod")
        .select(["status", "memoId"])
        .where("companyId", "=", f.companyId)
        .where("id", "=", credit.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "Invoiced", memoId: drafted.creditMemoId });
      expect(drafted.creditMemoId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an open-ended agreement is invoiced at most 12 periods ahead, its missing periods cut first",
  async () => {
    const f = await rentalFixture();
    try {
      await expect(earlyInvoice(f, 13)).rejects.toThrow(
        RentalEarlyInvoiceRefusal
      );

      const drafted = await earlyInvoice(f, 6);
      expect(await rentStarts(f, drafted.invoiceId!)).toEqual([
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
        "2027-01-01",
        "2027-02-01",
        "2027-03-01"
      ]);
      expect(drafted.remainingPeriods).toBeNull();
      expect(await periodStates(f)).toEqual({
        "2026-09-01": "Invoiced",
        "2026-10-01": "Invoiced (stamped)",
        "2026-11-01": "Invoiced (stamped)",
        "2026-12-01": "Invoiced (stamped)",
        "2027-01-01": "Invoiced (stamped)",
        "2027-02-01": "Invoiced (stamped)",
        "2027-03-01": "Invoiced (stamped)"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a fixed term refuses more periods than it has left",
  async () => {
    const f = await rentalFixture({ endDate: "2026-12-31" });
    try {
      await expect(earlyInvoice(f, 4)).rejects.toThrow(
        "Only 3 periods are left to invoice"
      );
    } finally {
      await f.cleanup();
    }
  }
);

// Drafted as "system" (as an MCP or API caller is): who drafted it must not
// decide whether the daily automation posts and emails it.
databaseTest(
  "the daily automation leaves an early invoice drafted by the system for a person, and still takes its own draft",
  async () => {
    const f = await rentalFixture({ invoiceAutomation: "Post and Email" });
    try {
      const drafted = await earlyInvoice(f, 1);
      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select(["status", "automationHoldReason", "createdBy", "dateIssued"])
        .where("companyId", "=", f.companyId)
        .where("id", "=", drafted.invoiceId)
        .executeTakeFirstOrThrow();
      expect({ ...invoice, dateIssued: String(invoice.dateIssued) }).toEqual({
        status: "Draft",
        automationHoldReason: RENTAL_HOLD_EARLY_INVOICE,
        createdBy: "system",
        dateIssued: "2026-10-05"
      });
      expect(await findInvoicesToAutomate(f.db, f.companyId)).toEqual([]);

      // November is due on 2026-11-01: the daily run's draft is automated.
      const daily = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-11-05" },
        createRentalInvoices
      );
      expect(daily.error).toBeNull();
      expect(daily.data!.invoices).toHaveLength(1);
      expect(await findInvoicesToAutomate(f.db, f.companyId)).toEqual([
        {
          invoiceId: daily.data!.invoices[0]!.invoiceId,
          sourceId: f.agreementId,
          mode: "Post and Email"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "deleting an early invoice returns its periods to Pending",
  async () => {
    const f = await rentalFixture({ endDate: "2026-12-31" });
    try {
      const drafted = await earlyInvoice(f, 2);
      await deleteSalesInvoiceReleasingRentals(f.db, {
        companyId: f.companyId,
        invoiceId: drafted.invoiceId!,
        userId: "system"
      });
      expect(await periodStates(f)).toEqual({
        "2026-09-01": "Invoiced",
        "2026-10-01": "Pending",
        "2026-11-01": "Pending",
        "2026-12-01": "Pending"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Closed agreement cannot be invoiced early",
  async () => {
    const f = await rentalFixture();
    try {
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .updateTable("rentalAgreement")
          .set({ status: "Closed" })
          .where("id", "=", f.agreementId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await expect(earlyInvoice(f, 1)).rejects.toThrow(
        "Only an active rental agreement can be invoiced"
      );
    } finally {
      await f.cleanup();
    }
  }
);

// The term ends on the daily horizon (2026-11-30 on 2026-10-05): an earlier
// end would get a holdover period cut, so a period would still be left.
databaseTest(
  "with no period left, 0 periods bills the due charges alone",
  async () => {
    const f = await rentalFixture({
      endDate: "2026-11-30",
      charges: [{ chargeDate: "2026-10-03", amount: 50 }]
    });
    try {
      await expect(earlyInvoice(f, 0)).rejects.toThrow(
        "Choose at least one period: periods are still left to invoice"
      );

      const first = await earlyInvoice(f, 2);
      expect(await rentStarts(f, first.invoiceId!)).toEqual([
        "2026-10-01",
        "2026-11-01"
      ]);
      expect(first.lines.map((line) => line.rentalLineType)).toEqual([
        "Rent",
        "Rent",
        "Charge"
      ]);

      const charge = await f.db
        .insertInto("rentalAgreementCharge")
        .values({
          rentalAgreementLineId: f.lineIds[0]!,
          description: "Damage",
          chargeDate: "2026-10-04",
          amount: 80,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const chargesOnly = await earlyInvoice(f, 0);
      expect(
        chargesOnly.lines.map((line) => [
          line.rentalLineType,
          line.rentalAgreementChargeId
        ])
      ).toEqual([["Charge", charge.id]]);
      const stamped = await f.db
        .selectFrom("rentalAgreementCharge as c")
        .innerJoin("salesInvoiceLine as sil", (join) =>
          join
            .onRef("sil.id", "=", "c.salesInvoiceLineId")
            .onRef("sil.companyId", "=", "c.companyId")
        )
        .select("sil.invoiceId")
        .where("c.companyId", "=", f.companyId)
        .where("c.id", "=", charge.id)
        .executeTakeFirstOrThrow();
      expect(stamped.invoiceId).toBe(chargesOnly.invoiceId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with no period left and no charge due, 0 periods is refused",
  async () => {
    const f = await rentalFixture({
      endDate: "2026-11-30",
      charges: [{ chargeDate: "2026-10-20", amount: 50 }]
    });
    try {
      await earlyInvoice(f, 2);
      await expect(earlyInvoice(f, 0)).rejects.toThrow(
        "Nothing is due to invoice on this agreement"
      );
    } finally {
      await f.cleanup();
    }
  }
);

/** A user's context for the fixture's company, holding every action on each
 *  of `pages` and nothing else. */
async function userContext(f: RentalFixture, pages: string[]) {
  const company = await f.db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const client = localServiceRoleClient()!;
  const permissions: ExpandedClaims = Object.fromEntries(
    pages.map((page) => [
      page,
      {
        view: [f.companyId],
        create: [f.companyId],
        update: [f.companyId],
        delete: [f.companyId]
      }
    ])
  );
  return createServiceContext({
    actor: { type: "user", userId: "system", role: "employee", permissions },
    company: { id: f.companyId, groupId: company.companyGroupId ?? "" },
    caller: client as never,
    system: () => client as never,
    pg: () => f.db as never,
    kv: () => {
      throw new Error("No kv in a database test");
    }
  });
}

postgrestTest(
  "an early invoice with an early-return credit due needs permission to create credit memos",
  async () => {
    // Open-ended, so the real "today" the operation reads still starts at
    // the October period and the credit (due 5 October) is due.
    const f = await rentalFixture();
    try {
      await f.db
        .insertInto("rentalBillingPeriod")
        .values({
          rentalAgreementLineId: f.lineIds[0]!,
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          days: 10,
          amount: -100,
          isAdjustment: true,
          dueOn: "2026-10-05",
          status: "Pending",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      const input = {
        rentalAgreementId: f.agreementId,
        periods: 1,
        fromPeriodStart: "2026-10-01"
      };
      const invoicing = ["sales.rentalAgreements", "invoicing.salesInvoices"];

      const before = await writtenRows(f);
      const refused = await sales.invoiceRentalAgreementPeriods(
        await userContext(f, invoicing),
        input
      );
      expect(refused.error?.category).toBe("forbidden");
      expect(await writtenRows(f)).toEqual(before);

      const drafted = await sales.invoiceRentalAgreementPeriods(
        await userContext(f, [...invoicing, "invoicing.creditMemos"]),
        input
      );
      expect(drafted.error).toBeNull();
      expect(drafted.data?.invoiceId).not.toBeNull();
      expect(drafted.data?.creditMemoId).not.toBeNull();
      expect(drafted.data?.earlyReturnCredit).toBe(100);
    } finally {
      await f.cleanup();
    }
  }
);
