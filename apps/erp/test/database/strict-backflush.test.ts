// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  dryRunJobOperationIssues,
  issueMaterial,
  postInventoryAdjustment as postInventoryAdjustmentBody
} from "../../app/modules/inventory/inventory.service";
import { getMethod as getMethodBody } from "../../app/modules/production/production.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { assertMethodHasPullFrom } from "../../app/modules/shared/strict-backflush";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap,
  workCenterFixture
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";

type Ctx = Fixture["ctx"];

const issue = (ctx: Ctx, input: Parameters<typeof issueMaterial>[1]) =>
  invokePosting(handlesOf(ctx), "issue", input, issueMaterial);

const getMethod = (ctx: Ctx, input: Parameters<typeof getMethodBody>[1]) =>
  invokePosting(handlesOf(ctx), "get-method", input, getMethodBody);

const postInventoryAdjustment = (
  ctx: Ctx,
  input: Parameters<typeof postInventoryAdjustmentBody>[1]
) =>
  invokePosting(
    handlesOf(ctx),
    "post-inventory-adjustment",
    input,
    postInventoryAdjustmentBody
  );

// Strict backflush needs an active work center at the location; tests create
// their own storage units.
async function setStrict(
  f: Fixture,
  on: boolean,
  { withWorkCenter = true }: { withWorkCenter?: boolean } = {}
) {
  await f.db
    .updateTable("companySettings")
    .set({ requireBackflushStorageUnit: on })
    .where("id", "=", f.companyId)
    .execute();
  if (on && withWorkCenter) await workCenterFixture(f);
}

async function pick(
  f: Fixture,
  job: { jobId: string; materialId: string },
  from: string,
  to: string,
  quantity: number,
  listKey = "PL"
) {
  await seed(f, async (trx) => {
    const list = await trx
      .insertInto("pickingList")
      .values({
        pickingListId: `${job.jobId}-${listKey}`,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("pickingListLine")
      .values({
        pickingListId: list.id,
        jobId: job.jobId,
        jobMaterialId: job.materialId,
        itemId: f.partId,
        quantityToPick: 2,
        quantityPicked: quantity,
        storageUnitId: from,
        toStorageUnitId: to,
        status: "Picked",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("itemLedger")
      .values([
        {
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: list.id,
          itemId: f.partId,
          quantity: -quantity,
          locationId: f.locationId,
          storageUnitId: from,
          companyId: f.companyId,
          createdBy: USER
        },
        {
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: list.id,
          itemId: f.partId,
          quantity,
          locationId: f.locationId,
          storageUnitId: to,
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .updateTable("jobMaterial")
      .set({ storageUnitId: to })
      .where("id", "=", job.materialId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
}

const byBin = (rows: { storageUnitId: string | null; quantity: number }[]) =>
  [...rows].sort((a, b) =>
    (a.storageUnitId ?? "").localeCompare(b.storageUnitId ?? "")
  );

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
        `${f.prefix}-PART has no Pull From storage unit on job J-1`
      );
      expect(await consumption(f, job.jobId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with negative stock allowed, strict backflush draws its own bin below zero",
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
      await f.db
        .updateTable("companySettings")
        .set({ preventNegativeBackflush: false })
        .where("id", "=", f.companyId)
        .execute();

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

      const second = await jobFixture(f, "2");
      const missing = await issue(f.ctx, {
        type: "jobOperation",
        id: second.operationId,
        quantity: 1
      });
      expect(missing.error?.message).toBe(
        `${f.prefix}-PART has no Pull From storage unit on job J-2`
      );

      const third = await jobFixture(f, "3");
      await setMaterialBin(f, third.materialId, shelfA);
      await sql`SELECT backflush_job_materials(${third.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(await consumption(f, third.jobId)).toEqual([
        { storageUnitId: shelfA, quantity: -2 }
      ]);
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

databaseTest(
  "a batch dry run holds operations that share a bin to their combined demand",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      await stockBin(f, shelfA, 3);
      const first = await jobFixture(f, "1");
      const second = await jobFixture(f, "2");
      await setMaterialBin(f, first.materialId, shelfA);
      await setMaterialBin(f, second.materialId, shelfA);
      await setStrict(f, true);

      const check = (operationIds: string[]) =>
        dryRunJobOperationIssues(f.db, {
          companyId: f.companyId,
          userId: USER,
          operations: operationIds.map((id) => ({ id, quantity: 1 }))
        });

      // Each needs 2 of the 3 on the shelf: alone each fits, together not.
      await check([first.operationId]);
      await check([second.operationId]);
      await expect(
        check([first.operationId, second.operationId])
      ).rejects.toMatchObject({
        status: 409,
        message: `Not enough ${f.prefix}-PART in ${f.prefix} Shelf A: need 2, have 1`
      });
      expect(await consumption(f, first.jobId)).toEqual([]);
      expect(await consumption(f, second.jobId)).toEqual([]);
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

    unwrap(
      await issue(f.ctx, {
        type: "jobOperationDryRun",
        id: job.operationId,
        quantity: 1
      })
    );

    await setStrict(f, true);
    const short = await issue(f.ctx, {
      type: "jobOperationDryRun",
      id: job.operationId,
      quantity: 1
    });
    expect(short.error?.status).toBe(409);

    await stockBin(f, shelfA, 1);
    unwrap(
      await issue(f.ctx, {
        type: "jobOperationDryRun",
        id: job.operationId,
        quantity: 1
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

databaseTest(
  "after a partial pick, the rest comes from the Pull From, not from lineside",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const lineside = await storageUnit(f, "Lineside");
      await stockBin(f, shelfA, 4);
      await setStrict(f, true);

      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);
      await pick(f, job, shelfA, lineside, 1);
      unwrap(
        await issue(f.ctx, {
          type: "jobOperation",
          id: job.operationId,
          quantity: 1
        })
      );
      expect(byBin(await consumption(f, job.jobId))).toEqual(
        byBin([
          { storageUnitId: lineside, quantity: -1 },
          { storageUnitId: shelfA, quantity: -1 }
        ])
      );

      const second = await jobFixture(f, "2");
      await setMaterialBin(f, second.materialId, shelfA);
      await pick(f, second, shelfA, lineside, 1);
      await sql`SELECT backflush_job_materials(${second.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(byBin(await consumption(f, second.jobId))).toEqual(
        byBin([
          { storageUnitId: lineside, quantity: -1 },
          { storageUnitId: shelfA, quantity: -1 }
        ])
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the SQL job-completion backflush draws every lineside bin the material was picked to",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const linesideOne = await storageUnit(f, "Lineside 1");
      const linesideTwo = await storageUnit(f, "Lineside 2");
      await stockBin(f, shelfA, 2);
      await setStrict(f, true);

      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);
      await pick(f, job, shelfA, linesideOne, 1, "PL-1");
      await pick(f, job, shelfA, linesideTwo, 1, "PL-2");
      await sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(byBin(await consumption(f, job.jobId))).toEqual(
        byBin([
          { storageUnitId: linesideOne, quantity: -1 },
          { storageUnitId: linesideTwo, quantity: -1 }
        ])
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "strict backflush skips a location with no active work center",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfB, 10);
      await setStrict(f, true, { withWorkCenter: false });

      const job = await jobFixture(f);
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

      const second = await jobFixture(f, "2");
      await sql`SELECT backflush_job_materials(${second.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      expect(await consumption(f, second.jobId)).toEqual([
        { storageUnitId: shelfB, quantity: -2 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the SQL refusal counts every short material against a shared bin",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Two lines of 2 on a bin holding 1: the second sees the first's need
      // ("have 0"), in either loop order.
      const shelfA = await storageUnit(f, "Shelf A");
      await stockBin(f, shelfA, 1);
      await setStrict(f, true);
      const job = await jobFixture(f);
      await setMaterialBin(f, job.materialId, shelfA);
      const makeMethod = await f.db
        .selectFrom("jobMakeMethod")
        .select("id")
        .where("jobId", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("jobMaterial")
        .values({
          jobId: job.jobId,
          jobMakeMethodId: makeMethod.id,
          jobOperationId: job.operationId,
          itemId: f.partId,
          itemType: "Part",
          methodType: "Pull from Inventory",
          description: "Bracket",
          quantity: 2,
          estimatedQuantity: 2,
          unitOfMeasureCode: "EA",
          storageUnitId: shelfA,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();

      const refusal =
        await sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`
          .execute(f.db)
          .then(
            () => null,
            (error: Error) => error.message
          );
      expect(refusal).toContain(
        `Not enough ${f.prefix}-PART in ${f.prefix} Shelf A: need 2, have 1`
      );
      expect(refusal).toContain(
        `Not enough ${f.prefix}-PART in ${f.prefix} Shelf A: need 2, have 0`
      );
      expect(await consumption(f, job.jobId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

async function jobLineBinFromBom(
  f: Fixture,
  key: string,
  storageUnitIds: Record<string, string>
): Promise<string | null> {
  const makeMethodId = `${f.prefix}-make-method-${key}`;
  const jobId = `${f.prefix}-bom-job-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("makeMethod")
      .values({
        id: makeMethodId,
        itemId: f.assemblyId,
        version: 100 + Number(key),
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
        storageUnitIds,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("job")
      .values({
        id: jobId,
        jobId: `J-BOM-${key}`,
        itemId: f.assemblyId,
        quantity: 1,
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(
    await getMethod(f.ctx, {
      type: "itemToJob",
      sourceId: f.assemblyId,
      targetId: jobId,
      versionId: makeMethodId
    })
  );
  const line = await f.db
    .selectFrom("jobMaterial")
    .select("storageUnitId")
    .where("jobId", "=", jobId)
    .where("itemId", "=", f.partId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return line.storageUnitId;
}

databaseTest(
  "under strict backflush, job creation never gives a line the fullest bin",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const shelfA = await storageUnit(f, "Shelf A");
      const shelfB = await storageUnit(f, "Shelf B");
      await stockBin(f, shelfB, 10);

      expect(await jobLineBinFromBom(f, "1", {})).toBe(shelfB);

      await setStrict(f, true);
      expect(await jobLineBinFromBom(f, "2", {})).toBeNull();

      await f.db
        .insertInto("pickMethod")
        .values({
          itemId: f.partId,
          locationId: f.locationId,
          defaultStorageUnitId: shelfA,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      expect(await jobLineBinFromBom(f, "3", {})).toBe(shelfA);

      expect(await jobLineBinFromBom(f, "4", { [f.locationId]: shelfB })).toBe(
        shelfB
      );
    } finally {
      await f.cleanup();
    }
  }
);
