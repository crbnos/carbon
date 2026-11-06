// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  closeAccountingPeriod,
  postJournalEntry
} from "../../app/modules/accounting/accounting.service";
import { postgrestTest } from "./fixtures/local-supabase";
import { paymentFixture } from "./fixtures/payment";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForBlockedConnection(
  db: Kysely<KyselyDatabase>,
  blockerPid: number,
  waitingPid?: number
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
          AND (${waitingPid ?? null}::int IS NULL OR pid = ${waitingPid ?? null}::int)
      ) AS blocked
    `.execute(db);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database connection to wait for the held lock");
}

async function prepareClose(f: Awaited<ReturnType<typeof paymentFixture>>) {
  const period = await f.db
    .selectFrom("accountingPeriod")
    .select("id")
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  await f.db
    .updateTable("accountingPeriod")
    .set({
      closeStatus: "Locked",
      lockedAt: "2026-10-01T00:00:00Z",
      lockedBy: "system"
    })
    .where("id", "=", period.id)
    .where("companyId", "=", f.companyId)
    .execute();
  return {
    periodId: period.id,
    companyId: f.companyId,
    companyGroupId: f.groupId,
    userId: "system"
  };
}

postgrestTest(
  "close waits for an in-flight period writer and evaluates its committed checklist blockers",
  async (client) => {
    const f = await paymentFixture();
    const writer = await f.connect();
    const monitor = await f.connect();
    const held = signal();
    const release = signal();
    let writing: Promise<void> | undefined;
    let closing: ReturnType<typeof closeAccountingPeriod> | undefined;
    try {
      const args = await prepareClose(f);
      await f.db
        .insertInto("periodCloseTaskDefinition")
        .values({
          companyId: f.companyId,
          name: "Post draft journals",
          taskType: "Auto",
          autoCheckKey: "draft-journals",
          required: true,
          severity: "Blocker",
          createdBy: "system"
        })
        .execute();
      const {
        rows: [writerPid]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        writer
      );
      const {
        rows: [closePid]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        f.db
      );
      writing = writer.transaction().execute(async (trx) => {
        await trx
          .selectFrom("accountingPeriod")
          .select("id")
          .where("id", "=", args.periodId)
          .where("companyId", "=", f.companyId)
          .forShare()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("journal")
          .values({
            companyId: f.companyId,
            accountingPeriodId: args.periodId,
            journalEntryId: "CLOSE-CONCURRENT-DRAFT",
            sourceType: "Manual",
            status: "Draft",
            postingDate: "2026-09-15",
            createdBy: "system"
          })
          .execute();
        held.resolve();
        await release.promise;
      });
      void writing.catch(() => {});
      await Promise.race([held.promise, writing]);
      closing = closeAccountingPeriod(client, f.db, args);
      await waitForBlockedConnection(monitor, writerPid!.pid, closePid!.pid);
      release.resolve();
      await writing;
      const result = await closing;
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
      expect(
        await f.db
          .selectFrom("accountingPeriod")
          .select("closeStatus")
          .where("companyId", "=", f.companyId)
          .where("id", "=", args.periodId)
          .executeTakeFirstOrThrow()
      ).toEqual({ closeStatus: "Locked" });
      expect(
        await f.db
          .selectFrom("accountingPeriodBalance")
          .select("id")
          .where("companyId", "=", f.companyId)
          .execute()
      ).toEqual([]);
    } finally {
      release.resolve();
      await writing?.catch(() => {});
      await closing?.catch(() => {});
      await writer.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);

postgrestTest(
  "close can instantiate checklist tasks while holding its period lock and rejects later accounting adjustments",
  async (client) => {
    const f = await paymentFixture();
    const instantiator = await f.connect();
    const monitor = await f.connect();
    const held = signal();
    const release = signal();
    let instantiating: Promise<void> | undefined;
    let closing: ReturnType<typeof closeAccountingPeriod> | undefined;
    let postingResult: ReturnType<typeof postJournalEntry> | undefined;
    try {
      const args = await prepareClose(f);
      const journal = await f.db
        .insertInto("journal")
        .values({
          companyId: f.companyId,
          journalEntryId: "CLOSE-LATE-ADJUSTMENT",
          sourceType: "Manual",
          status: "Draft",
          postingDate: "2026-09-15",
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("journalLine")
        .values(
          [
            { accountId: f.account("bank"), amount: 10 },
            { accountId: f.account("sales"), amount: 10 }
          ].map((line) => ({
            ...line,
            companyId: f.companyId,
            journalId: journal.id,
            quantity: 1,
            journalLineReference: journal.id
          }))
        )
        .execute();
      const definition = await f.db
        .insertInto("periodCloseTaskDefinition")
        .values({
          companyId: f.companyId,
          name: "Invoice shipped sales orders",
          taskType: "Auto",
          autoCheckKey: "shipped-not-invoiced",
          required: true,
          severity: "Warning",
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const {
        rows: [instantiatorPid]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        instantiator
      );
      const {
        rows: [closePid]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        f.db
      );
      instantiating = instantiator.transaction().execute(async (trx) => {
        // A competing checklist insertion pauses the close at its FK-compatible upsert.
        await trx
          .insertInto("periodCloseTask")
          .values({
            companyId: f.companyId,
            accountingPeriodId: args.periodId,
            definitionId: definition.id,
            sortOrder: 1,
            name: "Invoice shipped sales orders",
            taskType: "Auto",
            autoCheckKey: "shipped-not-invoiced",
            required: true,
            severity: "Warning",
            createdBy: "system"
          })
          .execute();
        held.resolve();
        await release.promise;
      });
      void instantiating.catch(() => {});
      await Promise.race([held.promise, instantiating]);
      closing = closeAccountingPeriod(client, f.db, args);
      await waitForBlockedConnection(monitor, instantiatorPid!.pid);
      postingResult = postJournalEntry(client, journal.id, "system");
      void postingResult.catch(() => {});
      await Promise.race([
        waitForBlockedConnection(monitor, closePid!.pid),
        postingResult.then((result) => {
          throw new Error(
            `Posting completed before the close released its lock: ${JSON.stringify(result)}`
          );
        })
      ]);
      release.resolve();
      await instantiating;
      expect(await closing).toEqual({
        data: { id: args.periodId },
        error: null
      });
      const rejectedPosting = await postingResult;
      expect(rejectedPosting.data).toBeNull();
      expect(rejectedPosting.error).not.toBeNull();
      expect(
        await f.db
          .selectFrom("journal")
          .select("status")
          .where("companyId", "=", f.companyId)
          .where("id", "=", journal.id)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Draft" });
      expect(
        await f.db
          .selectFrom("periodCloseTask")
          .select("status")
          .where("companyId", "=", f.companyId)
          .where("definitionId", "=", definition.id)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Done" });
      expect(
        await f.db
          .selectFrom("accountingPeriodBalance")
          .select("endingBalance")
          .where("companyId", "=", f.companyId)
          .where("accountId", "=", f.account("bank"))
          .where("accountingPeriodId", "=", args.periodId)
          .executeTakeFirstOrThrow()
      ).toEqual({ endingBalance: 0 });
    } finally {
      release.resolve();
      await instantiating?.catch(() => {});
      await closing?.catch(() => {});
      await postingResult?.catch(() => {});
      await instantiator.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);

for (const failedCheck of [
  { table: "shipmentFixedAssetLine", key: "shipped-not-invoiced" },
  { table: "indirectPool", key: "burden-computed" }
]) {
  postgrestTest(
    `an optional ${failedCheck.key} query failure remains a warning and does not abort closing`,
    async (client) => {
      const f = await paymentFixture();
      try {
        const args = await prepareClose(f);
        const definition = await f.db
          .insertInto("periodCloseTaskDefinition")
          .values({
            companyId: f.companyId,
            name: "Invoice shipped sales orders",
            taskType: "Auto",
            autoCheckKey: failedCheck.key,
            required: false,
            severity: "Warning",
            createdBy: "system"
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await f.db
          .insertInto("periodCloseTaskDefinition")
          .values({
            companyId: f.companyId,
            name: "Close earned value",
            taskType: "Auto",
            autoCheckKey: "earned-value-closed",
            required: true,
            severity: "Warning",
            createdBy: "system"
          })
          .execute();
        // Only this connection sees the failing view; company data stays untouched.
        await sql`CREATE TEMP VIEW ${sql.id(failedCheck.table)} AS
        SELECT * FROM ${sql.id("public", failedCheck.table)} WHERE 1 / 0 = 0`.execute(
          f.db
        );
        const emptyPreview = { count: 0, amount: 0, error: null };
        const result = await closeAccountingPeriod(
          client,
          f.db,
          args,
          async () => ({
            revenue: emptyPreview,
            lease: emptyPreview,
            depreciation: emptyPreview
          }),
          { governmentContracting: true }
        );
        expect(result).toEqual({ data: { id: args.periodId }, error: null });
        expect(
          await f.db
            .selectFrom("accountingPeriod")
            .select("closeStatus")
            .where("id", "=", args.periodId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).toEqual({ closeStatus: "Closed" });
        expect(
          await f.db
            .selectFrom("periodCloseTask")
            .select("status")
            .where("definitionId", "=", definition.id)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).toEqual({ status: "Open" });
        expect(
          await f.db
            .selectFrom("accountingPeriodBalance")
            .select("endingBalance")
            .where("accountingPeriodId", "=", args.periodId)
            .where("companyId", "=", f.companyId)
            .where("accountId", "=", f.account("bank"))
            .executeTakeFirstOrThrow()
        ).toEqual({ endingBalance: 0 });
      } finally {
        await sql`DROP VIEW IF EXISTS ${sql.id("pg_temp", failedCheck.table)}`.execute(
          f.db
        );
        await f.cleanup();
      }
    }
  );
}
