// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Every property stored before its first drag
// sits at the column default, sort order 1.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { updateBatchPropertyOrder } from "../../app/modules/inventory/inventory.server";
import {
  getBatchProperties,
  upsertBatchProperty
} from "../../app/modules/inventory/inventory.service";
import { upsertConfigurationParameter } from "../../app/modules/items/items.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";

let f: Fixture;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  await seed(f, async (trx) => {
    await trx
      .insertInto("batchProperty")
      .values([
        // The part: one never-dragged property, one dragged below it.
        {
          itemId: f.partId,
          label: "Heat number",
          dataType: "text",
          companyId: f.companyId,
          createdBy: USER
        },
        {
          itemId: f.partId,
          label: "Mill",
          dataType: "text",
          sortOrder: 2,
          companyId: f.companyId,
          createdBy: USER
        },
        // The assembly: two never-dragged properties, stored newest first.
        {
          itemId: f.assemblyId,
          label: "Second",
          dataType: "text",
          companyId: f.companyId,
          createdBy: USER,
          createdAt: "2026-01-02T00:00:00Z"
        },
        {
          itemId: f.assemblyId,
          label: "First",
          dataType: "text",
          companyId: f.companyId,
          createdBy: USER,
          createdAt: "2026-01-01T00:00:00Z"
        }
      ])
      .execute();
    await trx
      .insertInto("configurationParameter")
      .values({
        itemId: f.partId,
        key: "length",
        label: "Length",
        dataType: "numeric",
        sortOrder: 2,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await f.cleanup();
}, 120_000);

const labels = async (
  client: Parameters<typeof getBatchProperties>[0],
  itemId: string
) => {
  const properties = await getBatchProperties(client, [itemId], f.companyId);
  expect(properties.error).toBeNull();
  return properties.data?.map((property) => property.label);
};

describe("a new batch property", () => {
  postgrestTest(
    "is listed after every property of the item, dragged ones included",
    async (client) => {
      const insert = await upsertBatchProperty(client, {
        itemId: f.partId,
        label: "Coating",
        dataType: "text",
        companyId: f.companyId,
        userId: USER
      });
      expect(insert.error).toBeNull();

      expect(await labels(client, f.partId)).toEqual([
        "Heat number",
        "Mill",
        "Coating"
      ]);
    }
  );
});

describe("batch properties that share a sort order", () => {
  postgrestTest("are listed in the order they were created", async (client) => {
    expect(await labels(client, f.assemblyId)).toEqual(["First", "Second"]);
  });
});

describe("updateBatchPropertyOrder", () => {
  const idOf = async (itemId: string, label: string) =>
    (
      await f.db
        .selectFrom("batchProperty")
        .select("id")
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .where("label", "=", label)
        .executeTakeFirstOrThrow()
    ).id;

  postgrestTest("writes the item's new order", async (client) => {
    const result = await updateBatchPropertyOrder(
      operationContext(f, client, USER),
      {
        itemId: f.assemblyId,
        updates: [
          { id: await idOf(f.assemblyId, "Second"), sortOrder: 1 },
          { id: await idOf(f.assemblyId, "First"), sortOrder: 2 }
        ]
      }
    );
    expect(result.error).toBeNull();

    expect(await labels(client, f.assemblyId)).toEqual(["Second", "First"]);
  });

  postgrestTest(
    "refuses a property of another item and writes nothing",
    async (client) => {
      // A starting order the refused update's first row would change.
      await seed(f, async (trx) => {
        for (const [label, sortOrder] of [
          ["Second", 1],
          ["First", 2]
        ] as const) {
          await trx
            .updateTable("batchProperty")
            .set({ sortOrder })
            .where("itemId", "=", f.assemblyId)
            .where("companyId", "=", f.companyId)
            .where("label", "=", label)
            .execute();
        }
      });
      const partBefore = await labels(client, f.partId);

      const result = await updateBatchPropertyOrder(
        operationContext(f, client, USER),
        {
          itemId: f.assemblyId,
          updates: [
            { id: await idOf(f.assemblyId, "First"), sortOrder: 1 },
            { id: await idOf(f.partId, "Heat number"), sortOrder: 2 }
          ]
        }
      );
      expect(result.error?.category).toBe("rule");

      expect(await labels(client, f.assemblyId)).toEqual(["Second", "First"]);
      expect(await labels(client, f.partId)).toEqual(partBefore);
    }
  );
});

describe("a new configuration parameter", () => {
  postgrestTest("is numbered after the item's last parameter", async (client) => {
    const insert = await upsertConfigurationParameter(client, {
      itemId: f.partId,
      key: "width",
      label: "Width",
      dataType: "numeric",
      companyId: f.companyId,
      userId: USER
    });
    expect(insert.error).toBeNull();

    const parameter = await f.db
      .selectFrom("configurationParameter")
      .select("sortOrder")
      .where("itemId", "=", f.partId)
      .where("companyId", "=", f.companyId)
      .where("key", "=", "width")
      .executeTakeFirstOrThrow();
    expect(parameter.sortOrder).toBe(3);
  });
});
