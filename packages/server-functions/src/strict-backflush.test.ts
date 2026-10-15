// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Strict backflush against the live database
// (.ai/specs/2026-10-14-strict-backflush.md). With the setting on, a stocked
// material is consumed only from its own storage unit and a missing or short
// bin refuses the backflush; with it off, the old fallbacks still apply.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap,
  workCenterFixture
} from "./always-post-test-fixture";
import issue from "./issue";
import { assertMethodHasPullFrom } from "./lib/strict-backflush";
import { databaseTest } from "./local-database-test-fixture";
import postInventoryAdjustment from "./post-inventory-adjustment";

async function setStrict(f: Fixture, on: boolean) {
  await f.db
    .updateTable("companySettings")
    .set({ requireBackflushStorageUnit: on })
    .where("id", "=", f.companyId)
    .execute();
}

async function storageUnit(f: Fixture, name: string): Promise<string> {
  const row = await f.db
    .insertInto("storageUnit")
    .values({
      name: `${f.prefix} ${name}`,
      locationId: f.locationId,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function stockBin(f: Fixture, storageUnitId: string, quantity: number) {
  unwrap(
    await postInventoryAdjustment(f.ctx, {
      adjustmentType: "Positive Adjmt.",
      itemId: f.partId,
      locationId: f.locationId,
      storageUnitId,
      quantity
    })
  );
}

async function setMaterialBin(
  f: Fixture,
  materialId: string,
  storageUnitId: string | null
) {
  await f.db
    .updateTable("jobMaterial")
    .set({ storageUnitId })
    .where("id", "=", materialId)
    .where("companyId", "=", f.companyId)
    .execute();
}

async function consumption(f: Fixture, jobId: string) {
  return f.db
    .selectFrom("itemLedger")
    .select(["storageUnitId", "quantity"])
    .where("documentId", "=", jobId)
    .where("entryType", "=", "Consumption")
    .where("companyId", "=", f.companyId)
    .execute()
    .then((rows) =>
      rows.map((row) => ({ ...row, quantity: Number(row.quantity) }))
    );
}

databaseTest(
  "strict backflush refuses a short bin and never draws from another one",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfA, 1);
      await stockBin(f, shelfB, 10);
      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);
      await setStrict(f, true);

      const result = await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1
      });
      expect(result.error?.status).toBe(409);
      expect(result.error?.message).toBe(
        `Not enough ${f.prefix}-PART in ${f.prefix} Shelf A: need 2, have 1`
      );
      expect(await consumption(f, job.jobId)).toEqual([]);

      // Topped up, the same completion draws from Shelf A only.
      await stockBin(f, shelfA, 1);
      unwrap(
        await issue(f.ctx, {
          type: "jobOperation",
          id: job.operationId,
          quantity: 1
        })
      );
      expect(await consumption(f, job.jobId)).toEqual([
        { storageUnitId: shelfA, quantity: -2 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "strict backflush refuses a material with no storage unit",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfB, 10);
      const job = await jobFixture(f);
      await setStrict(f, true);

      const result = await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1
      });
      expect(result.error?.message).toBe(
        `${f.prefix}-PART has no Pull From storage unit on this job`
      );
      expect(await consumption(f, job.jobId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with strict backflush off, a short bin still falls back to the fullest one",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfA, 1);
      await stockBin(f, shelfB, 10);
      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);

      unwrap(
        await issue(f.ctx, {
          type: "jobOperation",
          id: job.operationId,
          quantity: 1
        })
      );
      expect(await consumption(f, job.jobId)).toEqual([
        { storageUnitId: shelfB, quantity: -2 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a dry run reports the refusal and writes nothing", async () => {
  const f = await alwaysPostFixture();
  try {
    const shelfA = await storageUnit(f, "Shelf A");
    await stockBin(f, shelfA, 1);
    const job = await jobFixture(f);
    await setMaterialBin(f, job.materialId, shelfA);

    // Off: a no-op, even though the bin is short.
    unwrap(
      await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1,
        dryRun: true
      })
    );

    await setStrict(f, true);
    const short = await issue(f.ctx, {
      type: "jobOperation",
      id: job.operationId,
      quantity: 1,
      dryRun: true
    });
    expect(short.error?.status).toBe(409);

    // Covered: the dry run succeeds and rolls every write back.
    await stockBin(f, shelfA, 1);
    unwrap(
      await issue(f.ctx, {
        type: "jobOperation",
        id: job.operationId,
        quantity: 1,
        dryRun: true
      })
    );
    expect(await consumption(f, job.jobId)).toEqual([]);
    const material = await f.db
      .selectFrom("jobMaterial")
      .select("quantityIssued")
      .where("id", "=", job.materialId)
      .executeTakeFirstOrThrow();
    expect(Number(material.quantityIssued ?? 0)).toBe(0);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "strict manual issue of a planned material uses only its own bin",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfA, 1);
      await stockBin(f, shelfB, 10);
      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);
      await setStrict(f, true);

      const result = await issue(f.ctx, {
        type: "partToOperation",
        id: job.operationId,
        itemId: f.partId,
        materialId: job.materialId,
        quantity: 2,
        adjustmentType: "Negative Adjmt."
      });
      expect(result.error?.message).toBe(
        `Not enough ${f.prefix}-PART in ${f.prefix} Shelf A: need 2, have 1`
      );
      expect(await consumption(f, job.jobId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the SQL job-completion backflush refuses a short bin under strict backflush",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfA, 1);
      await stockBin(f, shelfB, 10);
      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);
      await setStrict(f, true);

      await expect(
        sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
          f.db
        )
      ).rejects.toThrow(
        `Not enough ${f.prefix}-PART in ${f.prefix} Shelf A: need 2, have 1`
      );
      expect(await consumption(f, job.jobId)).toEqual([]);

      await setMaterialBin(f, job.materialId, null);
      await expect(
        sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
          f.db
        )
      ).rejects.toThrow(`${f.prefix}-PART has no Pull From storage unit`);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "activation needs a Pull From at each location with an active work center",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const makeMethodId = `${f.prefix}-make-method`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("makeMethod")
          .values({
            id: makeMethodId,
            itemId: f.assemblyId,
            version: 99,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("methodMaterial")
          .values({
            makeMethodId,
            itemId: f.partId,
            itemType: "Part",
            methodType: "Pull from Inventory",
            quantity: 2,
            unitOfMeasureCode: "EA",
            storageUnitIds: {},
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });

      // No location has a work center yet, so nothing needs a bin.
      await assertMethodHasPullFrom(f.db, {
        makeMethodId,
        companyId: f.companyId
      });

      await workCenterFixture(f);
      await expect(
        assertMethodHasPullFrom(f.db, {
          makeMethodId,
          companyId: f.companyId
        })
      ).rejects.toThrow(
        `Set a Pull From storage unit before you activate this version: ${f.prefix}-PART`
      );

      await f.db
        .updateTable("methodMaterial")
        .set({ storageUnitIds: { [f.locationId]: shelfA } })
        .where("makeMethodId", "=", makeMethodId)
        .execute();
      await assertMethodHasPullFrom(f.db, {
        makeMethodId,
        companyId: f.companyId
      });
    } finally {
      await f.cleanup();
    }
  }
);
