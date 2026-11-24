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
import {
  deadlocked,
  race,
  raceRounds,
  raceTimeout
} from "./fixtures/race";

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

// One unit of a job whose material takes 2 per unit (2 estimated) from a bin
// holding 10. `key` tells apart the jobs of one fixture.
async function materialJob(f: Fixture, key = "") {
  const item = `${f.prefix}-material${key}`;
  const bin = `${f.prefix}-bin${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("item")
      .values({
        id: item,
        readableId: `${f.prefix}-MATERIAL${key}`,
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
        name: `Bin${key}`,
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
  const job = await jobFixture(f, `issue-race${key}`);
  await f.db
    .updateTable("jobMaterial")
    .set({ itemId: item, storageUnitId: bin })
    .where("id", "=", job.materialId)
    .where("companyId", "=", f.companyId)
    .execute();
  return { item, job };
}

async function consumedAndIssued(f: Fixture, item: string, materialId: string) {
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
    .where("id", "=", materialId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return {
    consumed: Number(consumed.quantity),
    quantityIssued: Number(material.quantityIssued)
  };
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
    const { item, job } = await materialJob(f);

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

    expect(await consumedAndIssued(f, item, job.materialId)).toEqual({
      consumed: -2,
      quantityIssued: 2
    });
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

// The MES step backflush (backflushUntrackedMaterialsOnStepRecord) reads
// quantityIssued with no lock, plans the unit's shortfall from it
// (planStepBackflush) and posts it as a step issue. A completion that
// committed in between has already issued the unit's material.
databaseTest(
  "a step issue planned before an operation completion committed issues nothing the completion issued",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { item, job } = await materialJob(f);
      const read = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const target = 2;
      const shortfall = target - Number(read.quantityIssued ?? 0);

      const completion = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        { type: "jobOperation", id: job.operationId, quantity: 1 },
        issueMaterial
      );
      expect(completion.error).toBeNull();

      const step = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "partToOperation",
          id: job.operationId,
          itemId: item,
          materialId: job.materialId,
          quantity: shortfall,
          adjustmentType: "Negative Adjmt.",
          maxQuantityIssued: target
        },
        issueMaterial
      );
      expect(step.error).toBeNull();

      expect(await consumedAndIssued(f, item, job.materialId)).toEqual({
        consumed: -2,
        quantityIssued: 2
      });
    } finally {
      await f.cleanup();
    }
  }
);

const ISSUE_ROUNDS = raceRounds(6);

// The completion's issue, the job's backflush and the MES step backflush of
// one unit at once, under each backflush setting in turn: the unit needs 2,
// and the step backflush planned its 2 from a read before any of them.
databaseTest(
  "an operation completion, the job's backflush and a step backflush of one unit at once issue at most the unit's need",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await workCenterFixture(f);
      const settings: Settings[] = [
        { strict: false, preventNegative: true },
        { strict: true, preventNegative: true },
        { strict: true, preventNegative: false }
      ];
      await race({
        rounds: ISSUE_ROUNDS,
        setup: async (round) => {
          const { strict, preventNegative } =
            settings[(round - 1) % settings.length]!;
          await f.db
            .updateTable("companySettings")
            .set({
              requireBackflushStorageUnit: strict,
              preventNegativeBackflush: preventNegative
            })
            .where("id", "=", f.companyId)
            .execute();
          return materialJob(f, `-${round}`);
        },
        operations: {
          completion: (db, { job }) =>
            invokePosting(
              handlesOf({ ...f.ctx, db }),
              "issue",
              { type: "jobOperation", id: job.operationId, quantity: 1 },
              issueMaterial
            ),
          backflush: (db, { job }) =>
            sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
              db
            ),
          stepBackflush: (db, { item, job }) =>
            invokePosting(
              handlesOf({ ...f.ctx, db }),
              "issue",
              {
                type: "partToOperation",
                id: job.operationId,
                itemId: item,
                materialId: job.materialId,
                quantity: 2,
                adjustmentType: "Negative Adjmt.",
                maxQuantityIssued: 2
              },
              issueMaterial
            )
        },
        invariant: async ({ item, job }, outcomes) => {
          const { consumed, quantityIssued } = await consumedAndIssued(
            f,
            item,
            job.materialId
          );
          expect({
            deadlocked: deadlocked(outcomes),
            leftTheBinWithinNeed: -consumed <= 2,
            quantityIssued
          }).toEqual({
            deadlocked: [],
            leftTheBinWithinNeed: true,
            quantityIssued: -consumed
          });
        }
      });
    } finally {
      await f.cleanup();
    }
  },
  raceTimeout(ISSUE_ROUNDS, 1_000)
);
