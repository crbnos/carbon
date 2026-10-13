// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, test } from "vitest";
import { synthesizeProjectRevenue } from "../lib/project-revenue";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "../post-payment/payment-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import proposeRevenueRecognitionRun, {
  type RunRowSynthesizer,
  runRowSynthesizers,
  synthesizeContractRevenue,
  synthesizeRentalAccruals
} from "./index";
import { dropRecognitionRuns } from "./run-test-fixture";

test("a Revenue Recognition run takes a caller's synthesizers before Right to Invoice and the contract revenue", () => {
  const extra: RunRowSynthesizer = async () => {
    // Writes nothing: only its place in the order matters.
  };
  expect(runRowSynthesizers("Revenue Recognition", [extra])).toEqual([
    extra,
    synthesizeProjectRevenue,
    synthesizeContractRevenue
  ]);
  expect(runRowSynthesizers("Revenue Recognition")).toEqual([
    synthesizeProjectRevenue,
    synthesizeContractRevenue
  ]);
});

test("a Lease run synthesizes only the rental accruals, whatever the caller passes", () => {
  const extra: RunRowSynthesizer = async () => {};
  expect(runRowSynthesizers("Lease", [extra])).toEqual([
    synthesizeRentalAccruals
  ]);
});

databaseTest(
  "the proposal runs a caller's synthesizer once, inside its transaction, before it claims the due rows",
  async () => {
    const f = await paymentFixture();
    try {
      const line = await f.db
        .selectFrom("salesInvoiceLine")
        .select("id")
        .where("invoiceId", "=", f.invoiceId)
        .executeTakeFirstOrThrow();

      const calls: { companyId: string; periodEnd: string }[] = [];
      // Writes one due Deferral row through the run's own transaction, so the
      // proposal claims it only if the synthesizer runs before the claim.
      const fake: RunRowSynthesizer = async (trx, ctx) => {
        calls.push({ companyId: ctx.companyId, periodEnd: ctx.periodEnd });
        await trx
          .insertInto("revenueRecognitionSchedule")
          .values({
            id: `${f.companyId}-fake`,
            type: "Deferral",
            status: "Planned",
            salesInvoiceLineId: line.id,
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            scheduledDate: "2026-09-30",
            amount: 40,
            debitAccountId: f.account("control"),
            creditAccountId: f.account("sales"),
            companyId: ctx.companyId,
            createdBy: ctx.userId
          })
          .execute();
      };

      // The payment fixture seeds only the journal sequence.
      await f.db
        .insertInto("sequence")
        .values({
          table: "revenueRecognitionRun",
          name: "Test runs",
          prefix: "RR-",
          companyId: f.companyId
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const result = await proposeRevenueRecognitionRun(
        ServerFnContext.system({
          db: f.db,
          companyId: f.companyId,
          userId: "system",
          revenueRunSynthesizers: [fake]
        }),
        { periodEnd: "2026-09-30" }
      );
      if (result.error) throw result.error;

      expect(calls).toEqual([
        { companyId: f.companyId, periodEnd: "2026-09-30" }
      ]);
      expect(result.data?.lineCount).toBe(1);
      const claimed = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("runLineId")
        .where("companyId", "=", f.companyId)
        .where("id", "=", `${f.companyId}-fake`)
        .executeTakeFirstOrThrow();
      expect(claimed.runLineId).not.toBeNull();
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);
