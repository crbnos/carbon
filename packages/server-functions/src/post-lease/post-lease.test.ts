// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { holdInDraftRun } from "../propose-revenue-recognition-run/run-test-fixture";
import postLease from "./index";
import { leaseFixture, postScheduleThrough } from "./lease-test-fixture";

type Fixture = Awaited<ReturnType<typeof leaseFixture>>;

async function run(
  f: Fixture,
  payload: Parameters<typeof postLease>[1]
): Promise<{ error: unknown }> {
  const result = await postLease(f.ctx, payload);
  return { error: result.error };
}

async function lease(f: Fixture) {
  return f.db
    .selectFrom("lease")
    .selectAll()
    .where("id", "=", f.leaseId)
    .executeTakeFirstOrThrow();
}

async function asset(f: Fixture, index = 0) {
  return f.db
    .selectFrom("leaseLine")
    .selectAll()
    .where("id", "=", f.lineIds[index]!)
    .executeTakeFirstOrThrow();
}

async function scheduleLines(f: Fixture, index?: number) {
  let query = f.db
    .selectFrom("leaseScheduleLine")
    .select([
      sql<string>`"periodDate"::text`.as("periodDate"),
      "interestAmount",
      "principalAmount",
      "closingLiability",
      "rouAmortization"
    ])
    .where("leaseId", "=", f.leaseId);
  if (index !== undefined) {
    query = query.where("leaseLineId", "=", f.lineIds[index]!);
  }
  return query.orderBy("periodDate").execute();
}

async function event(f: Fixture, eventType: string) {
  return f.db
    .selectFrom("leaseEvent")
    .selectAll()
    .where("leaseId", "=", f.leaseId)
    .where("eventType", "=", eventType as "Modification")
    .executeTakeFirstOrThrow();
}

async function leaseJournals(f: Fixture) {
  return f.db
    .selectFrom("journal")
    .innerJoin("journalLine", "journalLine.journalId", "journal.id")
    .select([
      "journal.description",
      "journal.status",
      "journalLine.accountId",
      "journalLine.amount"
    ])
    .where("journal.companyId", "=", f.companyId)
    .where("journal.sourceType", "=", "Lease")
    .orderBy("journal.journalEntryId")
    .orderBy("journalLine.accountId")
    .execute();
}

databaseTest(
  "activating the worked example books the liability and writes the schedule",
  async () => {
    const f = await leaseFixture();
    try {
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();

      expect((await lease(f)).status).toBe("Active");
      const row = await asset(f);
      expect(row.lesseeClassification).toBe("Operating");
      expect(Number(row.initialLiability)).toBeCloseTo(328710.16, 2);

      const journal = await leaseJournals(f);
      expect(journal).toHaveLength(2);
      expect(journal.every((line) => line.status === "Posted")).toBe(true);
      const amounts = Object.fromEntries(
        journal.map((line) => [line.accountId, Number(line.amount)])
      );
      expect(amounts[f.accounts.rou]).toBeCloseTo(328710.16, 2);
      expect(amounts[f.accounts.liability]).toBeCloseTo(328710.16, 2);

      const lines = await scheduleLines(f);
      expect(lines).toHaveLength(36);
      expect(lines[0]!.periodDate).toBe("2027-01-31");
      expect(Number(lines[0]!.interestAmount)).toBeCloseTo(1643.55, 2);
      expect(Number(lines[0]!.closingLiability)).toBeCloseTo(320353.71, 2);
      expect(Number(lines[35]!.closingLiability)).toBe(0);

      const rows = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select(["type", "status", "debitAccountId", "creditAccountId"])
        .where("leaseId", "=", f.leaseId)
        .execute();
      expect(rows).toHaveLength(72);
      expect(rows.every((r) => r.status === "Planned")).toBe(true);
      expect(
        rows.every((r) =>
          r.type === "Interest"
            ? r.debitAccountId === f.accounts.opex &&
              r.creditAccountId === f.accounts.liability
            : r.debitAccountId === f.accounts.opex &&
              r.creditAccountId === f.accounts.accumulated
        )
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a lease whose PV is substantially all of the fair value is a finance lease",
  async () => {
    const f = await leaseFixture({ fairValue: 340000 });
    try {
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await asset(f)).lesseeClassification).toBe("Finance");
      const lines = await scheduleLines(f);
      expect(Number(lines[0]!.rouAmortization)).toBeCloseTo(9130.84, 2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a 12-month lease activates Short-Term with no journal and no schedule",
  async () => {
    const f = await leaseFixture({ endDate: "2027-12-31" });
    try {
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await asset(f)).lesseeClassification).toBe("Short-Term");
      expect((await lease(f)).commencementJournalId).toBeNull();
      expect(await leaseJournals(f)).toHaveLength(0);
      expect(await scheduleLines(f)).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "cancelling an untouched active lease voids its commencement journal",
  async () => {
    const f = await leaseFixture();
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      expect(
        (await run(f, { type: "cancel", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Cancelled");
      expect(await scheduleLines(f)).toHaveLength(0);
      const journal = await leaseJournals(f);
      expect(journal).toHaveLength(4);
      const net = journal.reduce((sum, line) => sum + Number(line.amount), 0);
      expect(net).toBeCloseTo(0, 5);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "modify remeasures from the effective month and keeps posted months",
  async () => {
    const f = await leaseFixture();
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      const before = await scheduleLines(f);

      // Month 13 is not posted yet: refused.
      const unposted = await run(f, {
        type: "modify",
        leaseId: f.leaseId,
        effectiveDate: "2028-01-01",
        endDate: "2030-12-31",
        discountRate: 7,
        paymentFrequency: "Monthly",
        annualEscalationPercent: 0
      });
      expect(unposted.error).not.toBeNull();

      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2027-12-31"
      });
      expect(
        (
          await run(f, {
            type: "modify",
            leaseId: f.leaseId,
            effectiveDate: "2028-01-01",
            endDate: "2030-12-31",
            discountRate: 7,
            paymentFrequency: "Monthly",
            annualEscalationPercent: 0
          })
        ).error
      ).toBeNull();

      const after = await scheduleLines(f);
      expect(after).toHaveLength(48);
      // The posted year is untouched.
      expect(after.slice(0, 12)).toEqual(before.slice(0, 12));
      expect(Number(after[47]!.closingLiability)).toBe(0);
      expect((await lease(f)).endDate).toBe("2030-12-31");

      const modification = await event(f, "Modification");
      expect(modification.leaseLineId).toBe(f.lineIds[0]);
      expect(Number(modification.liabilityBefore)).toBeCloseTo(
        Number(before[11]!.closingLiability),
        5
      );
      expect(Number(modification.liabilityAfter)).toBeGreaterThan(
        Number(modification.liabilityBefore)
      );
      expect(modification.journalId).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "modify is refused while a draft lease run holds a later row",
  async () => {
    const f = await leaseFixture();
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2027-12-31"
      });
      const held = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("id")
        .where("leaseId", "=", f.leaseId)
        .where("scheduledDate", "=", "2028-01-31")
        .execute();
      await holdInDraftRun(
        f.db,
        f.companyId,
        held.map((row) => row.id),
        "2028-01-31",
        "Lease"
      );
      const result = await run(f, {
        type: "modify",
        leaseId: f.leaseId,
        effectiveDate: "2028-01-01",
        endDate: "2030-12-31",
        discountRate: 7,
        paymentFrequency: "Monthly",
        annualEscalationPercent: 0
      });
      expect(String((result.error as Error)?.message)).toContain("LR-TEST");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "terminate derecognizes the lease and leaves the penalty to invoice",
  async () => {
    const f = await leaseFixture();
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2028-12-31"
      });
      expect(
        (
          await run(f, {
            type: "terminate",
            leaseId: f.leaseId,
            leaseLineId: f.lineIds[0]!,
            terminationDate: "2028-12-31",
            penaltyAmount: 5000
          })
        ).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Terminated");
      expect((await asset(f)).status).toBe("Terminated");
      const kept = await scheduleLines(f);
      expect(kept).toHaveLength(24);

      // Derecognized at the balances the schedule reaches on the date: the
      // liability less the penalty, the ROU asset at cost and its
      // amortization; the difference is the loss.
      const carrying = Number(kept[23]!.closingLiability);
      const accumulated = kept.reduce(
        (sum, line) => sum + Number(line.rouAmortization),
        0
      );
      const cost = 328710.16;
      const gainLoss = carrying - 5000 - (cost - accumulated);
      const termination = await event(f, "Termination");
      expect(Number(termination.liabilityBefore)).toBeCloseTo(carrying, 2);
      expect(Number(termination.gainLoss)).toBeCloseTo(gainLoss, 2);
      expect(gainLoss).toBeLessThan(0);
      const journal = (await leaseJournals(f)).filter((line) =>
        line.description?.startsWith("Lease Termination")
      );
      const amounts = Object.fromEntries(
        journal.map((line) => [line.accountId, Number(line.amount)])
      );
      // A debit to the Liability-class account stores negative; a debit to
      // the Asset-class accumulated account positive.
      expect(amounts[f.accounts.liability]).toBeCloseTo(-(carrying - 5000), 2);
      expect(amounts[f.accounts.accumulated]).toBeCloseTo(accumulated, 2);
      expect(amounts[f.accounts.rou]).toBeCloseTo(-cost, 2);
      expect(amounts[f.accounts.loss]).toBeCloseTo(-gainLoss, 2);
      expect(journal).toHaveLength(4);
      const payments = await f.db
        .selectFrom("leasePayment")
        .select(["paymentType", "amount"])
        .where("leaseId", "=", f.leaseId)
        .where(sql`"dueDate"`, ">", sql`'2028-12-30'`)
        .execute();
      expect(payments).toEqual(
        expect.arrayContaining([
          { paymentType: "Termination Penalty", amount: 5000 }
        ])
      );
      expect(payments.some((p) => p.paymentType === "Rent")).toBe(true);
      expect(payments).toHaveLength(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "purchase moves the right-of-use asset into a new fixed asset",
  async () => {
    const f = await leaseFixture({
      purchaseOptionAmount: 20000,
      purchaseOptionReasonablyCertain: true,
      economicLifeMonths: 84
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      expect((await asset(f)).lesseeClassification).toBe("Finance");
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2029-12-31"
      });
      expect(
        (
          await run(f, {
            type: "purchase",
            leaseId: f.leaseId,
            leaseLineId: f.lineIds[0]!,
            exerciseDate: "2029-12-31",
            purchasePrice: 20000,
            fixedAssetClassId: f.assetClassId,
            name: "Forklift FL-12"
          })
        ).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Purchased");
      const row = await asset(f);
      expect(row.status).toBe("Purchased");
      const fixedAsset = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost", "status"])
        .where("id", "=", row.fixedAssetId!)
        .executeTakeFirstOrThrow();
      expect(fixedAsset.status).toBe("Active");
      // The schedule already paid the option out of the liability, so the
      // price replaces it: the asset costs the net ROU after 36 of 84 months.
      expect(Number(fixedAsset.acquisitionCost)).toBeCloseTo(
        345423.06 - (345423.06 / 84) * 36,
        0
      );
      const options = await f.db
        .selectFrom("leasePayment")
        .select(["amount"])
        .where("leaseLineId", "=", f.lineIds[0]!)
        .where("paymentType", "=", "Purchase Option")
        .execute();
      expect(options).toEqual([{ amount: 20000 }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a lease that started before the cutover opens with its balances on the cutover and the earlier months posted",
  async () => {
    // A finance lease: front-loaded interest plus straight-line amortization
    // costs more than the payments early on, so the opening equity differs.
    // (An operating lease's straight-line cost equals its payments, so its
    // retained earnings line is zero and is not written.)
    const f = await leaseFixture({ fairValue: 340000 });
    try {
      // Accounting was set up six months into the lease.
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: "2027-07-01" })
        .where("id", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("accountDefault")
        .set({ retainedEarningsAccount: f.accounts.gain })
        .where("companyId", "=", f.companyId)
        .execute();

      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();

      const lines = await scheduleLines(f);
      expect(lines).toHaveLength(36);
      const before = lines.slice(0, 6);
      expect(before.at(-1)!.periodDate).toBe("2027-06-30");
      const carrying = Number(before.at(-1)!.closingLiability);
      const accumulated = before.reduce(
        (sum, line) => sum + Number(line.rouAmortization),
        0
      );

      const rows = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select([
          sql<string>`"scheduledDate"::text`.as("scheduledDate"),
          "status",
          "journalId"
        ])
        .where("leaseId", "=", f.leaseId)
        .execute();
      for (const row of rows) {
        expect(row.status).toBe(
          row.scheduledDate < "2027-07-01" ? "Posted" : "Planned"
        );
        expect(row.journalId).toBeNull();
      }

      // The opening months are on the books, so their lines carry postedAt
      // (the leases view and the lease page read posted state from it).
      const postedAt = await f.db
        .selectFrom("leaseScheduleLine")
        .select([sql<string>`"periodDate"::text`.as("periodDate"), "postedAt"])
        .where("leaseId", "=", f.leaseId)
        .execute();
      for (const line of postedAt) {
        expect(line.postedAt !== null).toBe(line.periodDate < "2027-07-01");
      }

      // A change dated inside the opening balance would rewrite months that
      // are already in the GL: refused.
      const inOpening = await run(f, {
        type: "modify",
        leaseId: f.leaseId,
        effectiveDate: "2027-04-01",
        endDate: "2029-12-31",
        discountRate: 7,
        paymentFrequency: "Monthly",
        annualEscalationPercent: 0
      });
      expect(String((inOpening.error as Error | null)?.message)).toMatch(
        /already posted/
      );

      // The payments due before the opening date are in its balance: they
      // are not invoiced.
      const payments = await f.db
        .selectFrom("leasePayment")
        .select([sql<string>`"dueDate"::text`.as("dueDate"), "status"])
        .where("leaseId", "=", f.leaseId)
        .execute();
      for (const payment of payments) {
        expect(payment.status).toBe(
          payment.dueDate < "2027-07-01" ? "Skipped" : "Pending"
        );
      }

      const journal = await f.db
        .selectFrom("journal")
        .innerJoin("journalLine", "journalLine.journalId", "journal.id")
        .select([
          sql<string>`"journal"."postingDate"::text`.as("postingDate"),
          "journal.description",
          "journalLine.accountId",
          "journalLine.amount"
        ])
        .where("journal.companyId", "=", f.companyId)
        .where("journal.sourceType", "=", "Lease")
        .execute();
      expect(new Set(journal.map((line) => line.postingDate))).toEqual(
        new Set(["2027-07-01"])
      );
      expect(journal[0]!.description).toBe("Lease Opening Balance LSE-TEST");
      const amounts = Object.fromEntries(
        journal.map((line) => [line.accountId, Number(line.amount)])
      );
      expect(amounts[f.accounts.rou]).toBeCloseTo(328710.16, 2);
      expect(amounts[f.accounts.liability]).toBeCloseTo(carrying, 2);
      // A credit on an Asset-class account stores negative.
      expect(amounts[f.accounts.accumulated]).toBeCloseTo(-accumulated, 2);
      // Retained earnings (a Revenue-class account here, so a debit stores
      // negative): the six months' cost above the payments sits in equity.
      const difference = 328710.16 - accumulated - carrying;
      expect(difference).toBeLessThan(-1000);
      expect(amounts[f.accounts.gain]).toBeCloseTo(difference, 2);

      // Nothing has been invoiced or run, so the activation can still be
      // undone: the opening journal is voided.
      expect(
        (await run(f, { type: "cancel", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Cancelled");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a lease with two assets measures each, in one journal with lines per asset",
  async () => {
    const f = await leaseFixture({
      assets: [{}, { paymentAmount: 5000, fairValue: 170000 }]
    });
    try {
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await asset(f, 0)).lesseeClassification).toBe("Operating");
      const second = await asset(f, 1);
      expect(second.lesseeClassification).toBe("Finance");
      expect(Number(second.initialLiability)).toBeCloseTo(164355.08, 2);

      const journal = await f.db
        .selectFrom("journalLine")
        .select(["documentLineReference", "accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", f.leaseId)
        .execute();
      expect(journal).toHaveLength(4);
      expect(
        new Set(journal.map((line) => line.documentLineReference))
      ).toEqual(new Set(f.lineIds));
      expect(await scheduleLines(f, 0)).toHaveLength(36);
      expect(await scheduleLines(f, 1)).toHaveLength(36);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "terminating one of two assets keeps the lease active until the last one ends",
  async () => {
    const f = await leaseFixture({ assets: [{}, {}] });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2028-12-31"
      });
      const terminate = (index: number) =>
        run(f, {
          type: "terminate",
          leaseId: f.leaseId,
          leaseLineId: f.lineIds[index]!,
          terminationDate: "2028-12-31",
          penaltyAmount: 0
        });

      expect((await terminate(0)).error).toBeNull();
      expect((await asset(f, 0)).status).toBe("Terminated");
      expect((await lease(f)).status).toBe("Active");
      expect(await scheduleLines(f, 0)).toHaveLength(24);
      expect(await scheduleLines(f, 1)).toHaveLength(36);

      // An ended asset cannot be ended again.
      expect((await terminate(0)).error).not.toBeNull();

      expect((await terminate(1)).error).toBeNull();
      const row = await lease(f);
      expect(row.status).toBe("Terminated");
      expect(row.endDate).toBe("2028-12-31");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "terminating on the end date takes the unpaid purchase option out of the liability",
  async () => {
    const f = await leaseFixture({
      purchaseOptionAmount: 20000,
      purchaseOptionReasonablyCertain: true,
      economicLifeMonths: 84
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2029-12-31"
      });
      expect(
        (
          await run(f, {
            type: "terminate",
            leaseId: f.leaseId,
            leaseLineId: f.lineIds[0]!,
            terminationDate: "2029-12-31",
            penaltyAmount: 0
          })
        ).error
      ).toBeNull();
      // The schedule closes at 0 after paying the option; the option is now
      // never paid, so the liability still holds it.
      expect(
        Number((await event(f, "Termination")).liabilityBefore)
      ).toBeCloseTo(20000, 2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a purchase option already invoiced is the price; no second option row is written",
  async () => {
    const f = await leaseFixture({
      purchaseOptionAmount: 20000,
      purchaseOptionReasonablyCertain: true,
      economicLifeMonths: 84
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2029-12-31"
      });
      await f.db
        .updateTable("leasePayment")
        // An Invoiced row names its invoice line (no FK: any id will do).
        .set({ status: "Invoiced", purchaseInvoiceLineId: "pil-test" })
        .where("leaseLineId", "=", f.lineIds[0]!)
        .where("paymentType", "=", "Purchase Option")
        .execute();
      const purchase = (purchasePrice: number) =>
        run(f, {
          type: "purchase",
          leaseId: f.leaseId,
          leaseLineId: f.lineIds[0]!,
          exerciseDate: "2029-12-31",
          purchasePrice,
          fixedAssetClassId: f.assetClassId,
          name: "Forklift FL-12"
        });

      expect(String((await purchase(25000)).error)).toContain(
        "already invoiced"
      );
      expect((await purchase(20000)).error).toBeNull();
      const row = await asset(f);
      const fixedAsset = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost"])
        .where("id", "=", row.fixedAssetId!)
        .executeTakeFirstOrThrow();
      expect(Number(fixedAsset.acquisitionCost)).toBeCloseTo(
        345423.06 - (345423.06 / 84) * 36,
        0
      );
      const options = await f.db
        .selectFrom("leasePayment")
        .select(["status"])
        .where("leaseLineId", "=", f.lineIds[0]!)
        .where("paymentType", "=", "Purchase Option")
        .execute();
      expect(options).toEqual([{ status: "Invoiced" }]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a modified lease cannot be cancelled: its events are history",
  async () => {
    const f = await leaseFixture();
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      expect(
        (
          await run(f, {
            type: "modify",
            leaseId: f.leaseId,
            effectiveDate: "2027-01-01",
            endDate: "2029-12-31",
            discountRate: 7,
            paymentFrequency: "Monthly",
            annualEscalationPercent: 0,
            lines: [{ leaseLineId: f.lineIds[0]!, paymentAmount: 11000 }]
          })
        ).error
      ).toBeNull();
      expect(Number((await asset(f)).paymentAmount)).toBe(11000);
      const refused = await run(f, { type: "cancel", leaseId: f.leaseId });
      expect(String((refused.error as Error | null)?.message)).toMatch(
        /terminate/i
      );
      expect((await lease(f)).status).toBe("Active");
      expect(
        (await leaseJournals(f)).some((line) =>
          line.description?.startsWith("VOID ")
        )
      ).toBe(false);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an open-ended lease activates Short-Term, and is refused without the short-term expedient",
  async () => {
    const f = await leaseFixture({ endDate: null });
    try {
      await f.db
        .updateTable("companySettings")
        .set({ leaseShortTermExpedient: false })
        .where("id", "=", f.companyId)
        .execute();
      const refused = await run(f, { type: "activate", leaseId: f.leaseId });
      expect(String((refused.error as Error)?.message)).toContain(
        "Settings → Accounting"
      );
      expect((await lease(f)).status).toBe("Draft");

      await f.db
        .updateTable("companySettings")
        .set({ leaseShortTermExpedient: true })
        .where("id", "=", f.companyId)
        .execute();
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Active");
      expect((await asset(f)).lesseeClassification).toBe("Short-Term");
      expect(await leaseJournals(f)).toHaveLength(0);
      expect(await scheduleLines(f)).toHaveLength(0);

      // Nothing to modify or buy; it ends with Terminate.
      expect(
        (
          await run(f, {
            type: "purchase",
            leaseId: f.leaseId,
            leaseLineId: f.lineIds[0]!,
            exerciseDate: "2027-01-31",
            purchasePrice: 1000,
            fixedAssetClassId: f.assetClassId,
            name: "x"
          })
        ).error
      ).not.toBeNull();
      expect(
        (
          await run(f, {
            type: "terminate",
            leaseId: f.leaseId,
            leaseLineId: f.lineIds[0]!,
            terminationDate: "2027-01-31",
            penaltyAmount: 0
          })
        ).error
      ).toBeNull();
      const ended = await lease(f);
      expect(ended.status).toBe("Terminated");
      expect(ended.endDate).toBe("2027-01-31");
    } finally {
      await f.cleanup();
    }
  }
);

async function payments(f: Fixture, index = 0) {
  return f.db
    .selectFrom("leasePayment")
    .select([
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"dueDate"::text`.as("dueDate"),
      "paymentType",
      "amount",
      "status"
    ])
    .where("leaseLineId", "=", f.lineIds[index]!)
    .orderBy("dueDate")
    .execute();
}

const amountDue = async (f: Fixture, dueDate: string, index = 0) =>
  Number(
    (await payments(f, index)).find(
      (row) => row.dueDate === dueDate && row.paymentType === "Rent"
    )?.amount
  );

databaseTest(
  "modify keeps the escalation on the anniversaries of the commencement",
  async () => {
    // 3 % a year from 2027-01-01: 10,000, then 10,300 in 2028, 10,609 in 2029.
    const f = await leaseFixture({
      annualEscalationPercent: 3,
      assets: [{}, {}]
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2028-06-30"
      });
      // The same terms from mid-2028: the payment entered is the one AT the
      // effective date. The second asset is not named and keeps its payment.
      expect(
        (
          await run(f, {
            type: "modify",
            leaseId: f.leaseId,
            effectiveDate: "2028-07-01",
            endDate: "2029-12-31",
            discountRate: 6,
            paymentFrequency: "Monthly",
            annualEscalationPercent: 3,
            lines: [{ leaseLineId: f.lineIds[0]!, paymentAmount: 10300 }]
          })
        ).error
      ).toBeNull();

      for (const index of [0, 1]) {
        expect(await amountDue(f, "2028-07-31", index)).toBe(10300);
        expect(await amountDue(f, "2028-12-31", index)).toBe(10300);
        // The next step is on the commencement's anniversary, not a year
        // after the change.
        expect(await amountDue(f, "2029-01-31", index)).toBe(10609);
        expect(await amountDue(f, "2029-12-31", index)).toBe(10609);
        // The asset keeps its commencement payment: the rows are cut from it.
        expect(Number((await asset(f, index)).paymentAmount)).toBeCloseTo(
          10000,
          2
        );
      }

      // Nothing changed, so the remeasured liability is the carrying one.
      const modification = await f.db
        .selectFrom("leaseEvent")
        .select(["liabilityBefore", "liabilityAfter"])
        .where("leaseLineId", "=", f.lineIds[0]!)
        .executeTakeFirstOrThrow();
      expect(
        Math.abs(
          Number(modification.liabilityAfter) -
            Number(modification.liabilityBefore)
        )
      ).toBeLessThan(0.05);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "modify cuts a lease from the 31st in the months of its commencement",
  async () => {
    // A lease from the 31st: its months start 2027-02-28, 2027-03-31,
    // 2027-04-30 … (clamped from the 31st), never from the 28th.
    const f = await leaseFixture({
      commencementDate: "2027-01-31",
      endDate: "2030-01-30"
    });
    try {
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2027-02-27"
      });
      expect(
        (
          await run(f, {
            type: "modify",
            leaseId: f.leaseId,
            effectiveDate: "2027-02-28",
            endDate: "2030-01-30",
            discountRate: 7,
            paymentFrequency: "Monthly",
            annualEscalationPercent: 0
          })
        ).error
      ).toBeNull();
      const starts = (await payments(f))
        .filter((row) => row.paymentType === "Rent")
        .map((row) => row.periodStart);
      expect(starts.slice(0, 4)).toEqual([
        "2027-01-31",
        "2027-02-28",
        "2027-03-31",
        "2027-04-30"
      ]);
      const lines = await scheduleLines(f);
      expect(lines.slice(0, 4).map((line) => line.periodDate)).toEqual([
        "2027-02-27",
        "2027-03-30",
        "2027-04-29",
        "2027-05-30"
      ]);
      expect(lines).toHaveLength(36);
      expect(Number(lines[35]!.closingLiability)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "modify is refused while a Skipped payment is due on or after the date",
  async () => {
    const f = await leaseFixture();
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2027-12-31"
      });
      await f.db
        .updateTable("leasePayment")
        .set({ status: "Skipped" })
        .where("leaseLineId", "=", f.lineIds[0]!)
        .where(sql`"dueDate"`, "=", sql`'2028-03-31'`)
        .execute();
      const result = await run(f, {
        type: "modify",
        leaseId: f.leaseId,
        effectiveDate: "2028-01-01",
        endDate: "2030-12-31",
        discountRate: 7,
        paymentFrequency: "Monthly",
        annualEscalationPercent: 0
      });
      expect(String((result.error as Error | null)?.message)).toContain(
        "2028-03-31"
      );
      expect((result.error as { status?: number } | null)?.status).toBe(400);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a mid-month Advance lease that started before the cutover leaves the as-of month's payment to invoice",
  async () => {
    // Months run from the 15th; the cutover is 2027-07-01, inside month 5
    // (2027-06-15 to 2027-07-14). The opening balance holds the months that
    // ended before it, so the payment due 2027-06-15 — paid at the start of
    // month 5 — is still in the liability and must be invoiced.
    const f = await leaseFixture({
      commencementDate: "2027-01-15",
      endDate: "2029-01-14",
      timing: "Advance"
    });
    try {
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: "2027-07-01" })
        .where("id", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("accountDefault")
        .set({ retainedEarningsAccount: f.accounts.gain })
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();

      const rows = await payments(f);
      expect(rows.find((row) => row.dueDate === "2027-05-15")?.status).toBe(
        "Skipped"
      );
      expect(rows.find((row) => row.dueDate === "2027-06-15")?.status).toBe(
        "Pending"
      );

      // The opening liability, plus the interest still to accrue, is exactly
      // what the Pending rows will pay: nothing is left on the books.
      const journal = await leaseJournals(f);
      const opening = Number(
        journal.find((line) => line.accountId === f.accounts.liability)?.amount
      );
      const interest = (await scheduleLines(f))
        .filter((line) => line.periodDate >= "2027-07-01")
        .reduce((sum, line) => sum + Number(line.interestAmount), 0);
      const pending = rows
        .filter((row) => row.status === "Pending")
        .reduce((sum, row) => sum + Number(row.amount), 0);
      expect(opening + interest).toBeCloseTo(pending, 2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "activation refuses a Skipped payment that nothing would settle",
  async () => {
    // The lease starts after the cutover: no opening balance holds any
    // payment, so a Skipped row stays in the liability forever.
    const f = await leaseFixture();
    try {
      await f.db
        .updateTable("leasePayment")
        .set({ status: "Skipped" })
        .where("leaseLineId", "=", f.lineIds[0]!)
        .where(sql`"dueDate"`, "=", sql`'2027-03-31'`)
        .execute();
      const result = await run(f, { type: "activate", leaseId: f.leaseId });
      expect(String((result.error as Error | null)?.message)).toContain(
        "2027-03-31"
      );
      expect((await lease(f)).status).toBe("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "terminate and purchase refuse a date before the commencement",
  async () => {
    const f = await leaseFixture({
      purchaseOptionAmount: 20000,
      purchaseOptionReasonablyCertain: true,
      economicLifeMonths: 84
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      const terminated = await run(f, {
        type: "terminate",
        leaseId: f.leaseId,
        leaseLineId: f.lineIds[0]!,
        terminationDate: "2026-12-31",
        penaltyAmount: 0
      });
      expect(String((terminated.error as Error | null)?.message)).toMatch(
        /commencement/
      );
      const purchased = await run(f, {
        type: "purchase",
        leaseId: f.leaseId,
        leaseLineId: f.lineIds[0]!,
        exerciseDate: "2026-12-31",
        purchasePrice: 20000,
        fixedAssetClassId: f.assetClassId,
        name: "Forklift FL-12"
      });
      expect(String((purchased.error as Error | null)?.message)).toMatch(
        /commencement/
      );
      expect((await asset(f)).status).toBe("Active");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "cancel is refused once an asset was purchased, and the fixed asset stays",
  async () => {
    const f = await leaseFixture({
      assets: [
        {
          purchaseOptionAmount: 20000,
          purchaseOptionReasonablyCertain: true,
          economicLifeMonths: 84
        },
        {}
      ]
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      await postScheduleThrough(f.db, {
        companyId: f.companyId,
        leaseId: f.leaseId,
        through: "2029-12-31"
      });
      expect(
        (
          await run(f, {
            type: "purchase",
            leaseId: f.leaseId,
            leaseLineId: f.lineIds[0]!,
            exerciseDate: "2029-12-31",
            purchasePrice: 20000,
            fixedAssetClassId: f.assetClassId,
            name: "Forklift FL-12"
          })
        ).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Active");

      const refused = await run(f, { type: "cancel", leaseId: f.leaseId });
      expect(String((refused.error as Error | null)?.message)).toMatch(
        /terminate/i
      );
      expect((await lease(f)).status).toBe("Active");
      const fixedAsset = await f.db
        .selectFrom("fixedAsset")
        .select("status")
        .where("id", "=", (await asset(f)).fixedAssetId!)
        .executeTakeFirstOrThrow();
      expect(fixedAsset.status).toBe("Active");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("cancel is refused once a lease run posted a month", async () => {
  const f = await leaseFixture();
  try {
    await run(f, { type: "activate", leaseId: f.leaseId });
    const first = await f.db
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("leaseId", "=", f.leaseId)
      .where("scheduledDate", "=", "2027-01-31")
      .execute();
    const runId = await holdInDraftRun(
      f.db,
      f.companyId,
      first.map((row) => row.id),
      "2027-01-31",
      "Lease"
    );
    // The run posts: its rows are Posted and keep their run line.
    await f.db
      .updateTable("revenueRecognitionRun")
      .set({ status: "Posted" })
      .where("id", "=", runId)
      .execute();
    await f.db
      .updateTable("revenueRecognitionSchedule")
      .set({ status: "Posted" })
      .where(
        "id",
        "in",
        first.map((row) => row.id)
      )
      .execute();

    const refused = await run(f, { type: "cancel", leaseId: f.leaseId });
    expect(String((refused.error as Error | null)?.message)).toMatch(
      /lease run/
    );
    expect((await lease(f)).status).toBe("Active");
  } finally {
    await f.cleanup();
  }
});

databaseTest("a Draft lease is deleted, not cancelled", async () => {
  const f = await leaseFixture();
  try {
    const refused = await run(f, { type: "cancel", leaseId: f.leaseId });
    expect(refused.error).not.toBeNull();
    expect((await lease(f)).status).toBe("Draft");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "an asset whose ownership transfers is purchased at the end for nothing, with its serial number",
  async () => {
    const f = await leaseFixture({
      ownershipTransfers: true,
      economicLifeMonths: 84,
      serialNumber: "SN-12"
    });
    try {
      await run(f, { type: "activate", leaseId: f.leaseId });
      expect((await asset(f)).lesseeClassification).toBe("Finance");
      const postThrough = (through: string) =>
        postScheduleThrough(f.db, {
          companyId: f.companyId,
          leaseId: f.leaseId,
          through
        });
      const purchase = (exerciseDate: string, purchasePrice: number) =>
        run(f, {
          type: "purchase",
          leaseId: f.leaseId,
          leaseLineId: f.lineIds[0]!,
          exerciseDate,
          purchasePrice,
          fixedAssetClassId: f.assetClassId,
          name: "Forklift FL-12"
        });
      // With no purchase option title passes at the end of the lease, and
      // there is no price to pay.
      await postThrough("2029-11-30");
      expect(
        String((await purchase("2029-11-30", 0)).error as Error | null)
      ).toMatch(/end of the lease/);
      await postThrough("2029-12-31");
      expect(
        String((await purchase("2029-12-31", 500)).error as Error | null)
      ).toMatch(/no purchase option/);
      expect((await purchase("2029-12-31", 0)).error).toBeNull();

      const row = await asset(f);
      expect(row.status).toBe("Purchased");
      const fixedAsset = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost", "serialNumber"])
        .where("id", "=", row.fixedAssetId!)
        .executeTakeFirstOrThrow();
      expect(fixedAsset.serialNumber).toBe("SN-12");
      // The net ROU after 36 of 84 months; the liability is fully paid.
      expect(Number(fixedAsset.acquisitionCost)).toBeCloseTo(
        328710.16 - (328710.16 / 84) * 36,
        0
      );
      expect(
        (await payments(f)).some((p) => p.paymentType === "Purchase Option")
      ).toBe(false);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a short final month takes its share of the lease cost by days",
  async () => {
    // 12 months and 15 days: the 13th month runs 2028-01-01 to 2028-01-15.
    const f = await leaseFixture({
      endDate: "2028-01-15",
      fairValue: 1_000_000,
      economicLifeMonths: 120
    });
    try {
      expect(
        (await run(f, { type: "activate", leaseId: f.leaseId })).error
      ).toBeNull();
      expect((await asset(f)).lesseeClassification).toBe("Operating");

      const lines = await f.db
        .selectFrom("leaseScheduleLine")
        .select([sql<string>`"periodDate"::text`.as("periodDate"), "leaseCost"])
        .where("leaseId", "=", f.leaseId)
        .orderBy("periodDate")
        .execute();
      expect(lines).toHaveLength(13);
      expect(lines[12]!.periodDate).toBe("2028-01-15");
      const monthly = Number(lines[0]!.leaseCost);
      expect(Number(lines[12]!.leaseCost)).toBeCloseTo((monthly * 15) / 31, 1);
    } finally {
      await f.cleanup();
    }
  }
);
