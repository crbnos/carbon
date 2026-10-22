// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, test, vi } from "vitest";
import {
  proposeRevenueRecognitionRun,
  type RunRowSynthesizer,
  runRowSynthesizers,
  synthesizeContractRevenue,
  synthesizeRentalAccruals
} from "../../../app/modules/accounting/accounting.service";
import {
  projectRevenueWriters,
  synthesizeProjectRevenue
} from "../../../app/modules/accounting/project-revenue";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";
import { dropRecognitionRuns } from "../fixtures/run";

// A run's commercial synthesizers are `@carbon/ee`'s
// `projectRevenueSynthesizers(projectRevenueWriters)`: `runRowSynthesizers`
// builds them itself, so no caller passes them. The test stands in for that
// list to see where the proposal runs it.
const commercial = vi.hoisted(() => ({
  synthesizers: [] as unknown[]
}));
vi.mock("@carbon/ee/project-revenue.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@carbon/ee/project-revenue.server")
  >()),
  projectRevenueSynthesizers: vi.fn(() => commercial.synthesizers)
}));

test("a Revenue Recognition run takes the commercial synthesizers before Right to Invoice and the contract revenue", async () => {
  const extra: RunRowSynthesizer = async () => {
    // Writes nothing: only its place in the order matters.
  };
  expect(runRowSynthesizers("Revenue Recognition", [extra])).toEqual([
    extra,
    synthesizeProjectRevenue,
    synthesizeContractRevenue
  ]);

  // With no list given, the commercial synthesizers built from the ERP's
  // writers come first.
  const { projectRevenueSynthesizers } = await import(
    "@carbon/ee/project-revenue.server"
  );
  commercial.synthesizers = [extra];
  try {
    expect(runRowSynthesizers("Revenue Recognition")).toEqual([
      extra,
      synthesizeProjectRevenue,
      synthesizeContractRevenue
    ]);
    expect(projectRevenueSynthesizers).toHaveBeenCalledWith(
      projectRevenueWriters
    );
  } finally {
    commercial.synthesizers = [];
  }
});

test("a Lease run synthesizes only the rental accruals, whatever the caller passes", () => {
  const extra: RunRowSynthesizer = async () => {};
  expect(runRowSynthesizers("Lease", [extra])).toEqual([
    synthesizeRentalAccruals
  ]);
  commercial.synthesizers = [extra];
  try {
    expect(runRowSynthesizers("Lease")).toEqual([synthesizeRentalAccruals]);
  } finally {
    commercial.synthesizers = [];
  }
});

databaseTest(
  "the proposal runs the commercial synthesizer once, inside its transaction, before it claims the due rows",
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
      commercial.synthesizers = [fake];
      const result = await invokePosting(
        handlesOf({ db: f.db, companyId: f.companyId, userId: "system" }),
        "propose-revenue-recognition-run",
        { periodEnd: "2026-09-30" },
        proposeRevenueRecognitionRun
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
      commercial.synthesizers = [];
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);
