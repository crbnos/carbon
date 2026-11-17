// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A completion that names no location (the MCP completeJob tool leaves it
// optional) receives into the job's own location and storage unit. Before,
// the Job Receipt posted with no location, so no location counted the units.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { sql } from "kysely";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

/** A job whose own storage unit is a shelf at the job's location. */
async function jobWithShelf(f: Fixture, key: string) {
  const job = await jobFixture(f, key);
  const shelf = `${f.prefix}-shelf-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("storageUnit")
      .values({
        id: shelf,
        name: shelf,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("job")
      .set({ storageUnitId: shelf })
      .where("id", "=", job.jobId)
      .execute();
  });
  return { ...job, shelf };
}

async function jobReceipts(f: Fixture, jobId: string) {
  const rows = await f.db
    .selectFrom("itemLedger")
    .select(["locationId", "storageUnitId", "quantity"])
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Job Receipt")
    .where("documentId", "=", jobId)
    .execute();
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
}

databaseTest(
  "a completion with no location receives into the job's location and storage unit",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobWithShelf(f, "no-location");
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${null}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(await jobReceipts(f, job.jobId)).toEqual([
        { locationId: f.locationId, storageUnitId: job.shelf, quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a completion to another location keeps it and does not take the job's storage unit",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobWithShelf(f, "other-location");
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${f.otherLocationId}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(await jobReceipts(f, job.jobId)).toEqual([
        { locationId: f.otherLocationId, storageUnitId: null, quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
