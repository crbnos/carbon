// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import { calculateCOGS } from "../../app/modules/shared/shared.service";
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

// One FIFO layer of 5 at 10 each. A TypeScript consumer (calculateCOGS, which
// every shipment, adjustment and issue calls) relieves all 5 and holds its
// transaction; the job's backflush then needs 2 of the item. However the two
// interleave, the layer gives at most its 5.
databaseTest(
  "the job's backflush does not relieve a FIFO layer a concurrent consumer emptied",
  async () => {
    const f = await alwaysPostFixture();
    const consumer = await connectLocalTestDatabase();
    const backflusher = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let consuming: Promise<void> | undefined;
    let backflushing: Promise<unknown> | undefined;
    try {
      const item = `${f.prefix}-fifo`;
      const bin = `${f.prefix}-bin`;
      let layerId = "";
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-FIFO`,
            name: "fifo material",
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        // An item insert may already have created its cost row.
        await trx.deleteFrom("itemCost").where("itemId", "=", item).execute();
        await trx
          .insertInto("itemCost")
          .values({
            itemId: item,
            costingMethod: "FIFO",
            unitCost: 10,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("storageUnit")
          .values({
            id: bin,
            name: "Bin",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            entryType: "Positive Adjmt.",
            documentType: "Inventory Receipt",
            itemId: item,
            locationId: f.locationId,
            storageUnitId: bin,
            quantity: 5,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        const layer = await trx
          .insertInto("costLedger")
          .values({
            itemLedgerType: "Purchase",
            costLedgerType: "Direct Cost",
            adjustment: false,
            itemId: item,
            quantity: 5,
            cost: 50,
            remainingQuantity: 5,
            postingDate: "2026-01-01",
            companyId: f.companyId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        layerId = layer.id;
      });
      const job = await jobFixture(f, "layer-race");
      await f.db
        .updateTable("jobMaterial")
        .set({ itemId: item, storageUnitId: bin })
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();

      const consumerPid = await backendPid(consumer);
      const backflushPid = await backendPid(backflusher);

      consuming = consumer.transaction().execute(async (trx) => {
        await calculateCOGS(trx, {
          itemId: item,
          quantity: 5,
          companyId: f.companyId
        });
        held.resolve();
        await release.promise;
      });
      void consuming.catch(() => {});
      await Promise.race([held.promise, consuming]);

      const backflush = sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        backflusher
      );
      backflushing = backflush;
      void backflush.catch(() => {});
      await waitForBlockedConnection(monitor, consumerPid, backflushPid);

      release.resolve();
      await consuming;
      await backflush;

      const layer = await f.db
        .selectFrom("costLedger")
        .select("remainingQuantity")
        .where("id", "=", layerId)
        .executeTakeFirstOrThrow();
      expect(Number(layer.remainingQuantity)).toBe(0);
    } finally {
      release.resolve();
      await consuming?.catch(() => {});
      await backflushing?.catch(() => {});
      await consumer.destroy();
      await backflusher.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);
