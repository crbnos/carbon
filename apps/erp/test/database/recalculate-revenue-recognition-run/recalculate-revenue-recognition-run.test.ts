// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect, test } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";
import {
  lockRecognitionProposals,
  previewRevenueRecognitionRun,
  proposeRevenueRecognitionRunInput, proposeRevenueRecognitionRun, recalculateRevenueRecognitionRun } from "../../../app/modules/accounting/accounting.service";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  dropRecognitionRuns,
  holdInDraftRun
} from "../fixtures/run";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

/** Planned deferral rows on the fixture's invoice line, keyed by suffix. */
async function deferrals<K extends string>(
  f: Fixture,
  rows: {
    key: K;
    scheduledDate: string;
    amount: number;
    rentalAgreementLineId?: string;
  }[]
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
        rentalAgreementLineId: row.rentalAgreementLineId ?? null,
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
  const result = await invokePosting(handlesOf({
        db: f.db,
        companyId: f.companyId,
        userId: "system"
      }), "recalculate-revenue-recognition-run", { runId }, recalculateRevenueRecognitionRun);
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

async function propose(f: Fixture, periodEnd: string) {
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
  const result = await invokePosting(handlesOf({
        db: f.db,
        companyId: f.companyId,
        userId: "system"
      }), "propose-revenue-recognition-run", { periodEnd }, proposeRevenueRecognitionRun);
  if (result.error) throw result.error;
  return result.data;
}

databaseTest(
  "a period with a posted run takes a second run for rows that fell due after it posted",
  async () => {
    const f = await paymentFixture();
    try {
      const ids = await deferrals(f, [
        { key: "sep-15", scheduledDate: "2026-09-15", amount: 100 }
      ]);
      const firstRunId = await holdInDraftRun(f.db, f.companyId, [
        ids["sep-15"]
      ]);
      await f.db
        .updateTable("revenueRecognitionRun")
        .set({ status: "Posted" })
        .where("id", "=", firstRunId)
        .execute();
      const late = await deferrals(f, [
        { key: "sep-30", scheduledDate: "2026-09-30", amount: 50 }
      ]);

      const second = await propose(f, "2026-09-30");

      expect(second?.lineCount).toBe(1);
      expect(second?.id).not.toBe(firstRunId);
      expect(await runLines(f, second!.id)).toEqual([
        { scheduleId: late["sep-30"], amount: 50 }
      ]);
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "a period with a Draft run is recalculated, not proposed again",
  async () => {
    const f = await paymentFixture();
    try {
      const ids = await deferrals(f, [
        { key: "sep-15", scheduledDate: "2026-09-15", amount: 100 }
      ]);
      await holdInDraftRun(f.db, f.companyId, [ids["sep-15"]]);
      await deferrals(f, [
        { key: "sep-30", scheduledDate: "2026-09-30", amount: 50 }
      ]);

      await expect(propose(f, "2026-09-30")).rejects.toThrow(
        "RR-TEST is already a draft for this period"
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

databaseTest(
  "recalculating a Draft that held only a replaced contract month keeps the run and claims what is due",
  async () => {
    const f = await paymentFixture();
    try {
      const contractId = `${f.companyId}-contract`;
      const contractLineId = `${f.companyId}-contract-line`;
      const orphanId = `${f.companyId}-orphan`;
      await f.db.transaction().execute(async (trx) => {
        // The contract line names an item this fixture has no reason to build;
        // only the held schedule row matters here.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .insertInto("customerContract")
          .values({
            id: contractId,
            customerContractId: "CON-TEST",
            name: "Test contract",
            status: "Active",
            customerId: f.customerId,
            closeDate: "2026-07-01",
            startDate: "2026-07-01",
            currencyCode: "USD",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("customerContractLine")
          .values({
            id: contractLineId,
            customerContractId: contractId,
            revenueType: "Recurring",
            rateUnit: "Month",
            itemId: `${f.companyId}-item`,
            rate: 420,
            startDate: "2026-07-01",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        // A contract row whose plan month an amendment replaced: its
        // `customerContractRevenueId` is null, so the contract synthesizer
        // drops it.
        await trx
          .insertInto("revenueRecognitionSchedule")
          .values({
            id: orphanId,
            type: "Deferral",
            status: "Planned",
            customerContractLineId: contractLineId,
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            scheduledDate: "2026-09-30",
            amount: 420,
            debitAccountId: f.account("control"),
            creditAccountId: f.account("sales"),
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });
      const runId = await holdInDraftRun(f.db, f.companyId, [orphanId]);
      const later = await deferrals(f, [
        { key: "sep-30", scheduledDate: "2026-09-30", amount: 50 }
      ]);

      expect(await recalculate(f, runId)).toEqual({
        runId: "RR-TEST",
        lineCount: 1,
        changed: true,
        deleted: false
      });
      expect(await runLines(f, runId)).toEqual([
        { scheduleId: later["sep-30"], amount: 50 }
      ]);
      expect(
        await f.db
          .selectFrom("revenueRecognitionSchedule")
          .select("id")
          .where("id", "=", orphanId)
          .executeTakeFirst()
      ).toBeUndefined();
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

test("a proposal's periodEnd must be a real month end", () => {
  const accepts = (periodEnd: string) =>
    proposeRevenueRecognitionRunInput.safeParse({ periodEnd }).success;
  expect(accepts("2026-09-30")).toBe(true);
  expect(accepts("2028-02-29")).toBe(true);
  // Mid-month, an impossible day and an impossible month are input errors,
  // not a 500 from the database.
  expect(accepts("2026-09-15")).toBe(false);
  expect(accepts("2026-02-30")).toBe(false);
  expect(accepts("2026-13-31")).toBe(false);
});

databaseTest(
  "recalculating a lease Draft re-claims rental rows only",
  async () => {
    const f = await paymentFixture();
    try {
      const rental = `${f.companyId}-rental-line`;
      const ids = await deferrals(f, [
        {
          key: "rentA",
          scheduledDate: "2026-09-30",
          amount: 40,
          rentalAgreementLineId: rental
        },
        {
          key: "rentB",
          scheduledDate: "2026-09-30",
          amount: 15,
          rentalAgreementLineId: rental
        },
        { key: "service", scheduledDate: "2026-09-30", amount: 60 }
      ]);
      const runId = await holdInDraftRun(
        f.db,
        f.companyId,
        [ids.rentA],
        "2026-09-30",
        "Lease"
      );

      const result = await recalculate(f, runId);
      expect(result).toMatchObject({
        lineCount: 2,
        changed: true,
        deleted: false
      });
      expect((await runLines(f, runId)).map((line) => line.scheduleId)).toEqual(
        [ids.rentA, ids.rentB].sort()
      );
    } finally {
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);

/** Waits until `count` connections are queued behind `blockerPid`, directly or
 *  behind another waiter. */
async function waitForBlockedConnections(
  db: Kysely<KyselyDatabase>,
  blockerPid: number,
  count: number
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ blocked: number }>`
      WITH RECURSIVE waiting AS (
        SELECT ${blockerPid}::int AS pid
        UNION
        SELECT a.pid FROM pg_stat_activity a, waiting w
        WHERE w.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT count(*)::int - 1 AS blocked FROM waiting
    `.execute(db);
    if ((rows[0]?.blocked ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} connections to wait for the held lock`);
}

databaseTest(
  "recalculating a Draft while the period is previewed does not deadlock",
  async () => {
    const f = await paymentFixture();
    const blocker = await f.connect();
    const recalculating = await f.connect();
    const previewing = await f.connect();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: Promise<void> | undefined;
    try {
      const ids = await deferrals(f, [
        { key: "sep-15", scheduledDate: "2026-09-15", amount: 100 }
      ]);
      const runId = await holdInDraftRun(f.db, f.companyId, [ids["sep-15"]]);
      const {
        rows: [blockerPid]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        blocker
      );

      // A proposal in flight holds the proposal lock, so the recalculation
      // and the preview both queue up before either takes the second lock.
      let held!: () => void;
      const isHeld = new Promise<void>((resolve) => {
        held = resolve;
      });
      holding = blocker.transaction().execute(async (trx) => {
        await lockRecognitionProposals(trx, f.companyId);
        held();
        await released;
      });
      await isHeld;

      const handles = (db: Kysely<KyselyDatabase>) =>
        handlesOf({ db, companyId: f.companyId, userId: "system" });
      const recalculation = invokePosting(
        handles(recalculating),
        "recalculate-revenue-recognition-run",
        { runId },
        recalculateRevenueRecognitionRun
      );
      await waitForBlockedConnections(f.db, blockerPid!.pid, 1);
      const preview = invokePosting(
        handles(previewing),
        "preview-revenue-recognition-run",
        { periodEnd: "2026-09-30", type: "Revenue Recognition" as const },
        previewRevenueRecognitionRun
      );
      await waitForBlockedConnections(f.db, blockerPid!.pid, 2);
      release();
      await holding;

      const [recalculated, previewed] = await Promise.all([
        recalculation,
        preview
      ]);
      expect([recalculated.error, previewed.error]).toEqual([null, null]);
      expect(previewed.data).toEqual({ count: 0, amount: 0 });
    } finally {
      release();
      await holding?.catch(() => {});
      await blocker.destroy();
      await recalculating.destroy();
      await previewing.destroy();
      await dropRecognitionRuns(f.db, f.companyId);
      await f.cleanup();
    }
  }
);
