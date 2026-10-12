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
      expect(await scheduleLines(f)).toHaveLength(24);
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
        .set({ status: "Invoiced" })
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
  "cancelling after a modification voids every journal of the lease",
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
      expect(
        (await run(f, { type: "cancel", leaseId: f.leaseId })).error
      ).toBeNull();

      const journal = await leaseJournals(f);
      const voids = new Set(
        journal
          .filter((line) => line.description?.startsWith("VOID "))
          .map((line) => line.description)
      );
      expect(voids).toEqual(
        new Set([
          "VOID Lease Commencement LSE-TEST",
          "VOID Lease Modification LSE-TEST"
        ])
      );
      const net = journal.reduce((sum, line) => sum + Number(line.amount), 0);
      expect(net).toBeCloseTo(0, 5);
    } finally {
      await f.cleanup();
    }
  }
);
