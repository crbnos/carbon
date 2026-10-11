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

async function scheduleLines(f: Fixture) {
  return f.db
    .selectFrom("leaseScheduleLine")
    .select([
      sql<string>`"periodDate"::text`.as("periodDate"),
      "interestAmount",
      "principalAmount",
      "closingLiability",
      "rouAmortization"
    ])
    .where("leaseId", "=", f.leaseId)
    .orderBy("periodDate")
    .execute();
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

      const row = await lease(f);
      expect(row.status).toBe("Active");
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
      expect((await lease(f)).lesseeClassification).toBe("Finance");
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
      const row = await lease(f);
      expect(row.lesseeClassification).toBe("Short-Term");
      expect(row.commencementJournalId).toBeNull();
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
        paymentAmount: 10000,
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
            paymentAmount: 10000,
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

      const event = await f.db
        .selectFrom("leaseEvent")
        .select(["eventType", "liabilityBefore", "liabilityAfter", "journalId"])
        .where("leaseId", "=", f.leaseId)
        .executeTakeFirstOrThrow();
      expect(event.eventType).toBe("Modification");
      expect(Number(event.liabilityBefore)).toBeCloseTo(
        Number(before[11]!.closingLiability),
        5
      );
      expect(Number(event.liabilityAfter)).toBeGreaterThan(
        Number(event.liabilityBefore)
      );
      expect(event.journalId).not.toBeNull();
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
        paymentAmount: 10000,
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
            terminationDate: "2028-12-31",
            penaltyAmount: 5000
          })
        ).error
      ).toBeNull();
      expect((await lease(f)).status).toBe("Terminated");
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
      expect((await lease(f)).lesseeClassification).toBe("Finance");
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
            exerciseDate: "2029-12-31",
            purchasePrice: 20000,
            fixedAssetClassId: f.assetClassId,
            name: "Forklift FL-12"
          })
        ).error
      ).toBeNull();
      const row = await lease(f);
      expect(row.status).toBe("Purchased");
      const asset = await f.db
        .selectFrom("fixedAsset")
        .select(["acquisitionCost", "status"])
        .where("id", "=", row.fixedAssetId!)
        .executeTakeFirstOrThrow();
      expect(asset.status).toBe("Active");
      // Net ROU after 36 of 84 months, plus the price, less the liability left.
      expect(Number(asset.acquisitionCost)).toBeCloseTo(
        345423.06 - (345423.06 / 84) * 36 + 20000,
        0
      );
    } finally {
      await f.cleanup();
    }
  }
);
