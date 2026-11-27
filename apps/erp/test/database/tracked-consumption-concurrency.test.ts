// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function backendPid(db: Kysely<KyselyDatabase>) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(db);
  return rows[0]!.pid;
}

async function waitForBlockedConnection(
  db: Kysely<KyselyDatabase>,
  blockerPid: number,
  waitingPid: number
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
          AND pid = ${waitingPid}
      ) AS blocked
    `.execute(db);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database connection to wait for the held lock");
}

/** A batch-tracked kit, a job material of 10 of it, Reserved assembly units
 *  the issues consume into, and Available lots of the kit in no storage
 *  unit. */
async function kitIssue(
  f: Fixture,
  units: string[],
  lots: [id: string, quantity: number][]
) {
  const kit = `${f.prefix}-kit`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("item")
      .values({
        id: kit,
        readableId: `${f.prefix}-KIT`,
        name: "kit",
        type: "Part",
        itemTrackingType: "Batch",
        replenishmentSystem: "Buy",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("itemCost")
      .set({ costingMethod: "Average", unitCost: 10 })
      .where("itemId", "=", kit)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  const job = await jobFixture(f, "tracked-race");
  const makeMethod = await f.db
    .selectFrom("jobMakeMethod")
    .select("id")
    .where("jobId", "=", job.jobId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const material = await f.db
    .insertInto("jobMaterial")
    .values({
      jobId: job.jobId,
      jobMakeMethodId: makeMethod.id,
      jobOperationId: job.operationId,
      itemId: kit,
      itemType: "Part",
      methodType: "Pull from Inventory",
      description: "kit",
      quantity: 10,
      estimatedQuantity: 10,
      requiresBatchTracking: true,
      unitOfMeasureCode: "EA",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await seed(f, async (trx) => {
    await trx
      .insertInto("trackedEntity")
      .values([
        ...units.map((id) => ({
          id,
          quantity: 1,
          status: "Reserved" as const,
          sourceDocument: "Item",
          sourceDocumentId: f.assemblyId,
          itemId: f.assemblyId,
          companyId: f.companyId,
          createdBy: USER
        })),
        ...lots.map(([id, quantity]) => ({
          id,
          readableId: id,
          quantity,
          status: "Available" as const,
          sourceDocument: "Item",
          sourceDocumentId: kit,
          itemId: kit,
          companyId: f.companyId,
          createdBy: USER
        }))
      ])
      .execute();
    await trx
      .insertInto("itemLedger")
      .values(
        lots.map(([trackedEntityId, quantity]) => ({
          itemId: kit,
          trackedEntityId,
          quantity,
          locationId: f.locationId,
          entryType: "Positive Adjmt." as const,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });

  /** Issues `quantity` of `lot` into `unit`, confirmed past the requirement
   *  (allowOverIssue), so the issue does not lock the job material. */
  const issueFrom = (
    db: Kysely<KyselyDatabase>,
    unit: string,
    lot: string,
    quantity: number
  ) =>
    invokePosting(
      { db, companyId: f.companyId, userId: USER },
      "issue",
      {
        type: "trackedEntitiesToOperation",
        materialId: material.id,
        parentTrackedEntityId: unit,
        children: [{ trackedEntityId: lot, quantity }],
        allowOverIssue: true
      },
      issueMaterial
    );
  return { kit, materialId: material.id, issueFrom };
}

/** Runs `later` on its own connection while another connection holds the
 *  row lock on `row` and writes under it; commits that write once `later`
 *  waits, after `meanwhile` has run. */
async function runBehindRowLock<T>(
  row: string,
  later: (db: Kysely<KyselyDatabase>) => Promise<T>,
  options: {
    write?: (trx: KyselyTx) => Promise<unknown>;
    meanwhile?: () => Promise<void>;
  } = {}
) {
  const second = await connectLocalTestDatabase();
  const blocker = await connectLocalTestDatabase();
  const monitor = await connectLocalTestDatabase();
  const held = signal();
  const release = signal();
  let blocking: Promise<void> | undefined;
  let running: Promise<T> | undefined;
  try {
    const blockerPid = await backendPid(blocker);
    const secondPid = await backendPid(second);
    blocking = blocker.transaction().execute(async (trx) => {
      await sql`SELECT 1 FROM "trackedEntity" WHERE id = ${row} FOR UPDATE`.execute(
        trx
      );
      await options.write?.(trx);
      held.resolve();
      await release.promise;
    });
    void blocking.catch(() => {});
    await Promise.race([held.promise, blocking]);

    running = later(second);
    void running.catch(() => {});
    await waitForBlockedConnection(monitor, blockerPid, secondPid);
    await options.meanwhile?.();
    release.resolve();
    await blocking;
    return await running;
  } finally {
    release.resolve();
    await blocking?.catch(() => {});
    await running?.catch(() => {});
    await second.destroy();
    await blocker.destroy();
    await monitor.destroy();
  }
}

// Two issues of a batch-tracked material, each from its own lot into its own
// unit. The second reads quantityIssued, then waits on its unit; the first
// commits. Both units left their lots, so quantityIssued counts both.
databaseTest(
  "two tracked issues into one job material at once both count in quantityIssued",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const [unitA, unitB] = [`${f.prefix}-unit-a`, `${f.prefix}-unit-b`];
      const [lotA, lotB] = [`${f.prefix}-lot-a`, `${f.prefix}-lot-b`];
      const { kit, materialId, issueFrom } = await kitIssue(
        f,
        [unitA, unitB],
        [
          [lotA, 5],
          [lotB, 5]
        ]
      );

      const later = await runBehindRowLock(
        unitB,
        (db) => issueFrom(db, unitB, lotB, 1),
        {
          meanwhile: async () => {
            expect((await issueFrom(f.db, unitA, lotA, 1)).error).toBeNull();
          }
        }
      );
      expect(later.error).toBeNull();

      const consumed = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum<string>("quantity").as("quantity"))
        .where("itemId", "=", kit)
        .where("entryType", "=", "Consumption")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const row = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", materialId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect({
        consumed: Number(consumed.quantity),
        quantityIssued: Number(row.quantityIssued)
      }).toEqual({ consumed: -2, quantityIssued: 2 });
    } finally {
      await f.cleanup();
    }
  }
);

// A partial issue writes the lot's quantity as a value. Read before an
// adjustment of +1 committed, it wrote 10 - 6 = 4 over the 11, and the lot
// held 4 against 5 on the ledger.
databaseTest(
  "a partial issue of a lot during an adjustment of it leaves the lot what the ledger holds",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const unit = `${f.prefix}-unit`;
      const lot = `${f.prefix}-lot`;
      const { kit, issueFrom } = await kitIssue(f, [unit], [[lot, 10]]);

      const result = await runBehindRowLock(
        lot,
        (db) => issueFrom(db, unit, lot, 6),
        {
          write: async (trx) => {
            await trx
              .insertInto("itemLedger")
              .values({
                itemId: kit,
                trackedEntityId: lot,
                quantity: 1,
                locationId: f.locationId,
                entryType: "Positive Adjmt.",
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
            await trx
              .updateTable("trackedEntity")
              .set({ quantity: 11 })
              .where("id", "=", lot)
              .where("companyId", "=", f.companyId)
              .execute();
          }
        }
      );
      expect(result.error).toBeNull();

      const entity = await f.db
        .selectFrom("trackedEntity")
        .select("quantity")
        .where("id", "=", lot)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum<string>("quantity").as("quantity"))
        .where("trackedEntityId", "=", lot)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      // 10 + 1 adjusted - 6 issued.
      expect({
        entity: Number(entity.quantity),
        ledger: Number(ledger.quantity)
      }).toEqual({ entity: 5, ledger: 5 });
    } finally {
      await f.cleanup();
    }
  }
);
