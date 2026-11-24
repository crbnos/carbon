// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL) and its PostgREST; skipped
// without them.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import { reverseJournalEntry } from "../../app/modules/accounting/accounting.service";
import { postgrestTest } from "./fixtures/local-supabase";
import { paymentFixture } from "./fixtures/payment";

/** Waits until `count` connections are queued behind `blockerPid`, directly or
 *  behind another waiter (a second row-lock waiter queues on the first). */
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

postgrestTest(
  "two reversals of one posted journal at once write one reversal",
  async (client) => {
    const f = await paymentFixture();
    const blocker = await f.connect();
    const first = await f.connect();
    const second = await f.connect();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: Promise<void> | undefined;
    try {
      const original = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("journalEntryId", "=", "TEST-ORIGINAL")
        .executeTakeFirstOrThrow();
      // A reversal posts on the company's today, in its open period.
      await sql`
        INSERT INTO "accountingPeriod"
          ("startDate", "endDate", status, "closeStatus", "companyId", "createdBy")
        SELECT date_trunc('month', today)::date,
               (date_trunc('month', today) + interval '1 month - 1 day')::date,
               'Active', 'Open', ${f.companyId}, 'system'
        FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today) t
      `.execute(f.db);
      const {
        rows: [blockerPid]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        blocker
      );

      // Hold the journal so both reversals have read it before either writes.
      let held!: () => void;
      const isHeld = new Promise<void>((resolve) => {
        held = resolve;
      });
      holding = blocker.transaction().execute(async (trx) => {
        await trx
          .selectFrom("journal")
          .select("id")
          .where("id", "=", original.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        held();
        await released;
      });
      await isHeld;

      // The reversals run with the triggers a request runs with.
      for (const db of [first, second]) {
        await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
          db
        );
      }
      const args = { companyId: f.companyId, userId: "system" };
      const reversals = [first, second].map((db) =>
        reverseJournalEntry(client, db, original.id, args)
      );
      await waitForBlockedConnections(f.db, blockerPid!.pid, 2);
      release();
      await holding;
      const results = await Promise.all(reversals);

      expect(results.filter((result) => result.error === null)).toHaveLength(
        1
      );
      // One reversal, netting the original's two lines of 100.
      const written = await f.db
        .selectFrom("journal as j")
        .innerJoin("journalLine as l", "l.journalId", "j.id")
        .select(["j.status", "l.amount"])
        .where("j.companyId", "=", f.companyId)
        .where("j.reversalOfId", "=", original.id)
        .execute();
      expect(
        written.map((row) => ({ ...row, amount: Number(row.amount) }))
      ).toEqual([
        { status: "Posted", amount: -100 },
        { status: "Posted", amount: -100 }
      ]);
      expect(
        await f.db
          .selectFrom("journal")
          .select("status")
          .where("id", "=", original.id)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Reversed" });
    } finally {
      release();
      await holding?.catch(() => {});
      await blocker.destroy();
      await first.destroy();
      await second.destroy();
      await f.cleanup();
    }
  }
);
