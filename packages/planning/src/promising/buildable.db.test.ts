// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import { getProcessPool, type KyselyDatabase } from "@carbon/database/client";
import { Kysely, PostgresDialect } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadBuildable } from "./buildable.ts";

// Runs against the local database:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/planning test -- buildable.db
//
// Each test runs inside one transaction that is always rolled back, so it
// writes nothing. Fixtures are inserted with `session_replication_role =
// replica` (FKs and triggers off).
const url = process.env.SUPABASE_DB_URL;

const connect = () => getProcessPool().connect();
type PoolClient = Awaited<ReturnType<typeof connect>>;

describe.skipIf(!url)("loadBuildable against a migrated database", () => {
  let client: PoolClient;
  // Kysely releases what `connect` hands it after each query; the test keeps
  // the one connection, so it gets a no-op and the real release runs last.
  let release: () => void;
  const db = new Kysely<KyselyDatabase>({
    dialect: new PostgresDialect({
      pool: {
        connect: async () =>
          Object.assign(client, { release: () => undefined }),
        end: async () => undefined
      }
    })
  });

  const suffix = randomUUID().slice(0, 8);
  const id = (name: string) => `t-${suffix}-${name}`;
  const companyId = id("company");
  const locationId = id("location");

  beforeAll(async () => {
    client = await connect();
    release = client.release.bind(client);
  });
  afterAll(() => {
    release();
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const insert = (table: string, row: Record<string, unknown>) => {
    const columns = Object.keys(row);
    return client.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row)
    );
  };
  const item = (name: string, replenishmentSystem: string, scrap = 0) =>
    Promise.all([
      insert("item", {
        id: id(name),
        companyId,
        readableId: name,
        name,
        type: "Part",
        itemTrackingType: "Inventory",
        replenishmentSystem,
        unitOfMeasureCode: "EA",
        createdBy: "system"
      }),
      insert("itemReplenishment", {
        itemId: id(name),
        companyId,
        scrapPercentage: scrap,
        createdBy: "system"
      })
    ]);
  const method = (
    name: string,
    itemName: string,
    version: number,
    status: string
  ) =>
    insert("makeMethod", {
      id: id(name),
      itemId: id(itemName),
      companyId,
      version,
      status,
      createdBy: "system"
    });
  const line = (
    methodName: string,
    itemName: string,
    quantity: number,
    extra: Record<string, unknown> = {}
  ) =>
    insert("methodMaterial", {
      makeMethodId: id(methodName),
      itemId: id(itemName),
      quantity,
      unitOfMeasureCode: "EA",
      companyId,
      createdBy: "system",
      ...extra
    });
  const stock = (itemName: string, onHand: number, nonNettable = 0) =>
    insert("itemStockQuantities", {
      itemId: id(itemName),
      companyId,
      locationId,
      projectId: "",
      quantityOnHand: onHand,
      quantityNonNettable: nonNettable
    });

  /**
   * FG (Make, 10% scrap) has an Active v1 and a newer Draft v2: v1 is used.
   * v1: 1 SUB, 2 RAW, a quantity-0 line and a correction line (both ignored).
   * SUB (Make) has only a Draft method: 1 RAW. BUY (Buy) has a method of its
   * own that is never exploded. Stock: 20 RAW, 2 of them non-nettable; 1 SUB.
   */
  async function begin() {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await insert("company", {
      id: companyId,
      name: companyId,
      baseCurrencyCode: "USD"
    });
    await insert("location", {
      id: locationId,
      name: "Test",
      addressLine1: "1 Test St",
      city: "Test",
      postalCode: "00000",
      timezone: "America/New_York",
      companyId,
      createdBy: "system"
    });
    await item("FG", "Make", 0.1);
    await item("SUB", "Make");
    await item("RAW", "Buy");
    await item("BUY", "Buy");
    await item("OTHER", "Buy");
    await method("fg-v1", "FG", 1, "Active");
    await method("fg-v2", "FG", 2, "Draft");
    await method("sub-v1", "SUB", 1, "Draft");
    await method("buy-v1", "BUY", 1, "Active");
    await line("fg-v1", "SUB", 1);
    await line("fg-v1", "RAW", 2);
    await line("fg-v1", "BUY", 1);
    await line("fg-v1", "OTHER", 0);
    await line("fg-v1", "OTHER", 5, { methodCorrectionId: id("correction") });
    await line("fg-v2", "OTHER", 1);
    await line("sub-v1", "RAW", 1);
    await line("buy-v1", "OTHER", 1);
    await stock("RAW", 20, 2);
    await stock("SUB", 1);
    await stock("BUY", 100);
    await client.query("SET LOCAL session_replication_role = origin");
  }

  it("explodes the active method of each made item, with scrap and nettable stock", async () => {
    await begin();
    const result = await loadBuildable(db, {
      companyId,
      locationId,
      itemId: id("FG")
    });
    expect(result).not.toBeNull();
    // N FG builds N + ceil(0.1N): 2 RAW each, plus 1 RAW per SUB not in
    // stock. 18 nettable RAW: N = 5 builds 6, needing 12 + 5 = 17; N = 6
    // builds 7, needing 14 + 6 = 20. Nothing is committed, so on hand gives
    // the same answer.
    expect(result?.quantityBuildable).toBe(5);
    expect(result?.quantityBuildableFromOnHand).toBe(5);
    expect(result?.components.map((c) => c.readableId).sort()).toEqual([
      "BUY",
      "RAW",
      "SUB"
    ]);
    expect(
      result?.components.find((c) => c.readableId === "RAW")
    ).toMatchObject({
      quantityOnHand: 18,
      quantityAvailable: 18,
      quantityPerAssembly: 3,
      level: 2
    });
    expect(result?.unitMismatches).toEqual([]);
    expect(result?.cycleItems).toEqual([]);
  });

  it("returns null for an item that is not the company's", async () => {
    await begin();
    expect(
      await loadBuildable(db, {
        companyId: id("another-company"),
        locationId,
        itemId: id("FG")
      })
    ).toBeNull();
  });
});
