// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A completion that names no location (the MCP completeJob tool leaves it
// optional) receives into the job's own location and storage unit. Before,
// the Job Receipt posted with no location, so no location counted the units.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { createHash, randomUUID } from "node:crypto";
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
import { localApiKeyClient, postgrestTest } from "./fixtures/local-supabase";

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
  "a completion with no location refuses a storage unit at another location",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobFixture(f, "foreign-unit");
      const foreignShelf = `${f.prefix}-shelf-foreign`;
      await seed(f, (trx) =>
        trx
          .insertInto("storageUnit")
          .values({
            id: foreignShelf,
            name: foreignShelf,
            locationId: f.otherLocationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      await expect(
        sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${foreignShelf}, ${null}, ${f.companyId}, ${USER})`.execute(
          f.db
        )
      ).rejects.toThrow(/is not at the location of job/);
      expect(await jobReceipts(f, job.jobId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a completion with no location skips the job's own storage unit when it is at another location",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // The job's default storage unit is stale: it belongs to another location.
      // Refusing would block every completion that names no location, so the
      // receipt lands at the job's location with no storage unit instead.
      const job = await jobFixture(f, "stale-unit");
      const staleShelf = `${f.prefix}-shelf-stale`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("storageUnit")
          .values({
            id: staleShelf,
            name: staleShelf,
            locationId: f.otherLocationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("job")
          .set({ storageUnitId: staleShelf })
          .where("id", "=", job.jobId)
          .execute();
      });
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${null}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(await jobReceipts(f, job.jobId)).toEqual([
        { locationId: f.locationId, storageUnitId: null, quantity: 1 }
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

postgrestTest(
  "the ERP receipt accepts an omitted destination and returns the committed job status",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobWithShelf(f, "default-destination");
      const key = `crbn_test_${randomUUID()}`;
      await f.db
        .insertInto("apiKey")
        .values({
          name: "Job receiver",
          companyId: f.companyId,
          createdBy: USER,
          keyHash: createHash("sha256").update(key).digest("hex"),
          scopes: JSON.stringify({ production_update: [f.companyId] })
        })
        .execute();
      const client = localApiKeyClient(key)!;
      const receipt = await client.rpc("receive_job_to_inventory", {
        p_job_id: job.jobId,
        p_quantity_complete: 1,
        p_company_id: f.companyId,
        p_user_id: USER
      });
      expect(receipt.error).toBeNull();
      expect(receipt.data).toBe(true);
      expect(await jobReceipts(f, job.jobId)).toEqual([
        { locationId: f.locationId, storageUnitId: job.shelf, quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
