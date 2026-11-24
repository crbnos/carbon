// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  workCenterFixture
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
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

type Settings = { strict: boolean; preventNegative: boolean };

// Strict backflush applies only at a location with an active work center and
// an active storage unit; the race below makes the storage unit.
async function setBackflushSettings(f: Fixture, settings: Settings) {
  await f.db
    .updateTable("companySettings")
    .set({
      requireBackflushStorageUnit: settings.strict,
      preventNegativeBackflush: settings.preventNegative
    })
    .where("id", "=", f.companyId)
    .execute();
  if (settings.strict) await workCenterFixture(f);
}

// The job fixture makes one unit, its material 2 per unit and 2 estimated:
// however the backflush and the completion interleave, 2 leave the bin.
async function completionBehindBackflush(settings: Settings) {
  const f = await alwaysPostFixture();
  const backflusher = await connectLocalTestDatabase();
  const monitor = await connectLocalTestDatabase();
  const held = signal();
  const release = signal();
  let backflushing: Promise<void> | undefined;
  let completing: Promise<unknown> | undefined;
  try {
    await setBackflushSettings(f, settings);
    const item = `${f.prefix}-material`;
    const bin = `${f.prefix}-bin`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: item,
          readableId: `${f.prefix}-MATERIAL`,
          name: "material",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
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
          quantity: 10,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const job = await jobFixture(f, "issue-race");
    await f.db
      .updateTable("jobMaterial")
      .set({ itemId: item, storageUnitId: bin })
      .where("id", "=", job.materialId)
      .where("companyId", "=", f.companyId)
      .execute();

    const backflushPid = await backendPid(backflusher);
    const completionPid = await backendPid(f.db);

    backflushing = backflusher.transaction().execute(async (trx) => {
      await sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        trx
      );
      held.resolve();
      await release.promise;
    });
    void backflushing.catch(() => {});
    await Promise.race([held.promise, backflushing]);

    const completion = invokePosting(
      handlesOf(f.ctx),
      "issue",
      { type: "jobOperation", id: job.operationId, quantity: 1 },
      issueMaterial
    );
    completing = completion;
    void completion.catch(() => {});
    await waitForBlockedConnection(monitor, backflushPid, completionPid);

    release.resolve();
    await backflushing;
    expect((await completion).error).toBeNull();

    const consumed = await f.db
      .selectFrom("itemLedger")
      .select((eb) => eb.fn.sum<string>("quantity").as("quantity"))
      .where("itemId", "=", item)
      .where("documentType", "=", "Job Consumption")
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const material = await f.db
      .selectFrom("jobMaterial")
      .select("quantityIssued")
      .where("id", "=", job.materialId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect({
      consumed: Number(consumed.quantity),
      quantityIssued: Number(material.quantityIssued)
    }).toEqual({ consumed: -2, quantityIssued: 2 });
  } finally {
    release.resolve();
    await backflushing?.catch(() => {});
    await completing?.catch(() => {});
    await backflusher.destroy();
    await monitor.destroy();
    await f.cleanup();
  }
}

databaseTest(
  "an operation completion that waited on the job's backflush issues nothing the backflush issued",
  () => completionBehindBackflush({ strict: false, preventNegative: true })
);

databaseTest(
  "under strict backflush, an operation completion that waited on the job's backflush issues nothing the backflush issued",
  () => completionBehindBackflush({ strict: true, preventNegative: true })
);

databaseTest(
  "under strict backflush that may draw a bin negative, an operation completion that waited on the job's backflush issues nothing the backflush issued",
  () => completionBehindBackflush({ strict: true, preventNegative: false })
);
