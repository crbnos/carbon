// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The item writes that land in one transaction
// or not at all, read back from the rows.

import { SERVICE_RULE_ERROR_CODE } from "@carbon/api";
import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as items from "../../app/modules/items/items.server";
import * as itemsService from "../../app/modules/items/items.service";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import {
  localServiceRoleClient,
  localServiceRoleEnv
} from "./fixtures/local-supabase";

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
  otherCompanyGroup: `${prefix}-other-cpg`,
  otherParameter: `${prefix}-cp-other`,
  postingGroup: `${prefix}-ipg`,
  otherPostingGroup: `${prefix}-other-ipg`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

// The system, so the permission gate passes: what refuses is the operation.
const ctx = ({
  pg = db,
  caller = client!
}: {
  pg?: Kysely<KyselyDatabase>;
  caller?: SupabaseClient<Database>;
} = {}) =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: ids.company, groupId: ids.group },
    caller,
    system: () => client!,
    pg: () => pg,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

/** The local service-role client, with every read of the `materials` view
 *  held until `until` settles. */
function holdingMaterialsReads(until: Promise<unknown>) {
  const env = localServiceRoleEnv();
  return createClient<Database>(
    env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (new URL(url).pathname === "/rest/v1/materials") await until;
          return fetch(input, init);
        }
      }
    }
  );
}

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
        parameter("depth", ids.partWithoutUngrouped, ids.orphanGroup),
        {
          ...parameter("other", ids.otherPart, ids.otherCompanyGroup),
          companyId: ids.otherCompany
        }
      ])
      .execute();
    await trx
      .insertInto("itemPostingGroup")
      .values([
        {
          id: ids.postingGroup,
          name: "Raw stock",
          companyId: ids.company,
          createdBy
        },
        {
          id: ids.otherPostingGroup,
          name: "Raw stock",
          companyId: ids.otherCompany,
          createdBy
        }
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

  it("refuses another company's parameter and leaves it where it was", async () => {
    const result = await items.updateConfigurationParameterOrder(ctx(), {
      id: ids.otherParameter,
      sortOrder: 7,
      configurationParameterGroupId: ids.otherCompanyGroup
    });

    expect(result.error).not.toBeNull();
    expect(
      await db
        .selectFrom("configurationParameter")
        .select(["companyId", "sortOrder", "configurationParameterGroupId"])
        .where("id", "=", ids.otherParameter)
        .executeTakeFirstOrThrow()
    ).toEqual({
      companyId: ids.otherCompany,
      sortOrder: 1,
      configurationParameterGroupId: ids.otherCompanyGroup
    });
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

  const itemGroupsOf = async (readableId: string) =>
    (
      await db
        .selectFrom("item")
        .innerJoin("itemCost", "itemCost.itemId", "item.id")
        .select("itemCost.itemPostingGroupId")
        .where("item.readableId", "=", readableId)
        .where("item.companyId", "=", ids.company)
        .orderBy("item.revision")
        .execute()
    ).map((row) => row.itemPostingGroupId);

  it("saves the company's item group on every revision", async () => {
    const readableId = `${prefix}-MAT-GROUP`;

    const result = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        postingGroupId: ids.postingGroup,
        sizes: ["A", "B"]
      })
    );

    expect(result.error).toBeNull();
    expect(await itemGroupsOf(readableId)).toEqual([
      ids.postingGroup,
      ids.postingGroup
    ]);
  });

  it("refuses another company's item group, and adds no revision", async () => {
    const readableId = `${prefix}-MAT-FOREIGN-GROUP`;

    const result = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        postingGroupId: ids.otherPostingGroup,
        sizes: ["A", "B"]
      })
    );

    expect(result.error?.category).toBe("rule");
    expect(await revisionsOf(readableId)).toEqual([]);
    expect(await materialRowExists(readableId)).toBe(false);
  });

  it("refuses another company's item group on an update, and keeps the item's group", async () => {
    const readableId = `${prefix}-MAT-UPDATE-GROUP`;
    const created = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        postingGroupId: ids.postingGroup
      })
    );
    expect(created.error).toBeNull();

    const { id: _readableId, ...fields } = material(readableId);
    const result = await withInterceptors(() =>
      items.updateMaterial(ctx(), {
        ...fields,
        id: created.data!.id,
        postingGroupId: ids.otherPostingGroup
      })
    );

    expect(result.error?.category).toBe("rule");
    expect(await itemGroupsOf(readableId)).toEqual([ids.postingGroup]);
  });

  it("returns the revision it created when the material is renamed as it commits", async () => {
    const readableId = `${prefix}-MAT-RETURNED`;
    const renamedId = `${prefix}-MAT-RETURNED-NEW`;
    const holder = await connectLocalTestDatabase();
    const renamer = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const createPid = await backendPid(db);
    const renamePid = await backendPid(renamer);
    const held = signal();
    const release = signal();
    const renamed = signal();
    let holding: Promise<void> | undefined;
    let creating: ReturnType<typeof items.createMaterial> | undefined;
    let renaming: Promise<void> | undefined;
    try {
      // An uncommitted revision of the ID stops the create at its item insert,
      // after it has taken the ID's lock; rolled back, it lets the create on.
      holding = holder.transaction().execute(async (trx) => {
        await trx
          .insertInto("item")
          .values({
            readableId,
            revision: "0",
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
        throw new Error("rolled back");
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      // A read of the materials list after the commit lands after the rename.
      creating = withInterceptors(() =>
        items.createMaterial(
          ctx({ caller: holdingMaterialsReads(renamed.promise) }),
          material(readableId)
        )
      );
      await waitForBlockedConnection(monitor, createPid);

      // A rename of the ID waits for the create's lock and commits after it.
      renaming = renamer.transaction().execute(async (trx) => {
        await itemsService.lockMaterialReadableId(trx, ids.company, readableId);
        await trx
          .updateTable("material")
          .set({ id: renamedId })
          .where("id", "=", readableId)
          .where("companyId", "=", ids.company)
          .execute();
        await trx
          .updateTable("item")
          .set({ readableId: renamedId })
          .where("readableId", "=", readableId)
          .where("companyId", "=", ids.company)
          .where("type", "=", "Material")
          .execute();
      });
      void renaming.finally(renamed.resolve).catch(() => {});
      await waitForBlockedConnection(monitor, renamePid);
      release.resolve();

      const result = await creating;
      await renaming;
      const revisions = await db
        .selectFrom("item")
        .select("id")
        .where("readableId", "=", renamedId)
        .where("companyId", "=", ids.company)
        .execute();
      expect(revisions).toHaveLength(1);
      expect(result).toEqual({ data: { id: revisions[0]!.id }, error: null });
    } finally {
      release.resolve();
      renamed.resolve();
      await holding?.catch(() => {});
      await creating?.catch(() => {});
      await renaming?.catch(() => {});
      await holder.destroy();
      await renamer.destroy();
      await monitor.destroy();
    }
  }, 30_000);

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

  it("rolls the whole create back when the requested item group does not exist", async () => {
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

  it("writes every revision's shelf life in one statement", async () => {
    const readableId = `${prefix}-MAT-BULK-SHELFLIFE`;
    // Statements that name itemShelfLife, by kind: a per-revision loop would
    // read and insert once per size under the ID's lock.
    const statements: string[] = [];
    const counted = db.withPlugin({
      transformQuery: ({ node }) => {
        if (JSON.stringify(node).includes('"name":"itemShelfLife"')) {
          statements.push(node.kind);
        }
        return node;
      },
      transformResult: async ({ result }) => result
    });

    const result = await withInterceptors(() =>
      items.createMaterial(ctx({ pg: counted }), {
        ...material(readableId),
        itemTrackingType: "Batch",
        shelfLifeMode: "Set on Receipt",
        sizes: ["A", "B", "C"]
      })
    );

    expect(result.error).toBeNull();
    expect(statements).toEqual(["InsertQueryNode"]);
    const modes = await db
      .selectFrom("item")
      .innerJoin("itemShelfLife", "itemShelfLife.itemId", "item.id")
      .select(["item.revision", "itemShelfLife.mode"])
      .where("item.readableId", "=", readableId)
      .where("item.companyId", "=", ids.company)
      .orderBy("item.revision")
      .execute();
    expect(modes).toEqual(
      ["A", "B", "C"].map((revision) => ({ revision, mode: "Set on Receipt" }))
    );
  });

  it("changes an item's shelf life in place from the inventory card, and removes it", async () => {
    const readableId = `${prefix}-MAT-CARD-SHELFLIFE`;
    const created = await withInterceptors(() =>
      items.createMaterial(ctx(), {
        ...material(readableId),
        itemTrackingType: "Batch",
        shelfLifeMode: "Set on Receipt"
      })
    );
    expect(created.error).toBeNull();
    const itemId = created.data!.id;
    const card = (shelfLife: {
      mode: "Fixed Duration" | "NotManaged";
      days?: number;
    }) =>
      itemsService.upsertPickMethodWithShelfLife(db, {
        itemId,
        locationId: ids.location,
        companyId: ids.company,
        userId: "system",
        shelfLife
      });
    const policy = () =>
      db
        .selectFrom("itemShelfLife")
        .select(["mode", "days"])
        .where("itemId", "=", itemId)
        .executeTakeFirst();

    await card({ mode: "Fixed Duration", days: 30 });
    expect(await policy()).toEqual({ mode: "Fixed Duration", days: 30 });

    await card({ mode: "NotManaged" });
    expect(await policy()).toBeUndefined();
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

  it("rolls a whole update back when its shelf life is refused", async () => {
    const readableId = `${prefix}-MAT-UPDATE-SHELFLIFE`;
    const created = await withInterceptors(() =>
      items.createMaterial(ctx(), { ...material(readableId), unitCost: 5 })
    );
    expect(created.error).toBeNull();
    const itemId = created.data!.id;

    const { id: _readableId, ...fields } = material(readableId);
    const refused = await withInterceptors(() =>
      items.updateMaterial(ctx(), {
        ...fields,
        id: itemId,
        name: "Aluminum plate offcuts",
        unitCost: 9,
        defaultStorageUnitId: ids.storageUnit,
        shelfLifeMode: "Fixed Duration",
        shelfLifeDays: 30,
        shelfLifeTriggerProcessId: `${prefix}-no-such-process`
      })
    );

    expect(refused.error?.category).toBe("rule");
    expect(await revisionsOf(readableId)).toEqual([
      { revision: "0", unitCost: 5 }
    ]);
    expect(
      await db
        .selectFrom("item")
        .select("name")
        .where("id", "=", itemId)
        .executeTakeFirstOrThrow()
    ).toEqual({ name: "Aluminum plate" });
    expect(
      await db
        .selectFrom("pickMethod")
        .select("itemId")
        .where("itemId", "=", itemId)
        .execute()
    ).toEqual([]);
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

  it("refuses a new revision of a material renamed while it waited, and adds none", async () => {
    const source = `${prefix}-MAT-REVISION-SRC`;
    const target = `${prefix}-MAT-REVISION-NEW`;
    const created = await withInterceptors(() =>
      items.createMaterial(ctx(), material(source))
    );
    expect(created.error).toBeNull();
    const sourceItem = await itemsService.getItem(client!, created.data!.id);
    expect(sourceItem.error).toBeNull();
    const holder = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let holding: Promise<void> | undefined;
    let revising: ReturnType<typeof itemsService.createRevision> | undefined;
    try {
      // A rename holds both IDs' locks and has moved the rows to the new ID.
      holding = holder.transaction().execute(async (trx) => {
        await itemsService.lockMaterialReadableIds(trx, ids.company, [
          source,
          target
        ]);
        await trx
          .updateTable("material")
          .set({ id: target })
          .where("id", "=", source)
          .where("companyId", "=", ids.company)
          .execute();
        await trx
          .updateTable("item")
          .set({ readableId: target })
          .where("readableId", "=", source)
          .where("companyId", "=", ids.company)
          .where("type", "=", "Material")
          .execute();
        held.resolve();
        await release.promise;
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      // The revision was read before the rename committed.
      revising = withInterceptors(() =>
        itemsService.createRevision(client!, db, {
          item: sourceItem.data!,
          revision: "B",
          createdBy: "system"
        })
      );
      await waitForBlockedConnection(monitor, await backendPid(db));
      release.resolve();
      await holding;

      const result = await revising;
      expect(result.error).toMatchObject({ code: SERVICE_RULE_ERROR_CODE });
      expect(await revisionsOf(source)).toEqual([]);
      expect((await revisionsOf(target)).map((row) => row.revision)).toEqual([
        "0"
      ]);
    } finally {
      release.resolve();
      await holding?.catch(() => {});
      await revising?.catch(() => {});
      await holder.destroy();
      await monitor.destroy();
    }
  }, 30_000);
});

describeLocal("creating a part, tool or consumable", () => {
  const item = (id: string) => ({
    id,
    name: "Gloves",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Pull from Inventory" as const,
    itemTrackingType: "Batch" as const,
    unitOfMeasureCode: "EA"
  });
  const creates = [
    [
      "createPart",
      (id: string, sent: object = {}) =>
        items.createPart(ctx(), { ...item(id), revision: "0", ...sent })
    ],
    [
      "createTool",
      (id: string, sent: object = {}) =>
        items.createTool(ctx(), { ...item(id), revision: "0", ...sent })
    ],
    [
      "createConsumable",
      (id: string, sent: object = {}) =>
        items.createConsumable(ctx(), { ...item(id), ...sent })
    ]
  ] as const;

  const itemsNumbered = async (readableId: string) =>
    db
      .selectFrom("item")
      .select("id")
      .where("readableId", "=", readableId)
      .where("companyId", "=", ids.company)
      .execute();

  it.each(creates)("%s rolls the whole create back when the shelf life is refused, and the number stays free", async (name, create) => {
    const readableId = `${prefix}-${name}-SHELFLIFE`;

    // A new item has no recipe, so no process can trigger its shelf life.
    const refused = await withInterceptors(() =>
      create(readableId, {
        unitCost: 4,
        defaultStorageUnitId: ids.storageUnit,
        shelfLifeMode: "Fixed Duration",
        shelfLifeDays: 30,
        shelfLifeTriggerProcessId: `${prefix}-no-such-process`
      })
    );

    expect(refused.error?.category).toBe("rule");
    expect(await itemsNumbered(readableId)).toEqual([]);

    const retried = await withInterceptors(() =>
      create(readableId, { shelfLifeMode: "Fixed Duration", shelfLifeDays: 30 })
    );
    expect(retried.error).toBeNull();
    expect(await itemsNumbered(readableId)).toEqual([
      { id: retried.data!.id }
    ]);
  });

  it.each(creates)("%s refuses another company's item group, and adds no item", async (name, create) => {
    const readableId = `${prefix}-${name}-FOREIGN-GROUP`;

    const result = await withInterceptors(() =>
      create(readableId, { postingGroupId: ids.otherPostingGroup })
    );

    expect(result.error?.category).toBe("rule");
    expect(await itemsNumbered(readableId)).toEqual([]);
  });

  it.each(creates)("%s saves the item group, unit cost and default storage unit", async (name, create) => {
    const readableId = `${prefix}-${name}-SETUP`;

    const result = await withInterceptors(() =>
      create(readableId, {
        postingGroupId: ids.postingGroup,
        unitCost: 4,
        defaultStorageUnitId: ids.storageUnit
      })
    );

    expect(result.error).toBeNull();
    expect(
      await db
        .selectFrom("item")
        .innerJoin("itemCost", "itemCost.itemId", "item.id")
        .innerJoin("pickMethod", "pickMethod.itemId", "item.id")
        .select([
          "item.id",
          "itemCost.itemPostingGroupId",
          "itemCost.unitCost",
          "pickMethod.defaultStorageUnitId"
        ])
        .where("item.readableId", "=", readableId)
        .where("item.companyId", "=", ids.company)
        .execute()
    ).toEqual([
      {
        id: result.data!.id,
        itemPostingGroupId: ids.postingGroup,
        unitCost: 4,
        defaultStorageUnitId: ids.storageUnit
      }
    ]);
  });
});
