// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "../post-payment/payment-test-fixture";
import {
  dropRecognitionRuns,
  holdInDraftRun
} from "../propose-revenue-recognition-run/run-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import recalculateRevenueRecognitionRun from "./index";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

/** Planned deferral rows on the fixture's invoice line, keyed by suffix. */
async function deferrals<K extends string>(
  f: Fixture,
  rows: { key: K; scheduledDate: string; amount: number }[]
): Promise<Record<K, string>> {
  const line = await f.db
    .selectFrom("salesInvoiceLine")
    .select("id")
    .where("invoiceId", "=", f.invoiceId)
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("revenueRecognitionSchedule")
    .values(
      rows.map((row) => ({
        id: `${f.companyId}-${row.key}`,
        type: "Deferral" as const,
        status: "Planned" as const,
        salesInvoiceLineId: line.id,
        periodStart: `${row.scheduledDate.slice(0, 8)}01`,
        periodEnd: row.scheduledDate,
        scheduledDate: row.scheduledDate,
        amount: row.amount,
        debitAccountId: f.account("control"),
        creditAccountId: f.account("sales"),
        companyId: f.companyId,
        createdBy: "system"
      }))
    )
    .execute();
  return Object.fromEntries(
    rows.map((row) => [row.key, `${f.companyId}-${row.key}`])
  ) as Record<K, string>;
}

async function runLines(f: Fixture, runId: string) {
  return f.db
    .selectFrom("revenueRecognitionRunLine as l")
    .innerJoin("revenueRecognitionSchedule as s", "s.runLineId", "l.id")
    .select(["l.scheduleId", "l.amount"])
    .where("l.runId", "=", runId)
    .where("l.companyId", "=", f.companyId)
    .orderBy("l.scheduleId")
    .execute();
}

async function recalculate(f: Fixture, runId: string) {
  const result = await recalculateRevenueRecognitionRun(
    ServerFnContext.system({
      db: f.db,
      companyId: f.companyId,
      userId: "system"
    }),
    { runId }
  );
  if (result.error) throw result.error;
  return result.data;
}

databaseTest(
  "recalculating a Draft claims the rows that fell due after it was proposed, keeping its number",
  async () => {
    const f = await paymentFixture();
    try {
      const ids = await deferrals(f, [
        { key: "sep-15", scheduledDate: "2026-09-15", amount: 100 }
      ]);
      const runId = await holdInDraftRun(f.db, f.companyId, [ids["sep-15"]]);
      const later = await deferrals(f, [
        { key: "sep-30", scheduledDate: "2026-09-30", amount: 50 },
        { key: "oct-31", scheduledDate: "2026-10-31", amount: 70 }
      ]);

      const result = await recalculate(f, runId);

      expect(result).toEqual({
        runId: "RR-TEST",
        lineCount: 2,
        changed: true,
        deleted: false
      });
      // Every line is stamped back onto its row (the join is on runLineId),
      // and the October row stays out of a September run.
      expect(await runLines(f, runId)).toEqual(
        [
          { scheduleId: ids["sep-15"], amount: 100 },
          { scheduleId: later["sep-30"], amount: 50 }
        ].sort((a, b) => a.scheduleId.localeCompare(b.scheduleId))
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "recalculating takes a held row's current amount and reports an up-to-date run as unchanged",
  async () => {
    const f = await paymentFixture();
    try {
      const ids = await deferrals(f, [
        { key: "sep-30", scheduledDate: "2026-09-30", amount: 100 }
      ]);
      const runId = await holdInDraftRun(f.db, f.companyId, [ids["sep-30"]]);

      expect((await recalculate(f, runId)).changed).toBe(false);

      await f.db
        .updateTable("revenueRecognitionSchedule")
        .set({ amount: 60 })
        .where("id", "=", ids["sep-30"])
        .execute();
      expect((await recalculate(f, runId)).changed).toBe(true);
      expect(await runLines(f, runId)).toEqual([
        { scheduleId: ids["sep-30"], amount: 60 }
      ]);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "recalculating a Draft with nothing left due deletes it and releases its rows",
  async () => {
    const f = await paymentFixture();
    try {
      const ids = await deferrals(f, [
        { key: "sep-30", scheduledDate: "2026-09-30", amount: 100 }
      ]);
      const runId = await holdInDraftRun(f.db, f.companyId, [ids["sep-30"]]);
      await f.db
        .updateTable("revenueRecognitionSchedule")
        .set({ scheduledDate: "2026-10-31" })
        .where("id", "=", ids["sep-30"])
        .execute();

      expect(await recalculate(f, runId)).toEqual({
        runId: "RR-TEST",
        lineCount: 0,
        changed: true,
        deleted: true
      });
      expect(
        await f.db
          .selectFrom("revenueRecognitionRun")
          .select("id")
          .where("id", "=", runId)
          .executeTakeFirst()
      ).toBeUndefined();
      const row = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("runLineId")
        .where("id", "=", ids["sep-30"])
        .executeTakeFirstOrThrow();
      expect(row.runLineId).toBeNull();
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest("recalculating refuses a posted run", async () => {
  const f = await paymentFixture();
  try {
    const ids = await deferrals(f, [
      { key: "sep-30", scheduledDate: "2026-09-30", amount: 100 }
    ]);
    const runId = await holdInDraftRun(f.db, f.companyId, [ids["sep-30"]]);
    await f.db
      .updateTable("revenueRecognitionRun")
      .set({ status: "Posted" })
      .where("id", "=", runId)
      .execute();

    await expect(recalculate(f, runId)).rejects.toThrow(
      "only a draft can be recalculated"
    );
  } finally {
    await dropRecognitionRuns(f.db, f.companyId);
    await f.cleanup();
  }
});
