// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { alwaysPostFixture, jobFixture, seed, USER } from "./fixtures/always-post";
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

// Both postings draw the same job material for different parent units, so the
// parent locks are independent. allowOverIssue leaves the material row unlocked.
// The second reads quantityIssued, then waits on its lot; the first commits.
// Both units left their lots, so quantityIssued counts both.
databaseTest(
  "two tracked issues into one job material at once both count in quantityIssued",
  async () => {
    const f = await alwaysPostFixture();
    const second = await connectLocalTestDatabase();
    const blocker = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let blocking: Promise<void> | undefined;
    let issuing: Promise<unknown> | undefined;
    try {
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
          quantity: 2,
          estimatedQuantity: 2,
          requiresBatchTracking: true,
          unitOfMeasureCode: "EA",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const parentA = `${f.prefix}-unit-a`;
      const parentB = `${f.prefix}-unit-b`;
      const lotA = `${f.prefix}-lot-a`;
      const lotB = `${f.prefix}-lot-b`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("trackedEntity")
          .values([
            ...[parentA, parentB].map((id) => ({
              id,
              quantity: 1,
              status: "Reserved" as const,
              sourceDocument: "Item" as const,
              sourceDocumentId: f.assemblyId,
              itemId: f.assemblyId,
              companyId: f.companyId,
              createdBy: USER
            })),
            ...[lotA, lotB].map((id) => ({
              id,
              readableId: id,
              quantity: 5,
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
            [lotA, lotB].map((trackedEntityId) => ({
              itemId: kit,
              trackedEntityId,
              quantity: 5,
              locationId: f.locationId,
              entryType: "Positive Adjmt." as const,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      });

      const issueFrom = (
        db: Kysely<KyselyDatabase>,
        lot: string,
        parentTrackedEntityId: string
      ) =>
        invokePosting(
          { db, companyId: f.companyId, userId: USER },
          "issue",
          {
            type: "trackedEntitiesToOperation",
            materialId: material.id,
            parentTrackedEntityId,
            children: [{ trackedEntityId: lot, quantity: 1 }],
            allowOverIssue: true
          },
          issueMaterial
        );

      const blockerPid = await backendPid(blocker);
      const secondPid = await backendPid(second);

      blocking = blocker.transaction().execute(async (trx) => {
        await sql`SELECT 1 FROM "trackedEntity" WHERE id = ${lotB} FOR UPDATE`.execute(
          trx
        );
        held.resolve();
        await release.promise;
      });
      void blocking.catch(() => {});
      await Promise.race([held.promise, blocking]);

      const later = issueFrom(second, lotB, parentB);
      issuing = later;
      void later.catch(() => {});
      await waitForBlockedConnection(monitor, blockerPid, secondPid);

      expect((await issueFrom(f.db, lotA, parentA)).error).toBeNull();
      release.resolve();
      await blocking;
      expect((await later).error).toBeNull();

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
        .where("id", "=", material.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect({
        consumed: Number(consumed.quantity),
        quantityIssued: Number(row.quantityIssued)
      }).toEqual({ consumed: -2, quantityIssued: 2 });
    } finally {
      release.resolve();
      await blocking?.catch(() => {});
      await issuing?.catch(() => {});
      await second.destroy();
      await blocker.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);
