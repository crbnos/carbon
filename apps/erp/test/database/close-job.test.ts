// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  jobFixture,
  journalLinesOf,
  newJournals,
  seed,
  stampCutover,
  stockPart,
  unwrap
} from "./fixtures/always-post";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  closeJob,
  postProductionEvent
} from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { projectPostingFixture } from "./fixtures/project-posting";

/** Issues the job's two parts to its operation by hand. */
async function issueTwoParts(
  f: Fixture,
  job: Awaited<ReturnType<typeof jobFixture>>
) {
  unwrap(
    await invokePosting(handlesOf(f.ctx), "issue", {
            type: "partToOperation",
            id: job.operationId,
            itemId: f.partId,
            materialId: job.materialId,
            quantity: 2,
            adjustmentType: "Negative Adjmt."
          }, issue)
  );
}

databaseTest(
  "close-job writes a Provisional variance before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      // Before the cutover: 20 of material in WIP, written off on close.
      const before = await jobFixture(f, "1");
      await issueTwoParts(f, before);
      const provisional = await newJournals(f, async () =>
        await closeJob(f.service, { jobId: before.jobId })
      );
      await expectProvisionalJournals(f, provisional, "Job Close");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("filler"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Job Close"
        },
        {
          accountId: f.account("wip"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Job Close"
        }
      ]);

      // After the cutover: the same close posts in the current period.
      const periodId = await stampCutover(f);
      const after = await jobFixture(f, "2");
      await issueTwoParts(f, after);
      const posted = await newJournals(f, async () =>
        await closeJob(f.service, { jobId: after.jobId })
      );
      await expectPostedJournals(f, posted, "Job Close", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

/** The WIP balance of a job: every WIP line documented against it. */
async function wipOf(
  f: Awaited<ReturnType<typeof projectPostingFixture>>,
  jobId: string
) {
  const row = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.sum<number>("amount").as("balance"))
    .where("companyId", "=", f.companyId)
    .where("accountId", "=", f.account("wip"))
    .where("documentId", "=", jobId)
    .executeTakeFirstOrThrow();
  return Number(row.balance ?? 0);
}

databaseTest(
  "closing a consume-to-project job on a Contract project leaves the project's cost on Project WIP",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      // The backfilled default: Project WIP is the WIP account.
      await f.db
        .updateTable("accountDefault")
        .set({ projectWorkInProgressAccount: f.account("wip") })
        .where("companyId", "=", f.companyId)
        .execute();
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("a", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1
      });

      // 30 of material to the project.
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          { type: "jobOperation", id: job.operationId, quantity: 1 },
          issue
        )
      );
      // 100 of labor to the project (2 h at 50).
      const event = await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: job.operationId,
          type: "Labor",
          startTime: "2026-10-05T08:00:00Z",
          endTime: "2026-10-05T10:00:00Z",
          employeeId: "system",
          workCenterId: job.workCenterId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const posted = unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-production-event",
          { productionEventId: event.id },
          postProductionEvent
        )
      );
      expect(posted.success).toBe(true);

      // Another 100 of labor, never posted on its own: completion posts it
      // in SQL (complete_job_to_inventory), with its projectLedger row.
      await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: job.operationId,
          type: "Labor",
          startTime: "2026-10-06T08:00:00Z",
          endTime: "2026-10-06T10:00:00Z",
          employeeId: "system",
          workCenterId: job.workCenterId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await sql`
        SELECT complete_job_to_inventory(
          ${job.jobId}, 1, NULL, ${locationId}, ${f.companyId}, 'system'
        )
      `.execute(f.db);

      expect(await wipOf(f, job.jobId)).toEqual(230);

      await closeJob(f.service, { jobId: job.jobId });

      const variance = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Close")
        .where("documentId", "=", job.jobId)
        .execute();
      expect(variance).toEqual([]);

      // The project's cost is still on Project WIP, equal to its ledger.
      const ledger = await f.db
        .selectFrom("projectLedger")
        .select((eb) => eb.fn.sum<number>("amount").as("amount"))
        .where("companyId", "=", f.companyId)
        .where("jobId", "=", job.jobId)
        .executeTakeFirstOrThrow();
      expect(Number(ledger.amount)).toEqual(230);
      expect(await wipOf(f, job.jobId)).toEqual(230);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "closing a capital job still clears its WIP, project rows and all",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { fixedAssetId } = await f.addCapitalAsset({
        status: "Under Construction",
        finalAssetElement: true
      });
      const { itemId, locationId } = await f.addStockedItem("bracket", {
        quantity: 10,
        unitCost: 10
      });
      const job = await f.addConsumeToProjectJob("cap", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 3,
        jobQuantity: 1,
        consumeToProject: false
      });
      await f.db
        .updateTable("job")
        .set({
          projectId: f.projectId,
          projectElementId: f.elementId,
          fixedAssetId
        })
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          { type: "jobOperation", id: job.operationId, quantity: 1 },
          issue
        )
      );
      // The capital job's material sits on WIP with a projectLedger row.
      const rows = await f.db
        .selectFrom("projectLedger")
        .select("journalLineId")
        .where("companyId", "=", f.companyId)
        .where("jobId", "=", job.jobId)
        .execute();
      expect(rows).toHaveLength(1);
      expect(await wipOf(f, job.jobId)).toEqual(30);

      await closeJob(f.service, { jobId: job.jobId });

      const variance = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Close")
        .where("documentId", "=", job.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        variance.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("misc"), 30],
        [f.account("wip"), -30]
      ]);
      expect(await wipOf(f, job.jobId)).toEqual(0);
    } finally {
      await f.cleanup();
    }
  }
);

for (const status of ["Closed", "Cancelled"] as const) {
  databaseTest(
    `completing a ${status} job is refused and receives nothing`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stockPart(f, 10);
        const job = await jobFixture(f, "1");
        await issueTwoParts(f, job);
        await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${f.locationId}, ${f.companyId}, ${"system"})`.execute(
          f.db
        );
        await f.db
          .updateTable("job")
          .set({ status })
          .where("id", "=", job.jobId)
          .where("companyId", "=", f.companyId)
          .execute();
        // Closing writes off the WIP: a later receipt would bring units in at
        // about zero cost and send the job back to Completed.
        if (status === "Closed") {
          await closeJob(f.service, { jobId: job.jobId });
        }

        await expect(
          sql`SELECT complete_job_to_inventory(${job.jobId}, ${2}::numeric, ${null}, ${f.locationId}, ${f.companyId}, ${"system"})`.execute(
            f.db
          )
        ).rejects.toThrow(/cannot be completed/);

        expect(
          await f.db
            .selectFrom("job")
            .select(["status", "quantityReceivedToInventory"])
            .where("id", "=", job.jobId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).toEqual({ status, quantityReceivedToInventory: 1 });
        const received = await f.db
          .selectFrom("itemLedger")
          .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", f.assemblyId)
          .executeTakeFirstOrThrow();
        expect(Number(received.quantity)).toEqual(1);
      } finally {
        await f.cleanup();
      }
    }
  );
}

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

/** A Ready job whose one operation, its last, is Ready to be marked Done. */
async function readyJob(f: Fixture) {
  const job = await jobFixture(f, "1");
  await seed(f, async (trx) => {
    await trx
      .updateTable("job")
      .set({ status: "Ready" })
      .where("id", "=", job.jobId)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({ status: "Ready" })
      .where("id", "=", job.operationId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  return job;
}

/** The operation's status, the job's status and receipt, and the job's
 *  receipt ledger rows. */
async function finishState(
  f: Fixture,
  job: Awaited<ReturnType<typeof readyJob>>
) {
  const operation = await f.db
    .selectFrom("jobOperation")
    .select("status")
    .where("id", "=", job.operationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const row = await f.db
    .selectFrom("job")
    .select(["status", "quantityReceivedToInventory"])
    .where("id", "=", job.jobId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const receipts = await f.db
    .selectFrom("itemLedger")
    .select("id")
    .where("companyId", "=", f.companyId)
    .where("documentId", "=", job.jobId)
    .execute();
  return {
    operation: operation.status,
    job: row.status,
    quantityReceivedToInventory: Number(row.quantityReceivedToInventory),
    receipts: receipts.length
  };
}

// Planned: a status the trigger's first, unlocked gate refuses (no batch), so
// the gate under the lock must refuse it too.
for (const status of ["Closed", "Cancelled", "Planned"] as const) {
  databaseTest(
    `marking the last operation Done while the job moves to ${status} keeps the job ${status} and the Done`,
    async () => {
      const f = await alwaysPostFixture();
      const closer = await connectLocalTestDatabase();
      const operator = await connectLocalTestDatabase();
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding: Promise<void> | undefined;
      let finishing: Promise<unknown> | undefined;
      try {
        const job = await readyJob(f);
        const {
          rows: [closerPid]
        } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
          closer
        );

        // The close holds the job lock and has set the status, uncommitted.
        let held!: () => void;
        const isHeld = new Promise<void>((resolve) => {
          held = resolve;
        });
        holding = closer.transaction().execute(async (trx) => {
          await trx
            .selectFrom("job")
            .select("id")
            .where("id", "=", job.jobId)
            .where("companyId", "=", f.companyId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("job")
            .set({ status })
            .where("id", "=", job.jobId)
            .where("companyId", "=", f.companyId)
            .execute();
          held();
          await released;
        });
        void holding.catch(() => {});
        await Promise.race([isHeld, holding]);

        // The Done trigger reads Ready without a lock, then waits on the job
        // lock the close holds.
        finishing = operator
          .updateTable("jobOperation")
          .set({ status: "Done" })
          .where("id", "=", job.operationId)
          .where("companyId", "=", f.companyId)
          .execute();
        void finishing.catch(() => {});
        await waitForBlockedConnections(f.db, closerPid!.pid, 1);
        release();
        await holding;

        await expect(finishing).resolves.toBeDefined();
        expect(await finishState(f, job)).toEqual({
          operation: "Done",
          job: status,
          quantityReceivedToInventory: 0,
          receipts: 0
        });
      } finally {
        release();
        await holding?.catch(() => {});
        await finishing?.catch(() => {});
        await closer.destroy();
        await operator.destroy();
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "marking the last operation of a Closed job Done keeps the job Closed and receives nothing",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await readyJob(f);
      await f.db
        .updateTable("job")
        .set({ status: "Closed" })
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();

      await f.db
        .updateTable("jobOperation")
        .set({ status: "Done" })
        .where("id", "=", job.operationId)
        .where("companyId", "=", f.companyId)
        .execute();

      expect(await finishState(f, job)).toEqual({
        operation: "Done",
        job: "Closed",
        quantityReceivedToInventory: 0,
        receipts: 0
      });
    } finally {
      await f.cleanup();
    }
  }
);
