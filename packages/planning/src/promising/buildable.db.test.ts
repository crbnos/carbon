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
   * own that is never exploded. Stock: 20 RAW, 2 of them non-nettable, and
   * 100 more held by a project that keeps its own stock; 1 SUB. An open sales
   * order line commits 3 RAW and an open purchase order line brings 7.
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
    await insert("project", {
      id: id("project"),
      companyId,
      name: "Stocked project",
      projectStock: true,
      createdBy: "system"
    });
    await insert("itemStockQuantities", {
      itemId: id("RAW"),
      companyId,
      locationId,
      projectId: id("project"),
      quantityOnHand: 100,
      quantityNonNettable: 0
    });
    await insert("salesOrder", {
      id: id("so"),
      salesOrderId: "SO-TEST",
      status: "To Ship",
      currencyCode: "USD",
      customerId: id("customer"),
      locationId,
      companyId,
      createdBy: "system"
    });
    await insert("salesOrderLine", {
      salesOrderId: id("so"),
      salesOrderLineType: "Part",
      itemId: id("RAW"),
      saleQuantity: 3,
      locationId,
      companyId,
      createdBy: "system"
    });
    await insert("purchaseOrder", {
      id: id("po"),
      purchaseOrderId: "PO-TEST",
      status: "To Receive",
      supplierId: id("supplier"),
      supplierInteractionId: id("interaction"),
      companyId,
      createdBy: "system"
    });
    await insert("purchaseOrderDelivery", {
      id: id("po"),
      locationId,
      companyId
    });
    await insert("purchaseOrderLine", {
      purchaseOrderId: id("po"),
      purchaseOrderLineType: "Part",
      itemId: id("RAW"),
      purchaseQuantity: 7,
      locationId,
      companyId,
      createdBy: "system"
    });
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
    // stock. 18 nettable common RAW, 3 committed, so 15 available: N = 4
    // builds 5, needing 10 + 4 = 14; N = 5 builds 6, needing 12 + 5 = 17,
    // which the 18 on hand covers. The project's 100 count for neither.
    expect(result?.quantityBuildable).toBe(4);
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
      quantityCommitted: 3,
      quantityAvailable: 15,
      quantityOnOrder: 7,
      quantityPerAssembly: 3,
      level: 2
    });
    expect(result?.unitMismatches).toEqual([]);
    expect(result?.cycleItems).toEqual([]);
  });

  // A job for FG and what its materials still have to be issued.
  async function job(
    name: string,
    row: Record<string, unknown>,
    materials: [itemName: string, estimated: number, issued: number][]
  ) {
    await insert("job", {
      id: id(name),
      jobId: name,
      itemId: id("FG"),
      unitOfMeasureCode: "EA",
      locationId,
      companyId,
      createdBy: "system",
      ...row
    });
    await insert("jobMakeMethod", {
      id: id(`${name}-method`),
      jobId: id(name),
      itemId: id("FG"),
      companyId,
      createdBy: "system"
    });
    for (const [itemName, estimatedQuantity, quantityIssued] of materials) {
      await insert("jobMaterial", {
        jobId: id(name),
        jobMakeMethodId: id(`${name}-method`),
        itemId: id(itemName),
        description: itemName,
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA",
        estimatedQuantity,
        quantityIssued,
        companyId,
        createdBy: "system"
      });
    }
  }

  it("tells the open jobs stock can finish from the ones short of parts", async () => {
    await begin();
    await client.query("SET LOCAL session_replication_role = replica");
    // Made for the sales order, 4 good units and 1 scrap allowance, 1
    // received and 1 shipped: 2 remain. 6 RAW still to issue.
    await job(
      "WO-READY",
      {
        status: "In Progress",
        dueDate: "2026-01-01",
        salesOrderId: id("so"),
        quantity: 4,
        scrapQuantity: 1,
        quantityReceivedToInventory: 1,
        quantityShipped: 1
      },
      [["RAW", 10, 4]]
    );
    await job(
      "WO-SHORT",
      { status: "Ready", dueDate: "2026-01-02", quantity: 1 },
      [
        ["RAW", 12, 0],
        ["OTHER", 2, 0]
      ]
    );
    await job("WO-CANCELLED", { status: "Cancelled", quantity: 5 }, [
      ["RAW", 50, 0]
    ]);
    await client.query("SET LOCAL session_replication_role = origin");

    const result = await loadBuildable(db, {
      companyId,
      locationId,
      itemId: id("FG")
    });
    // 18 RAW on hand, 3 committed to the sales order: 15 for the jobs.
    // WO-READY takes 6 and leaves 9 of the 12 WO-SHORT needs. No OTHER.
    expect(result).toMatchObject({
      quantityInProduction: 3,
      quantityReadyToFinish: 2,
      quantityWaitingOnParts: 1,
      // The jobs' own 18 RAW leave nothing to start more with.
      quantityBuildable: 0,
      jobs: [
        {
          readableId: "WO-READY",
          status: "In Progress",
          quantityRemaining: 2,
          hasAllParts: true,
          shortItems: 0
        },
        {
          readableId: "WO-SHORT",
          status: "Ready",
          quantityRemaining: 1,
          hasAllParts: false,
          shortItems: 2
        }
      ],
      jobShortages: [
        {
          readableId: "RAW",
          isMade: false,
          quantityShort: 3,
          jobs: 1,
          quantityOnHand: 18,
          quantityCommitted: 21,
          quantityOnOrder: 7
        },
        { readableId: "OTHER", isMade: false, quantityShort: 2, jobs: 1 }
      ]
    });
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
