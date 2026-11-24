// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { createPairedJob } from "./fixtures/paired-job";
import { receiveProductionPair } from "./fixtures/packout-production";

async function serialUnit(f: Fixture, itemId: string, readableId: string) {
  return f.db
    .insertInto("trackedEntity")
    .values({
      itemId,
      readableId,
      quantity: 1,
      sourceDocument: "Item",
      sourceDocumentId: itemId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

databaseTest(
  "enabling serial inheritance preserves existing jobs and existing pairs",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const required = async () => {
        const { rows } = await sql<{ required: boolean }>`
          SELECT job_requires_serial_pairing(${job.jobId}, ${f.companyId}) AS required
        `.execute(f.db);
        return rows[0]!.required;
      };
      const enable = (value: boolean) => f.db
        .updateTable("companySettings")
        .set({ serialNumberFromComponent: value })
        .where("id", "=", f.companyId)
        .executeTakeFirstOrThrow();

      // The fixture enables the feature before the job is created. Re-saving
      // the setting must not move the activation boundary beyond the job.
      expect(await required()).toBe(true);
      await enable(true);
      expect(await required()).toBe(true);
      await enable(false);
      expect(await required()).toBe(false);
      await enable(true);
      expect(await required()).toBe(false);

      await f.db.insertInto("jobUnitPairing").values({
        companyId: f.companyId,
        jobId: job.jobId,
        jobMaterialId: job.materialId,
        sourceId: production.first.id!,
        outputId: job.unitId,
        serial: production.first.serial,
        createdBy: USER
      }).execute();
      await enable(false);
      expect(await required()).toBe(true);
      await enable(true);
      expect(await required()).toBe(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job pairing rejects an entity or material from another company",
  async () => {
    const f = await alwaysPostFixture();
    const other = await alwaysPostFixture();
    try {
      const job = await jobFixture(f);
      const foreignJob = await jobFixture(other);
      const source = await serialUnit(f, f.partId, "PAIRED-1");
      const target = await serialUnit(f, f.assemblyId, "PAIRED-1");
      const foreign = await serialUnit(other, other.partId, "PAIRED-1");
      await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
        f.db
      );
      const pair = {
        companyId: f.companyId,
        jobId: job.jobId,
        jobMaterialId: job.materialId,
        sourceId: source.id!,
        outputId: target.id!,
        serial: "PAIRED-1",
        createdBy: USER
      };
      for (const wrong of [
        { sourceId: foreign.id! },
        { outputId: foreign.id! },
        { jobMaterialId: foreignJob.materialId },
        { jobId: foreignJob.jobId }
      ]) {
        await expect(
          f.db
            .insertInto("jobUnitPairing")
            .values({ ...pair, ...wrong })
            .execute()
        ).rejects.toThrow("must belong to this job and company");
      }
      expect(
        await f.db
          .selectFrom("jobUnitPairing")
          .select("id")
          .where("companyId", "=", f.companyId)
          .execute()
      ).toEqual([]);
    } finally {
      try {
        await f.cleanup();
      } finally {
        await other.cleanup();
      }
    }
  }
);

databaseTest(
  "active packing protects both ends and only the paired sales serial on its SKU",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const job = await jobFixture(f);
      await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
        f.db
      );
      const serial = "PACKED-1";
      const source = await serialUnit(f, f.partId, serial);
      const output = await serialUnit(f, f.assemblyId, serial);
      const other = await serialUnit(f, f.assemblyId, "OTHER");
      const pair = await f.db
        .insertInto("jobUnitPairing")
        .values({
          companyId: f.companyId,
          jobId: job.jobId,
          jobMaterialId: job.materialId,
          sourceId: source.id!,
          outputId: output.id!,
          serial,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const rename = (id: string, value: string) =>
        f.db
          .updateTable("trackedEntity")
          .set({ readableId: value })
          .where("id", "=", id)
          .where("companyId", "=", f.companyId)
          .returning("readableId")
          .executeTakeFirstOrThrow();

      for (const id of [source.id!, output.id!]) {
        await expect(rename(id, "EDIT")).rejects.toThrow(
          "paired to a packing job"
        );
        expect(await rename(id, serial)).toEqual({ readableId: serial });
      }
      await expect(rename(other.id!, serial)).rejects.toThrow(
        "already has a packed unit"
      );
      await expect(serialUnit(f, f.assemblyId, serial)).rejects.toThrow(
        "already has a packed unit"
      );
      expect(await rename(other.id!, "OTHER-EDIT")).toEqual({
        readableId: "OTHER-EDIT"
      });

      await f.db
        .updateTable("jobUnitPairing")
        .set({ releasedAt: sql`now()`, updatedBy: USER, updatedAt: sql`now()` })
        .where("companyId", "=", f.companyId)
        .where("id", "=", pair.id!)
        .where("releasedAt", "is", null)
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(await rename(source.id!, "RESTORED")).toEqual({
        readableId: "RESTORED"
      });
      expect(await rename(other.id!, serial)).toEqual({ readableId: serial });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "ordinary jobs keep their own tracking and numbering rules",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      // Seed alternative pre-release configurations against the same job snapshot.
      await seed(f, async (trx) => {
        const requiresPair = async () =>
          (
            await sql<{ required: boolean }>`
        SELECT job_requires_serial_pairing(${job.jobId}, ${f.companyId}) AS required
      `.execute(trx)
          ).rows[0]!.required;
        expect(await requiresPair()).toBe(true);
        const examples = [
          sql`UPDATE "companySettings" SET "serialNumberFromComponent" = false WHERE id = ${f.companyId}`,
          sql`UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = ${job.salesItemId} AND "companyId" = ${f.companyId}`,
          sql`UPDATE item SET "itemTrackingType" = 'Inventory' WHERE id = ${production.productionItemId} AND "companyId" = ${f.companyId}`,
          sql`UPDATE "jobMaterial" SET quantity = 2 WHERE id = ${job.materialId} AND "companyId" = ${f.companyId}`,
          sql`UPDATE "jobMaterial" SET quantity = 0 WHERE id = ${job.materialId} AND "companyId" = ${f.companyId}`,
          sql`INSERT INTO "itemSerialSequence" ("itemId", prefix, suffix, next, size, step, "companyId", "createdBy")
            VALUES (${job.salesItemId}, 'SALE-', '', 1, 3, 1, ${f.companyId}, ${USER})`
        ];
        for (const change of examples) {
          await sql`SAVEPOINT ordinary_job`.execute(trx);
          await change.execute(trx);
          expect(await requiresPair()).toBe(false);
          await sql`ROLLBACK TO SAVEPOINT ordinary_job`.execute(trx);
        }
      });
    } finally {
      await f.cleanup();
    }
  }
);
