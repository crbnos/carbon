// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// When no bin was chosen, an issue, a backflush, a maintenance issue and a new
// job material fall back to the item's pick method default, then its fullest
// bin. Neither may be a non-nettable (quarantine) unit, or quarantined stock is
// consumed silently.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { getNonNettableTrackedEntityIds } from "@carbon/database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import {
  issueMaterial as issue,
  postPicking
} from "../../app/modules/inventory/inventory.service";
import { upsertMethodMaterial } from "../../app/modules/items/items.service";
import {
  getStorageUnitId,
  getStorageUnitWithHighestQuantity,
  invokePosting,
  updatePickMethodDefaultStorageUnitIfNeeded
} from "../../app/modules/shared/shared.service";
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
import { postgrestTest } from "./fixtures/local-supabase";

describe.skipIf(!hasLocalDatabase)("fullest bin guess", () => {
  let f: Fixture;
  let warehouse: string;
  let quarantine: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    warehouse = `${f.prefix}-warehouse`;
    quarantine = `${f.prefix}-quarantine`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values([
          {
            id: warehouse,
            name: "Warehouse",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: quarantine,
            name: "Quarantine",
            locationId: f.locationId,
            nettable: false,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const receive = (itemId: string, storageUnitId: string, quantity: number) =>
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
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

  const guess = (itemId: string) =>
    f.db
      .transaction()
      .execute((trx) =>
        getStorageUnitWithHighestQuantity(trx, itemId, f.locationId, f.companyId)
      );

  databaseTest("passes over a fuller non-nettable unit", async () => {
    await receive(f.partId, warehouse, 5);
    await receive(f.partId, quarantine, 30);

    expect(await guess(f.partId)).toBe(warehouse);
  });

  databaseTest(
    "guesses nothing when only a non-nettable unit has stock",
    async () => {
      await receive(f.assemblyId, quarantine, 12);

      expect(await guess(f.assemblyId)).toBeNull();
    }
  );

  const newItem = (suffix: string, tracking = "Inventory") =>
    seed(f, (trx) =>
      trx
        .insertInto("item")
        .values({
          id: `${f.prefix}-${suffix}`,
          readableId: `${f.prefix}-${suffix.toUpperCase()}`,
          name: suffix,
          type: "Part",
          itemTrackingType: tracking as "Inventory",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    ).then(() => `${f.prefix}-${suffix}`);

  const setDefaultBin = (itemId: string, storageUnitId: string) =>
    seed(f, (trx) =>
      trx
        .insertInto("pickMethod")
        .values({
          itemId,
          locationId: f.locationId,
          defaultStorageUnitId: storageUnitId,
          companyId: f.companyId,
          createdBy: USER
        })
        .onConflict((oc) =>
          oc
            .columns(["itemId", "locationId"])
            .doUpdateSet({ defaultStorageUnitId: storageUnitId })
        )
        .execute()
    );

  databaseTest(
    "job completion's SQL backflush passes over a non-nettable default and fullest bin",
    async () => {
      const item = await newItem("completed");
      await setDefaultBin(item, quarantine);
      await receive(item, warehouse, 5);
      await receive(item, quarantine, 30);
      const job = await jobFixture(f, "sql-backflush");
      await f.db
        .updateTable("jobMaterial")
        .set({ itemId: item, storageUnitId: null, defaultStorageUnit: true })
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();

      await sql`SELECT backflush_job_materials(${job.jobId}, 1, ${f.companyId}, ${USER})`.execute(
        f.db
      );

      const consumed = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "quantity"])
        .where("itemId", "=", item)
        .where("documentType", "=", "Job Consumption")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(consumed).toEqual([{ storageUnitId: warehouse, quantity: -2 }]);
    }
  );

  databaseTest(
    "a manual issue passes over a non-nettable default to the fullest nettable bin",
    async () => {
      const item = await newItem("issued");
      await setDefaultBin(item, quarantine);
      await receive(item, warehouse, 5);
      await receive(item, quarantine, 30);
      const job = await jobFixture(f, "manual-issue");
      await f.db
        .updateTable("jobMaterial")
        .set({ itemId: item, storageUnitId: null, defaultStorageUnit: true })
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "partToOperation",
            id: job.operationId,
            itemId: item,
            materialId: job.materialId,
            quantity: 2,
            adjustmentType: "Negative Adjmt."
          },
          issue
        )
      );

      const consumed = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "quantity"])
        .where("itemId", "=", item)
        .where("documentType", "=", "Job Consumption")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(consumed).toEqual([{ storageUnitId: warehouse, quantity: -2 }]);
    }
  );

  databaseTest(
    "a pick is refused when its source became non-nettable after the list was made",
    async () => {
      const item = await newItem("picked");
      const shelf = `${f.prefix}-pick-shelf`;
      const lineside = `${f.prefix}-pick-lineside`;
      const pickingListId = `${f.prefix}-pick-list`;
      const job = await jobFixture(f, "pick");
      await seed(f, async (trx) => {
        await trx
          .insertInto("storageUnit")
          .values(
            [shelf, lineside].map((id) => ({
              id,
              name: id,
              locationId: f.locationId,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
        await trx
          .insertInto("pickingList")
          .values({
            id: pickingListId,
            pickingListId: `${f.prefix}-PL`,
            status: "In Progress",
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("pickingListLine")
          .values(
            ["held", "free"].map((key) => ({
              id: `${pickingListId}-${key}`,
              pickingListId,
              jobId: job.jobId,
              jobMaterialId: job.materialId,
              jobOperationId: job.operationId,
              itemId: item,
              quantityToPick: 2,
              storageUnitId: key === "held" ? shelf : warehouse,
              toStorageUnitId: lineside,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      await receive(item, shelf, 5);
      await receive(item, warehouse, 5);
      // Quarantined after the list was generated.
      await f.db
        .updateTable("storageUnit")
        .set({ nettable: false })
        .where("id", "=", shelf)
        .where("companyId", "=", f.companyId)
        .execute();

      const pick = (key: string) =>
        invokePosting(
          handlesOf(f.ctx),
          "post-picking",
          {
            type: "inventory",
            pickingListId,
            pickingListLineId: `${pickingListId}-${key}`,
            quantity: 2,
            locationId: f.locationId
          },
          postPicking
        );

      const refused = await pick("held");
      expect(refused.error?.message).toContain(
        `${shelf} is non-nettable. A picking list never takes stock from a non-nettable storage unit`
      );
      expect((await pick("free")).error).toBeNull();
      const moved = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "quantity"])
        .where("itemId", "=", item)
        .where("documentId", "=", pickingListId)
        .where("companyId", "=", f.companyId)
        .orderBy("quantity")
        .execute();
      expect(moved).toEqual([
        { storageUnitId: warehouse, quantity: -2 },
        { storageUnitId: lineside, quantity: 2 }
      ]);
    }
  );

  databaseTest(
    "stock placed only in a non-nettable unit never becomes the default bin",
    async () => {
      const item = await newItem("first-stock");
      await receive(item, quarantine, 4);

      await f.db
        .transaction()
        .execute((trx) =>
          updatePickMethodDefaultStorageUnitIfNeeded(
            trx,
            item,
            f.locationId,
            quarantine,
            f.companyId,
            USER
          )
        );
      const quarantinedDefault = await f.db
        .selectFrom("pickMethod")
        .select("defaultStorageUnitId")
        .where("itemId", "=", item)
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      expect(quarantinedDefault?.defaultStorageUnitId ?? null).toBeNull();

      // A nettable unit does become the default, for an item with no other bin.
      const onShelf = await newItem("first-stock-shelf");
      await receive(onShelf, warehouse, 2);
      await f.db
        .transaction()
        .execute((trx) =>
          updatePickMethodDefaultStorageUnitIfNeeded(
            trx,
            onShelf,
            f.locationId,
            warehouse,
            f.companyId,
            USER
          )
        );
      const shelfDefault = await f.db
        .selectFrom("pickMethod")
        .select("defaultStorageUnitId")
        .where("itemId", "=", onShelf)
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      expect(shelfDefault?.defaultStorageUnitId).toBe(warehouse);
    }
  );

  postgrestTest("finds the lots held in a non-nettable unit", async (client) => {
    const item = await newItem("lots", "Batch");
    const held = `${f.prefix}-lot-held`;
    const free = `${f.prefix}-lot-free`;
    await seed(f, (trx) =>
      trx
        .insertInto("trackedEntity")
        .values(
          ["held", "free"].map((name) => ({
            id: `${f.prefix}-lot-${name}`,
            readableId: name,
            itemId: item,
            sourceDocument: "Item",
            sourceDocumentId: item,
            quantity: 3,
            status: "Available" as const,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );
    await seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values([
          [held, quarantine],
          [free, warehouse]
        ].map(([trackedEntityId, storageUnitId]) => ({
          entryType: "Positive Adjmt." as const,
          documentType: "Inventory Receipt" as const,
          itemId: item,
          locationId: f.locationId,
          storageUnitId,
          trackedEntityId,
          quantity: 3,
          companyId: f.companyId,
          createdBy: USER
        })))
        .execute()
    );

    const result = await getNonNettableTrackedEntityIds(
      client,
      f.companyId,
      [held, free]
    );
    expect(result.error).toBeNull();
    expect([...(result.data ?? [])]).toEqual([held]);
  });

  databaseTest(
    "a new job material passes over a non-nettable pick method default",
    async () => {
      const item = `${f.prefix}-defaulted`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-DF`,
            name: "Defaulted part",
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("pickMethod")
          .values({
            itemId: item,
            locationId: f.locationId,
            defaultStorageUnitId: quarantine,
            companyId: f.companyId,
            createdBy: USER
          })
          .onConflict((oc) =>
            oc
              .columns(["itemId", "locationId"])
              .doUpdateSet({ defaultStorageUnitId: quarantine })
          )
          .execute();
      });
      await receive(item, warehouse, 3);
      await receive(item, quarantine, 30);

      const bin = await f.db
        .transaction()
        .execute((trx) =>
          getStorageUnitId(trx, item, f.locationId, f.companyId)
        );
      expect(bin).toBe(warehouse);
    }
  );

  databaseTest(
    "a backflush short in the guessed bin does not fall back to a non-nettable unit",
    async () => {
      // Its own stock: 1 nettable unit against a need of 2, 30 in quarantine.
      const item = `${f.prefix}-backflushed`;
      await seed(f, (trx) =>
        trx
          .insertInto("item")
          .values({
            id: item,
            readableId: `${f.prefix}-BF`,
            name: "Backflushed part",
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      await receive(item, warehouse, 1);
      await receive(item, quarantine, 30);
      const job = await jobFixture(f, "backflush");
      await f.db
        .updateTable("jobMaterial")
        .set({ itemId: item })
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "issue",
          { type: "jobOperation", id: job.operationId, quantity: 1 },
          issue
        )
      );

      const consumed = await f.db
        .selectFrom("itemLedger")
        .select(["storageUnitId", "quantity"])
        .where("itemId", "=", item)
        .where("documentType", "=", "Job Consumption")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(consumed).toEqual([{ storageUnitId: warehouse, quantity: -2 }]);
    }
  );

  postgrestTest(
    "a new BoM line seeds its Pull From only from a nettable default",
    async (client) => {
      const makeMethodId = `${f.prefix}-seeded-method`;
      await seed(f, (trx) =>
        trx
          .insertInto("makeMethod")
          .values({
            id: makeMethodId,
            itemId: f.assemblyId,
            version: 77,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const addLine = async (itemId: string) => {
        const line = await upsertMethodMaterial(client, {
          makeMethodId,
          order: 1,
          itemType: "Part",
          kit: false,
          methodType: "Pull from Inventory",
          sourcingType: "Purchased",
          itemId,
          quantity: 1,
          unitOfMeasureCode: "EA",
          companyId: f.companyId,
          createdBy: USER
        } as never);
        expect(line.error).toBeNull();
        const row = await f.db
          .selectFrom("methodMaterial")
          .select("storageUnitIds")
          .where("makeMethodId", "=", makeMethodId)
          .where("itemId", "=", itemId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        return row.storageUnitIds;
      };

      const onShelf = await newItem("seeded-shelf");
      await setDefaultBin(onShelf, warehouse);
      expect(await addLine(onShelf)).toEqual({ [f.locationId]: warehouse });

      const onHold = await newItem("seeded-hold");
      await setDefaultBin(onHold, quarantine);
      expect(await addLine(onHold)).toEqual({});
    }
  );
});

describe.skipIf(!hasLocalDatabase)("job completion's default bin", () => {
  // Completes one assembly into a new unit and reads the pick method default
  // the completion leaves for it.
  const completeInto = async (nettable: boolean) => {
    const f = await alwaysPostFixture();
    try {
      const unit = `${f.prefix}-output`;
      await seed(f, (trx) =>
        trx
          .insertInto("storageUnit")
          .values({
            id: unit,
            name: "Output",
            locationId: f.locationId,
            nettable,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute()
      );
      const job = await jobFixture(f, "complete");
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${unit}, ${f.locationId}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      const pickMethod = await f.db
        .selectFrom("pickMethod")
        .select("defaultStorageUnitId")
        .where("itemId", "=", f.assemblyId)
        .where("locationId", "=", f.locationId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirst();
      return { unit, defaultStorageUnitId: pickMethod?.defaultStorageUnitId ?? null };
    } finally {
      await f.cleanup();
    }
  };

  databaseTest("makes a nettable output unit the item's default", async () => {
    const { unit, defaultStorageUnitId } = await completeInto(true);
    expect(defaultStorageUnitId).toBe(unit);
  });

  databaseTest("never makes a non-nettable output unit the default", async () => {
    const { defaultStorageUnitId } = await completeInto(false);
    expect(defaultStorageUnitId).toBeNull();
  });
});
