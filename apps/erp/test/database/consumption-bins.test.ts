// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Untracked job consumption takes its stock from the bins that hold it
// (planStripedUntrackedDraw), and an operation completion issues only what the units
// made so far still need, so a unit's material is never issued twice.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("consumption bins", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-a`;
    binB = `${f.prefix}-b`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values([
          {
            id: binA,
            name: "A",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: binB,
            name: "B",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute()
    );
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const newItem = (suffix: string) =>
    seed(f, (trx) =>
      trx
        .insertInto("item")
        .values({
          id: `${f.prefix}-${suffix}`,
          readableId: `${f.prefix}-${suffix.toUpperCase()}`,
          name: suffix,
          type: "Part",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    ).then(() => `${f.prefix}-${suffix}`);

  const receive = (
    itemId: string,
    storageUnitId: string | null,
    quantity: number,
    projectId: string | null = null
  ) =>
    seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values({
          entryType: "Positive Adjmt.",
          documentType: "Inventory Receipt",
          itemId,
          locationId: f.locationId,
          storageUnitId,
          quantity,
          projectId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

  const consumed = (itemId: string) =>
    f.db
      .selectFrom("itemLedger")
      .select(["storageUnitId", "quantity"])
      .where("itemId", "=", itemId)
      .where("documentType", "=", "Job Consumption")
      .where("companyId", "=", f.companyId)
      // Two rows can share a quantity: the storage unit breaks the tie.
      .orderBy("quantity")
      .orderBy("storageUnitId")
      .execute();

  const manualIssue = (
    job: { operationId: string; materialId: string },
    itemId: string,
    quantity: number
  ) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      {
        type: "partToOperation",
        id: job.operationId,
        itemId,
        materialId: job.materialId,
        quantity,
        adjustmentType: "Negative Adjmt."
      },
      issue
    ).then(unwrap);

  const complete = (operationId: string, quantity: number) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      { type: "jobOperation", id: operationId, quantity },
      issue
    ).then(unwrap);

  // What sync_update_job_operation_quantities does when the production
  // quantity is saved (the test connection runs with triggers off).
  const recordProduction = (operationId: string, quantity: number) =>
    f.db
      .updateTable("jobOperation")
      .set((eb) => ({
        quantityComplete: eb("quantityComplete", "+", quantity)
      }))
      .where("id", "=", operationId)
      .where("companyId", "=", f.companyId)
      .execute();

  const setMaterial = (
    materialId: string,
    values: {
      itemId: string;
      storageUnitId: string | null;
      estimatedQuantity?: number;
    }
  ) =>
    f.db
      .updateTable("jobMaterial")
      .set({ defaultStorageUnit: false, ...values })
      .where("id", "=", materialId)
      .where("companyId", "=", f.companyId)
      .execute();

  databaseTest(
    "a manual issue from an empty named bin takes the stock with no storage unit",
    async () => {
      const item = await newItem("empty-named");
      await receive(item, null, 61);
      const job = await jobFixture(f, "empty-named");
      await setMaterial(job.materialId, { itemId: item, storageUnitId: binA });

      await manualIssue(job, item, 1);

      expect(await consumed(item)).toEqual([
        { storageUnitId: null, quantity: -1 }
      ]);
    }
  );

  databaseTest(
    "a manual issue with no bin named takes a bin that holds stock",
    async () => {
      const item = await newItem("no-bin");
      await receive(item, binB, 49);
      const job = await jobFixture(f, "no-bin");
      await setMaterial(job.materialId, { itemId: item, storageUnitId: null });

      await manualIssue(job, item, 2);

      expect(await consumed(item)).toEqual([
        { storageUnitId: binB, quantity: -2 }
      ]);
    }
  );

  databaseTest(
    "a completion splits a short named bin across the bins that hold stock",
    async () => {
      const item = await newItem("split");
      await receive(item, binA, 1);
      await receive(item, binB, 10);
      const job = await jobFixture(f, "split");
      await setMaterial(job.materialId, { itemId: item, storageUnitId: binA });
      await recordProduction(job.operationId, 1);

      await complete(job.operationId, 1);

      expect(await consumed(item)).toEqual([
        { storageUnitId: binA, quantity: -1 },
        { storageUnitId: binB, quantity: -1 }
      ]);
    }
  );

  databaseTest(
    "a project job draws its project's stock in every bin before common stock",
    async () => {
      const item = await newItem("project-first");
      const projectId = `${f.prefix}-project`;
      await seed(f, (trx) =>
        trx
          .insertInto("project")
          .values({
            id: projectId,
            name: "Stocked project",
            identifier: "SP",
            status: "Released",
            costTreatment: "Expense",
            projectStock: true,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      // 10 common in the named bin A, 2 of the project's own in bin B.
      await receive(item, binA, 10);
      await receive(item, binB, 2, projectId);
      const job = await jobFixture(f, "project-first");
      await seed(f, (trx) =>
        trx
          .updateTable("job")
          .set({ projectId })
          .where("id", "=", job.jobId)
          .execute()
      );
      await setMaterial(job.materialId, { itemId: item, storageUnitId: binA });

      await manualIssue(job, item, 4);

      const rows = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "projectId", "quantity"])
        .where("itemId", "=", item)
        .where("documentType", "=", "Job Consumption")
        .where("companyId", "=", f.companyId)
        .orderBy("projectId")
        .execute();
      expect(
        rows.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([
        { storageUnitId: binB, projectId, quantity: -2 },
        { storageUnitId: binA, projectId: null, quantity: -2 }
      ]);
    }
  );

  databaseTest(
    "a completion after a unit's manual issue issues nothing more for that unit",
    async () => {
      const item = await newItem("double");
      await receive(item, binA, 20);
      const job = await jobFixture(f, "double");
      await setMaterial(job.materialId, {
        itemId: item,
        storageUnitId: binA,
        estimatedQuantity: 4
      });

      // Unit 1: the Assembly view's step backflush issues its 2, then the
      // view completes the unit.
      await recordProduction(job.operationId, 1);
      await manualIssue(job, item, 2);
      await complete(job.operationId, 1);
      expect(await consumed(item)).toEqual([
        { storageUnitId: binA, quantity: -2 }
      ]);

      // Unit 2 completes with nothing issued for it yet, and a resent copy of
      // that completion issues nothing.
      await recordProduction(job.operationId, 1);
      await complete(job.operationId, 1);
      await complete(job.operationId, 1);
      const rows = await consumed(item);
      expect(rows.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(-4);

      const material = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", job.materialId)
        .executeTakeFirstOrThrow();
      expect(Number(material.quantityIssued)).toBe(4);
    }
  );
});
