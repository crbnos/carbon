// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";
import {
  dropRecognitionRuns,
  holdInDraftRun
} from "../fixtures/run";
import { previewRevenueRecognitionRun } from "../../../app/modules/accounting/accounting.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

async function deferral(
  f: Fixture,
  key: string,
  scheduledDate: string,
  amount: number,
  rentalAgreementLineId: string | null = null
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
      rentalAgreementLineId,
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

async function preview(
  f: Fixture,
  periodEnd: string,
  type: "Revenue Recognition" | "Lease" = "Revenue Recognition"
) {
  const result = await invokePosting(handlesOf({
        db: f.db,
        companyId: f.companyId,
        userId: "system"
      }), "preview-revenue-recognition-run", { periodEnd, type }, previewRevenueRecognitionRun);
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

databaseTest(
  "a rental row is previewed by the lease run, never by the revenue run",
  async () => {
    const f = await paymentFixture();
    try {
      await deferral(f, "rent", "2026-09-30", 40, `${f.companyId}-rental-line`);
      await deferral(f, "service", "2026-09-30", 60);

      expect(await preview(f, "2026-09-30")).toEqual({ count: 1, amount: 60 });
      expect(await preview(f, "2026-09-30", "Lease")).toEqual({
        count: 1,
        amount: 40
      });
    } finally {
      await f.cleanup();
    }
  }
);
