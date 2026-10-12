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
import previewRevenueRecognitionRun from "./index";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

async function deferral(
  f: Fixture,
  key: string,
  scheduledDate: string,
  amount: number
) {
  const line = await f.db
    .selectFrom("salesInvoiceLine")
    .select("id")
    .where("invoiceId", "=", f.invoiceId)
    .executeTakeFirstOrThrow();
  const id = `${f.companyId}-${key}`;
  await f.db
    .insertInto("revenueRecognitionSchedule")
    .values({
      id,
      type: "Deferral",
      status: "Planned",
      salesInvoiceLineId: line.id,
      periodStart: `${scheduledDate.slice(0, 8)}01`,
      periodEnd: scheduledDate,
      scheduledDate,
      amount,
      debitAccountId: f.account("control"),
      creditAccountId: f.account("sales"),
      companyId: f.companyId,
      createdBy: "system"
    })
    .execute();
  return id;
}

async function preview(f: Fixture, periodEnd: string) {
  const result = await previewRevenueRecognitionRun(
    ServerFnContext.system({
      db: f.db,
      companyId: f.companyId,
      userId: "system"
    }),
    { periodEnd }
  );
  if (result.error) throw result.error;
  return result.data;
}

async function counts(f: Fixture) {
  const [schedule, runs] = await Promise.all([
    f.db
      .selectFrom("revenueRecognitionSchedule")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow(),
    f.db
      .selectFrom("revenueRecognitionRun")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow()
  ]);
  return { schedule: Number(schedule.n), runs: Number(runs.n) };
}

databaseTest(
  "the preview counts what a new run would claim, and leaves nothing behind",
  async () => {
    const f = await paymentFixture();
    try {
      const held = await deferral(f, "aug", "2026-08-31", 100);
      await holdInDraftRun(f.db, f.companyId, [held]);
      await deferral(f, "sep", "2026-09-30", 50);
      await deferral(f, "oct", "2026-10-31", 70);
      const before = await counts(f);

      // The September row is due and unclaimed; August is held by a run and
      // October is not due yet.
      expect(await preview(f, "2026-09-30")).toEqual({ count: 1, amount: 50 });
      expect(await counts(f)).toEqual(before);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest("the preview of a period with nothing due is empty", async () => {
  const f = await paymentFixture();
  try {
    await deferral(f, "oct", "2026-10-31", 70);
    expect(await preview(f, "2026-09-30")).toEqual({ count: 0, amount: 0 });
  } finally {
    await f.cleanup();
  }
});
