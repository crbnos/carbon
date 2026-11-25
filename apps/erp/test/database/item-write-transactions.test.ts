// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The item writes that land in one transaction
// or not at all, read back from the rows.

import { SERVICE_RULE_ERROR_CODE } from "@carbon/api";
import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as items from "../../app/modules/items/items.server";
import * as itemsService from "../../app/modules/items/items.service";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `itemtrx-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  company: `${prefix}-company`,
  group: `${prefix}-group`,
  location: `${prefix}-location`,
  storageUnit: `${prefix}-bin`,
  part: `${prefix}-part`,
  partWithoutUngrouped: `${prefix}-part-no-ungrouped`,
  ungrouped: `${prefix}-cpg-ungrouped`,
  sizeGroup: `${prefix}-cpg-size`,
  colorGroup: `${prefix}-cpg-color`,
  orphanGroup: `${prefix}-cpg-orphan`,
  otherCompany: `${prefix}-other`,
  otherGroup: `${prefix}-other-group`,
  otherPart: `${prefix}-other-part`,
  otherCompanyGroup: `${prefix}-other-cpg`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

// The system, so the permission gate passes: what refuses is the operation.
const ctx = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: ids.company, groupId: ids.group },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

/** Runs `fn` with the interceptors on, as the app does: an item insert then
 *  creates the item's cost row. */
async function withInterceptors<T>(fn: () => Promise<T>): Promise<T> {
  await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
    db
  );
  try {
    return await fn();
  } finally {
    await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
      db
    );
  }
}

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  const createdBy = "system";
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const [companyId, groupId] of [
      [ids.company, ids.group],
      [ids.otherCompany, ids.otherGroup]
    ] as const) {
      await trx
        .insertInto("companyGroup")
        .values({ id: groupId, name: groupId, createdBy })
        .execute();
      await trx
        .insertInto("company")
        .values({
          id: companyId,
          name: companyId,
          companyGroupId: groupId,
          baseCurrencyCode: "USD",
          timezone: "America/New_York"
        })
        .execute();
      // The company insert makes its settings row; IDs are typed by hand.
      await trx
        .updateTable("companySettings")
        .set({ materialGeneratedIds: false })
        .where("id", "=", companyId)
        .execute();
      await trx
        .insertInto("unitOfMeasure")
        .values({ code: "EA", name: "Each", companyId, createdBy })
        .execute();
    }
    await trx
      .insertInto("location")
      .values({
        id: ids.location,
        name: "Plant",
        addressLine1: "1 Test Way",
        city: "Testville",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId: ids.company,
        createdBy
      })
      .execute();
    await trx
      .insertInto("storageUnit")
      .values({
        id: ids.storageUnit,
        name: "Bin 1",
        locationId: ids.location,
        companyId: ids.company,
        createdBy
      })
      .execute();

    const part = (id: string, companyId: string) => ({
      id,
      readableId: id,
      name: "Configurable bracket",
      type: "Part" as const,
      itemTrackingType: "Inventory" as const,
      unitOfMeasureCode: "EA",
      companyId,
      createdBy
    });
    await trx
      .insertInto("item")
      .values([
        part(ids.part, ids.company),
        part(ids.partWithoutUngrouped, ids.company),
        part(ids.otherPart, ids.otherCompany)
      ])
      .execute();
    const group = (
      id: string,
      itemId: string,
      companyId: string,
      isUngrouped = false
    ) => ({
      id,
      itemId,
      name: isUngrouped ? "Ungrouped" : "Size",
      isUngrouped,
      companyId
    });
    await trx
      .insertInto("configurationParameterGroup")
      .values([
        group(ids.ungrouped, ids.part, ids.company, true),
        group(ids.sizeGroup, ids.part, ids.company),
        { ...group(ids.colorGroup, ids.part, ids.company), name: "Color" },
        group(ids.orphanGroup, ids.partWithoutUngrouped, ids.company),
        group(ids.otherCompanyGroup, ids.otherPart, ids.otherCompany)
      ])
      .execute();
    const parameter = (key: string, itemId: string, groupId: string) => ({
      id: `${prefix}-cp-${key}`,
      itemId,
      key,
      label: key,
      dataType: "numeric" as const,
      configurationParameterGroupId: groupId,
      companyId: ids.company,
      createdBy
    });
    await trx
      .insertInto("configurationParameter")
      .values([
        parameter("width", ids.part, ids.sizeGroup),
        parameter("height", ids.part, ids.sizeGroup),
        parameter("length", ids.part, ids.ungrouped),
        parameter("weight", ids.part, ids.ungrouped),
        parameter("depth", ids.partWithoutUngrouped, ids.orphanGroup)
      ])
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const [companyId, groupId] of [
      [ids.company, ids.group],
      [ids.otherCompany, ids.otherGroup]
    ]) {
      await trx.deleteFrom("company").where("id", "=", companyId).execute();
      await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
      await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
        trx
      );
      await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
        trx
      );
    }
  });
  await db.destroy();
}, 60_000);

const groupOf = async (parameterKey: string) =>
  (
    await db
      .selectFrom("configurationParameter")
      .select("configurationParameterGroupId")
      .where("id", "=", `${prefix}-cp-${parameterKey}`)
      .executeTakeFirstOrThrow()
  ).configurationParameterGroupId;

const groupExists = async (id: string) =>
  (await db
    .selectFrom("configurationParameterGroup")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst()) !== undefined;

describeLocal("deleting a configuration parameter group", () => {
  it("refuses the Ungrouped group", async () => {
    const result = await items.deleteConfigurationParameterGroup(ctx(), {
      id: ids.ungrouped
    });

    expect(result.error?.category).toBe("rule");
    expect(await groupExists(ids.ungrouped)).toBe(true);
  });

  it("refuses a group whose item has no Ungrouped group, and moves nothing", async () => {
    const result = await items.deleteConfigurationParameterGroup(ctx(), {
      id: ids.orphanGroup
    });

    expect(result.error?.category).toBe("rule");
    expect(await groupExists(ids.orphanGroup)).toBe(true);
    expect(await groupOf("depth")).toBe(ids.orphanGroup);
  });

  it("refuses another company's group", async () => {
    const result = await items.deleteConfigurationParameterGroup(ctx(), {
      id: ids.otherCompanyGroup
    });

    expect(result.error?.category).toBe("rule");
    expect(await groupExists(ids.otherCompanyGroup)).toBe(true);
  });

  it("moves the group's parameters to the item's Ungrouped group and deletes it", async () => {
    const result = await items.deleteConfigurationParameterGroup(ctx(), {
      id: ids.sizeGroup
    });

    expect(result).toEqual({ data: [{ id: ids.sizeGroup }], error: null });
    expect(await groupExists(ids.sizeGroup)).toBe(false);
    expect(await groupOf("width")).toBe(ids.ungrouped);
    expect(await groupOf("height")).toBe(ids.ungrouped);
  });
});

describeLocal("saving a configuration parameter", () => {
  const edit = (configurationParameterGroupId: string) =>
    items.upsertConfigurationParameter(ctx(), {
      id: `${prefix}-cp-length`,
      itemId: ids.part,
      key: "length",
      label: "Length",
      dataType: "numeric",
      configurationParameterGroupId
    });

  it("refuses a group of another item and keeps the parameter's group", async () => {
    const result = await edit(ids.orphanGroup);

    expect(result.error?.category).toBe("rule");
    expect(await groupOf("length")).toBe(ids.ungrouped);
  });

  it("refuses a group of another company and keeps the parameter's group", async () => {
    const result = await edit(ids.otherCompanyGroup);

    expect(result.error?.category).toBe("rule");
    expect(await groupOf("length")).toBe(ids.ungrouped);
  });

  it("moves the parameter to another group of its item", async () => {
    const result = await edit(ids.colorGroup);

    expect(result.error).toBeNull();
    expect(await groupOf("length")).toBe(ids.colorGroup);
  });
});

describeLocal("reordering a configuration parameter", () => {
  const move = (configurationParameterGroupId: string | null) =>
    items.updateConfigurationParameterOrder(ctx(), {
      id: `${prefix}-cp-weight`,
      sortOrder: 1,
      configurationParameterGroupId
    });

  it("refuses a group of another item and keeps the parameter's group", async () => {
    const result = await move(ids.orphanGroup);

    expect(result.error?.category).toBe("rule");
    expect(await groupOf("weight")).toBe(ids.ungrouped);
  });

  it("refuses a group of another company and keeps the parameter's group", async () => {
    const result = await move(ids.otherCompanyGroup);

    expect(result.error?.category).toBe("rule");
    expect(await groupOf("weight")).toBe(ids.ungrouped);
  });

  it("moves the parameter to another group of its item", async () => {
    const result = await move(ids.colorGroup);

    expect(result.error).toBeNull();
    expect(await groupOf("weight")).toBe(ids.colorGroup);
  });

  it("takes the parameter out of every group", async () => {
    const result = await move(null);

    expect(result.error).toBeNull();
    expect(await groupOf("weight")).toBeNull();
  });
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function backendPid(connection: Kysely<KyselyDatabase>) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(connection);
  return rows[0]!.pid;
}

async function waitForBlockedConnection(
  monitor: Kysely<KyselyDatabase>,
  waitingPid: number
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT cardinality(pg_blocking_pids(${waitingPid})) > 0 AS blocked
    `.execute(monitor);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database connection to wait for the held lock");
}

describeLocal("creating a material", () => {
  const material = (id: string) => ({
    id,
    name: "Aluminum plate",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Pull from Inventory" as const,
    itemTrackingType: "Inventory" as const,
    unitOfMeasureCode: "EA"
  });

  const revisionsOf = async (readableId: string) =>
    db
      .selectFrom("item")
      .leftJoin("itemCost", "itemCost.itemId", "item.id")
      .select(["item.revision", "itemCost.unitCost"])
      .where("item.readableId", "=", readableId)
      .where("item.companyId", "=", ids.company)
      .orderBy("item.revision")
      .execute();

  const materialRowExists = async (readableId: string) =>
    (await db
      .selectFrom("material")
      .select("id")
      .where("id", "=", readableId)
      .where("companyId", "=", ids.company)
      .executeTakeFirst()) !== undefined;

  it("writes one revision per distinct size, each with the cost sent", async () => {
    const readableId = `${prefix}-MAT-SIZES`;

    const result = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        unitCost: 12.5,
        sizes: ["A", "A", "B"]
      })
    );

    expect(result.error).toBeNull();
    expect(await revisionsOf(readableId)).toEqual([
      { revision: "A", unitCost: 12.5 },
      { revision: "B", unitCost: 12.5 }
    ]);
    expect(await materialRowExists(readableId)).toBe(true);
  });

  it("writes the initial revision for an empty size list", async () => {
    const readableId = `${prefix}-MAT-NOSIZES`;

    const result = await withInterceptors(() =>
      items.createMaterial(ctx(), { ...material(readableId), sizes: [] })
    );

    expect(result.error).toBeNull();
    expect((await revisionsOf(readableId)).map((row) => row.revision)).toEqual(
      ["0"]
    );
    expect(await materialRowExists(readableId)).toBe(true);
  });

  it("rolls the whole create back when the requested cost is not saved", async () => {
    const readableId = `${prefix}-MAT-NOCOST`;

    const refused = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        postingGroupId: `${prefix}-no-such-group`,
        sizes: ["A", "B"]
      })
    );

    expect(refused.error).not.toBeNull();
    expect(await revisionsOf(readableId)).toEqual([]);
    expect(await materialRowExists(readableId)).toBe(false);

    // Nothing is left holding the ID, so the corrected call goes through.
    const retried = await withInterceptors(() =>
      items.createMaterial(ctx(), { ...material(readableId), sizes: ["A"] })
    );
    expect(retried.error).toBeNull();
  });

  it("takes over the material row its deleted items left behind", async () => {
    const readableId = `${prefix}-MAT-REUSED`;
    await db
      .insertInto("material")
      .values({ id: readableId, companyId: ids.company, createdBy: "system" })
      .execute();

    const result = await withInterceptors(() =>
      items.createMaterial(ctx(), { ...material(readableId) })
    );

    expect(result.error).toBeNull();
    expect((await revisionsOf(readableId)).map((row) => row.revision)).toEqual(
      ["0"]
    );
  });

  it("refuses an ID and name other than the pair the caller accepted", async () => {
    const readableId = `${prefix}-MAT-ACCEPTED`;

    const result = await withInterceptors(() =>
      itemsService.insertMaterial(
        client!,
        db,
        {
          ...material(readableId),
          companyId: ids.company,
          createdBy: "system"
        } as never,
        { readableId, name: "Aluminum sheet" }
      )
    );

    expect(result.error).toMatchObject({ code: SERVICE_RULE_ERROR_CODE });
    expect(await revisionsOf(readableId)).toEqual([]);
  });

  it("writes the pick method and shelf life of every revision with it", async () => {
    const readableId = `${prefix}-MAT-SETUP`;

    const result = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        itemTrackingType: "Batch",
        defaultStorageUnitId: ids.storageUnit,
        shelfLifeMode: "Set on Receipt",
        sizes: ["A", "B"]
      })
    );

    expect(result.error).toBeNull();
    const setup = await db
      .selectFrom("item")
      .leftJoin("pickMethod", "pickMethod.itemId", "item.id")
      .leftJoin("itemShelfLife", "itemShelfLife.itemId", "item.id")
      .select([
        "item.revision",
        "pickMethod.locationId",
        "pickMethod.defaultStorageUnitId",
        "itemShelfLife.mode"
      ])
      .where("item.readableId", "=", readableId)
      .where("item.companyId", "=", ids.company)
      .orderBy("item.revision")
      .execute();
    expect(setup).toEqual(
      ["A", "B"].map((revision) => ({
        revision,
        locationId: ids.location,
        defaultStorageUnitId: ids.storageUnit,
        mode: "Set on Receipt"
      }))
    );
  });

  it("rolls the whole create back when the shelf life is refused, and the ID stays free", async () => {
    const readableId = `${prefix}-MAT-SHELFLIFE`;

    // A new material has no recipe, so no process can trigger its shelf life.
    const refused = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        itemTrackingType: "Batch",
        defaultStorageUnitId: ids.storageUnit,
        shelfLifeMode: "Fixed Duration",
        shelfLifeDays: 30,
        shelfLifeTriggerProcessId: `${prefix}-no-such-process`
      })
    );

    expect(refused.error?.category).toBe("rule");
    expect(await revisionsOf(readableId)).toEqual([]);
    expect(await materialRowExists(readableId)).toBe(false);

    const retried = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        itemTrackingType: "Batch",
        shelfLifeMode: "Fixed Duration",
        shelfLifeDays: 30
      })
    );
    expect(retried.error).toBeNull();
  });

  it("refuses a create of an ID another create holds, and adds no revision", async () => {
    const readableId = `${prefix}-MAT-RACE`;
    const holder = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let holding: Promise<void> | undefined;
    let creating: ReturnType<typeof items.createMaterial> | undefined;
    try {
      // The first create holds the ID's lock and has written its revision.
      holding = holder.transaction().execute(async (trx) => {
        await itemsService.lockMaterialReadableId(trx, ids.company, readableId);
        await trx
          .insertInto("item")
          .values({
            readableId,
            revision: "A",
            name: "Aluminum plate",
            type: "Material",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            companyId: ids.company,
            createdBy: "system"
          })
          .execute();
        held.resolve();
        await release.promise;
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      creating = withInterceptors(() =>
        items.createMaterial(ctx(), { ...material(readableId), sizes: ["B"] })
      );
      await waitForBlockedConnection(monitor, await backendPid(db));
      release.resolve();
      await holding;

      const result = await creating;
      expect(result.error?.category).toBe("rule");
      expect(
        (await revisionsOf(readableId)).map((row) => row.revision)
      ).toEqual(["A"]);
      expect(await materialRowExists(readableId)).toBe(false);
    } finally {
      release.resolve();
      await holding?.catch(() => {});
      await creating?.catch(() => {});
      await holder.destroy();
      await monitor.destroy();
    }
  }, 30_000);

  it("refuses a rename to an ID a create holds, and keeps the material's ID", async () => {
    const source = `${prefix}-MAT-RENAME-SRC`;
    const target = `${prefix}-MAT-RENAME-NEW`;
    const created = await withInterceptors(() =>
      items.createMaterial(ctx(), material(source))
    );
    expect(created.error).toBeNull();
    const holder = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let holding: Promise<void> | undefined;
    let renaming: ReturnType<typeof items.updateMaterial> | undefined;
    try {
      // A create of the target ID holds its lock and has written its revision.
      holding = holder.transaction().execute(async (trx) => {
        await itemsService.lockMaterialReadableId(trx, ids.company, target);
        await trx
          .insertInto("item")
          .values({
            readableId: target,
            revision: "A",
            name: "Aluminum plate",
            type: "Material",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            companyId: ids.company,
            createdBy: "system"
          })
          .execute();
        held.resolve();
        await release.promise;
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      const { id: _readableId, ...fields } = material(source);
      renaming = withInterceptors(() =>
        items.updateMaterial(ctx(), {
          ...fields,
          id: created.data!.id,
          readableId: target
        })
      );
      await waitForBlockedConnection(monitor, await backendPid(db));
      release.resolve();
      await holding;

      const result = await renaming;
      expect(result.error?.category).toBe("rule");
      expect((await revisionsOf(source)).map((row) => row.revision)).toEqual([
        "0"
      ]);
      expect((await revisionsOf(target)).map((row) => row.revision)).toEqual([
        "A"
      ]);
      expect(await materialRowExists(source)).toBe(true);
    } finally {
      release.resolve();
      await holding?.catch(() => {});
      await renaming?.catch(() => {});
      await holder.destroy();
      await monitor.destroy();
    }
  }, 30_000);
});
