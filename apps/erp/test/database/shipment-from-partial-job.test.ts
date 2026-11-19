// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A shipment for a serial line filled from a partly built job tagged every
// serial of the job, the unbuilt ones too, so posting it refused with
// "<serial> has no stock to ship at this location". A line takes only the
// units the post accepts: Available, in common stock at the shipment's
// location, at most the quantity it ships, and ships exactly the units it
// took: the post books one ledger row per unit but cost for the quantity.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import * as inventory from "../../app/modules/inventory/inventory.server";
import { postShipment } from "../../app/modules/inventory/inventory.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

describe.skipIf(!hasLocalDatabase)("shipment from a partly built job", () => {
  let f: Fixture;
  let projectId: string;
  type Stock = "here" | "other location" | "project";
  type Unit = {
    readableId: string;
    status: "Available" | "On Hold" | "Reserved" | "Consumed";
    stock?: Stock;
    quantity?: number;
  };
  type Scenario = {
    itemId: string;
    jobId: string;
    salesOrderId: string;
    salesOrderLineId: string;
    unitIds: Record<string, string>;
  };

  // Each unit before SN-B1 (serials sort as text) fails one rule only, so
  // dropping that rule from the selection tags it instead of SN-B2.
  const units: Unit[] = [
    { readableId: "SN-A1", status: "On Hold", stock: "here" },
    { readableId: "SN-A2", status: "Available" },
    { readableId: "SN-A3", status: "Available", stock: "other location" },
    { readableId: "SN-A4", status: "Available", stock: "project" },
    { readableId: "SN-B1", status: "Available", stock: "here" },
    { readableId: "SN-B2", status: "Available", stock: "here" },
    // In stock, but the job completed only 2 to ship.
    { readableId: "SN-B3", status: "Available", stock: "here" },
    // Not built yet.
    { readableId: "SN-C1", status: "Reserved" }
  ];
  // The job completed 3, but only SN-D2 can ship: SN-D1 is On Hold and
  // SN-D3 was finished on the floor but never received.
  const shortUnits: Unit[] = [
    { readableId: "SN-D1", status: "On Hold", stock: "here" },
    { readableId: "SN-D2", status: "Available", stock: "here" },
    { readableId: "SN-D3", status: "Available" }
  ];
  // One unit in stock at each location, so the shipment tags SN-E1 at the
  // first location and SN-E2 once it moves to the other.
  const movedUnits: Unit[] = [
    { readableId: "SN-E1", status: "Available", stock: "here" },
    { readableId: "SN-E2", status: "Available", stock: "other location" }
  ];
  // The job completed 1: the shipment tags SN-F1, and SN-F2 stays free.
  const orphanUnits: Unit[] = [
    { readableId: "SN-F1", status: "Available", stock: "here" },
    { readableId: "SN-F2", status: "Available", stock: "here" }
  ];
  // One unit each, tagged by a shipment whose line or whole shipment is
  // then deleted.
  const lineDeleteUnits: Unit[] = [
    { readableId: "SN-G1", status: "Available", stock: "here" }
  ];
  const shipmentDeleteUnits: Unit[] = [
    { readableId: "SN-H1", status: "Available", stock: "here" }
  ];
  // A batch job: LOT-A1 left on an earlier shipment (Consumed, no stock),
  // LOT-B1 and LOT-B2 are in stock. A batch line's post books one lot, so the
  // line takes LOT-B1 only.
  const batchLots: Unit[] = [
    { readableId: "LOT-A1", status: "Consumed", quantity: 2 },
    { readableId: "LOT-B1", status: "Available", stock: "here", quantity: 3 },
    { readableId: "LOT-B2", status: "Available", stock: "here", quantity: 1 }
  ];
  // Finished on the shop floor but never completed into stock.
  const unreceivedUnits: Unit[] = [
    { readableId: "SN-K1", status: "Available" },
    { readableId: "SN-K2", status: "Available" }
  ];
  let main: Scenario;
  let short: Scenario;
  let mismatch: Scenario;
  let moved: Scenario;
  let orphan: Scenario;
  let lineDelete: Scenario;
  let shipmentDelete: Scenario;
  let unreceived: Scenario;
  let unreceivedMixed: Scenario;
  let batch: Scenario;
  let untrackedLineId: string;

  async function seedScenario(
    key: string,
    scenarioUnits: Unit[],
    quantityComplete: number,
    tracking: "Serial" | "Batch" = "Serial"
  ): Promise<Scenario> {
    const itemId = `${f.prefix}-${key}-item`;
    const jobId = `${f.prefix}-${key}-job`;
    const salesOrderId = `${f.prefix}-${key}-so`;
    let salesOrderLineId = "";
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: `${f.prefix}-${key}-SAT`,
          name: "Satellite",
          type: "Part",
          itemTrackingType: tracking,
          replenishmentSystem: "Make",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("salesOrder")
        .values({
          id: salesOrderId,
          salesOrderId: `SO-${f.prefix}-${key}`,
          customerId: f.customerId,
          currencyCode: "USD",
          exchangeRate: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesOrderShipment")
        .values({ id: salesOrderId, companyId: f.companyId })
        .execute();
      const line = await trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId,
          salesOrderLineType: "Part",
          itemId,
          saleQuantity: scenarioUnits.length,
          unitPrice: 25,
          methodType: "Make to Order",
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      salesOrderLineId = line.id;
      await trx
        .insertInto("job")
        .values({
          id: jobId,
          jobId: `J-${f.prefix}-${key}`,
          itemId,
          quantity: scenarioUnits.length,
          quantityComplete,
          status: "Completed",
          salesOrderId,
          salesOrderLineId: line.id,
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", jobId)
      .where("parentMaterialId", "is", null)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const unitIds = Object.fromEntries(
      scenarioUnits.map((unit, index) => [
        unit.readableId,
        `${f.prefix}-${key}-te-${index}`
      ])
    );
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values(
          scenarioUnits.map((unit) => ({
            id: unitIds[unit.readableId]!,
            readableId: unit.readableId,
            quantity: unit.quantity ?? 1,
            status: unit.status,
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            itemId,
            attributes: JSON.stringify({ "Job Make Method": makeMethod.id }),
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      const received = scenarioUnits.filter((unit) => unit.stock);
      if (received.length === 0) return;
      await trx
        .insertInto("itemLedger")
        .values(
          received.map((unit) => ({
            itemId,
            trackedEntityId: unitIds[unit.readableId],
            quantity: unit.quantity ?? 1,
            locationId:
              unit.stock === "other location"
                ? f.otherLocationId
                : f.locationId,
            projectId: unit.stock === "project" ? projectId : null,
            entryType: "Assembly Output" as const,
            documentType: "Job Receipt" as const,
            documentId: jobId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    return { itemId, jobId, salesOrderId, salesOrderLineId, unitIds };
  }

  beforeAll(async () => {
    f = await alwaysPostFixture();
    projectId = `${f.prefix}-project`;
    await seed(f, async (trx) => {
      await trx
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
        .execute();
    });
    main = await seedScenario("main", units, 2);
    short = await seedScenario("short", shortUnits, 3);
    mismatch = await seedScenario("mismatch", shortUnits, 3);
    moved = await seedScenario("moved", movedUnits, 2);
    orphan = await seedScenario("orphan", orphanUnits, 1);
    lineDelete = await seedScenario("line-delete", lineDeleteUnits, 1);
    shipmentDelete = await seedScenario(
      "shipment-delete",
      shipmentDeleteUnits,
      1
    );
    unreceived = await seedScenario("unreceived", unreceivedUnits, 2);
    unreceivedMixed = await seedScenario("unreceived-mixed", unreceivedUnits, 2);
    batch = await seedScenario("batch", batchLots, 3, "Batch");
    // The mixed order also ships an untracked part from stock.
    await seed(f, async (trx) => {
      const itemId = `${f.prefix}-untracked-item`;
      await trx
        .insertInto("item")
        .values({
          id: itemId,
          readableId: `${f.prefix}-BOLT`,
          name: "Bolt",
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      const line = await trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId: unreceivedMixed.salesOrderId,
          salesOrderLineType: "Part",
          itemId,
          saleQuantity: 5,
          unitPrice: 1,
          methodType: "Pull from Inventory",
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      untrackedLineId = line.id;
    });
  });

  async function unit(scenario: Scenario, readableId: string) {
    const id = scenario.unitIds[readableId]!;
    const [entity, stock] = await Promise.all([
      f.db
        .selectFrom("trackedEntity")
        .select(["status", sql<boolean>`attributes ? 'Shipment'`.as("tagged")])
        .where("id", "=", id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow(),
      f.db
        .selectFrom("itemLedger")
        .select(sql<string>`COALESCE(SUM(quantity), 0)`.as("onHand"))
        .where("trackedEntityId", "=", id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow()
    ]);
    return { ...entity, onHand: Number(stock.onHand) };
  }

  async function taggedOn(shipmentId: string) {
    const line = await f.db
      .selectFrom("shipmentLine")
      .select(["id", "shippedQuantity"])
      .where("shipmentId", "=", shipmentId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const tagged = await f.db
      .selectFrom("trackedEntity")
      .select([
        "readableId",
        sql<string>`attributes->>'Shipment Line Index'`.as("index")
      ])
      .where("companyId", "=", f.companyId)
      .where(sql`attributes->>'Shipment Line'`, "=", line.id)
      .orderBy("readableId")
      .execute();
    return { shippedQuantity: Number(line.shippedQuantity), tagged };
  }

  async function shippedOut(shipmentId: string) {
    return f.db
      .selectFrom("itemLedger as il")
      .innerJoin("trackedEntity as te", (join) =>
        join
          .onRef("te.id", "=", "il.trackedEntityId")
          .onRef("te.companyId", "=", "il.companyId")
      )
      .select(["te.readableId", "il.quantity", "te.status"])
      .where("il.companyId", "=", f.companyId)
      .where("il.documentId", "=", shipmentId)
      .where("il.documentType", "=", "Sales Shipment")
      .orderBy("te.readableId")
      .execute()
      .then((rows) =>
        rows.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      );
  }

  async function quantityShipped(jobId: string) {
    const job = await f.db
      .selectFrom("job")
      .select("quantityShipped")
      .where("id", "=", jobId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    return Number(job.quantityShipped);
  }

  const shippable = [
    { readableId: "SN-B1", index: "0" },
    { readableId: "SN-B2", index: "1" }
  ];

  afterAll(async () => {
    await f?.cleanup();
  });

  // Runs first: it does not post, so the job still has 2 to ship below.
  databaseTest(
    "a shipment from the sales order line tags only the serials it can post",
    async () => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: main.salesOrderLineId,
          locationId: f.locationId
        })
      );
      expect(await taggedOn(shipment.id)).toEqual({
        shippedQuantity: 2,
        tagged: shippable
      });
    }
  );

  databaseTest(
    "a batch line tags one lot it can post, never one an earlier shipment took",
    async () => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: batch.salesOrderLineId,
          locationId: f.locationId
        })
      );
      expect(await taggedOn(shipment.id)).toEqual({
        shippedQuantity: 3,
        tagged: [{ readableId: "LOT-B1", index: "0" }]
      });
    }
  );

  databaseTest(
    "a shipment from the sales order tags only the serials it can post, and posts",
    async () => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrder",
          salesOrderId: main.salesOrderId,
          locationId: f.locationId
        })
      );
      expect(await taggedOn(shipment.id)).toEqual({
        shippedQuantity: 2,
        tagged: shippable
      });

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: shipment.id },
          postShipment
        )
      );
      expect(await shippedOut(shipment.id)).toEqual([
        { readableId: "SN-B1", quantity: -1, status: "Consumed" },
        { readableId: "SN-B2", quantity: -1, status: "Consumed" }
      ]);
      expect(await quantityShipped(main.jobId)).toBe(2);
    }
  );

  databaseTest(
    "a serial line ships the units it tagged when fewer can ship than the job completed",
    async () => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrder",
          salesOrderId: short.salesOrderId,
          locationId: f.locationId
        })
      );
      expect(await taggedOn(shipment.id)).toEqual({
        shippedQuantity: 1,
        tagged: [{ readableId: "SN-D2", index: "0" }]
      });

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: shipment.id },
          postShipment
        )
      );
      expect(await shippedOut(shipment.id)).toEqual([
        { readableId: "SN-D2", quantity: -1, status: "Consumed" }
      ]);
      expect(await quantityShipped(short.jobId)).toBe(1);
    }
  );

  databaseTest(
    "a shipment moved to another location leaves the units it tagged at the first location in stock",
    async () => {
      const created = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: moved.salesOrderLineId,
          locationId: f.locationId
        })
      );
      expect(await taggedOn(created.id)).toEqual({
        shippedQuantity: 1,
        tagged: [{ readableId: "SN-E1", index: "0" }]
      });

      // The order line now ships from the other location, and the Draft is
      // moved there, which rebuilds its lines.
      await f.db
        .updateTable("salesOrderLine")
        .set({ locationId: f.otherLocationId })
        .where("id", "=", moved.salesOrderLineId)
        .where("companyId", "=", f.companyId)
        .execute();
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: moved.salesOrderLineId,
          locationId: f.otherLocationId,
          shipmentId: created.id
        })
      );
      expect(await taggedOn(shipment.id)).toEqual({
        shippedQuantity: 1,
        tagged: [{ readableId: "SN-E2", index: "0" }]
      });
      // The rebuild cleared the old line's tag, not only the post below.
      expect(await unit(moved, "SN-E1")).toMatchObject({ tagged: false });

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: shipment.id },
          postShipment
        )
      );
      expect(await shippedOut(shipment.id)).toEqual([
        { readableId: "SN-E2", quantity: -1, status: "Consumed" }
      ]);
      expect(await unit(moved, "SN-E1")).toEqual({
        status: "Available",
        tagged: false,
        onHand: 1
      });
    }
  );

  databaseTest(
    "posting ignores and clears a unit tagged to a line the shipment no longer has",
    async () => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: orphan.salesOrderLineId,
          locationId: f.locationId
        })
      );
      // A tag left by a line deleted before deletes cleared them.
      await f.db
        .updateTable("trackedEntity")
        .set({
          attributes: sql`attributes || jsonb_build_object('Shipment', ${shipment.id}::text, 'Shipment Line', 'deleted-line', 'Shipment Line Index', 0)`
        })
        .where("id", "=", orphan.unitIds["SN-F2"]!)
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: shipment.id },
          postShipment
        )
      );
      expect(await shippedOut(shipment.id)).toEqual([
        { readableId: "SN-F1", quantity: -1, status: "Consumed" }
      ]);
      expect(await unit(orphan, "SN-F2")).toEqual({
        status: "Available",
        tagged: false,
        onHand: 1
      });
    }
  );

  postgrestTest(
    "the post operation refuses a serial line raised above its tagged serials before setting it Pending",
    async (client) => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: mismatch.salesOrderLineId,
          locationId: f.locationId
        })
      );
      const line = await f.db
        .selectFrom("shipmentLine")
        .select("id")
        .where("shipmentId", "=", shipment.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();

      const ctx = operationContext(client);
      const raised = await inventory.updateShipmentLines(ctx, {
        ids: [line.id],
        field: "shippedQuantity",
        value: "3"
      });
      expect(raised.error).toBeNull();

      const result = await inventory.postShipment(ctx, {
        shipmentId: shipment.id,
        acknowledged: true
      });
      expect(result.error?.category).toBe("rule");
      const header = await f.db
        .selectFrom("shipment")
        .select(["status", "updatedAt"])
        .where("id", "=", shipment.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({ status: "Draft", updatedAt: null });
      expect(await shippedOut(shipment.id)).toEqual([]);
      expect(await quantityShipped(mismatch.jobId)).toBe(0);
    }
  );

  postgrestTest(
    "deleting a shipment line clears its units' tags",
    async (client) => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: lineDelete.salesOrderLineId,
          locationId: f.locationId
        })
      );
      const line = await f.db
        .selectFrom("shipmentLine")
        .select("id")
        .where("shipmentId", "=", shipment.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(await unit(lineDelete, "SN-G1")).toMatchObject({ tagged: true });

      const deleted = await inventory.deleteShipmentLine(
        operationContext(client),
        { shipmentLineId: line.id }
      );
      expect(deleted.error).toBeNull();
      expect(await unit(lineDelete, "SN-G1")).toMatchObject({ tagged: false });
    }
  );

  postgrestTest(
    "deleting a shipment clears its units' tags",
    async (client) => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrderLine",
          salesOrderLineId: shipmentDelete.salesOrderLineId,
          locationId: f.locationId
        })
      );
      expect(await unit(shipmentDelete, "SN-H1")).toMatchObject({
        tagged: true
      });

      const deleted = await inventory.deleteShipment(operationContext(client), {
        shipmentId: shipment.id
      });
      expect(deleted.error).toBeNull();
      expect(await unit(shipmentDelete, "SN-H1")).toMatchObject({
        tagged: false
      });
    }
  );

  async function shipmentsFor(salesOrderId: string) {
    return f.db
      .selectFrom("shipment")
      .select("id")
      .where("sourceDocumentId", "=", salesOrderId)
      .where("companyId", "=", f.companyId)
      .execute();
  }

  databaseTest(
    "a sales order whose only line has no units in stock is refused, and no empty shipment is left",
    async () => {
      const result = await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromSalesOrder",
        salesOrderId: unreceived.salesOrderId,
        locationId: f.locationId
      });
      expect(result.data).toBeNull();
      expect(result.error?.status).toBe(400);
      expect(result.error?.message).toContain(`${f.prefix}-unreceived-SAT`);
      expect(result.error?.message).toContain("Headquarters");
      expect(await shipmentsFor(unreceived.salesOrderId)).toEqual([]);
    }
  );

  databaseTest(
    "a sales order line with no units in stock is refused, and no empty shipment is left",
    async () => {
      const result = await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromSalesOrderLine",
        salesOrderLineId: unreceived.salesOrderLineId,
        locationId: f.locationId
      });
      expect(result.data).toBeNull();
      expect(result.error?.status).toBe(400);
      expect(result.error?.message).toContain(`${f.prefix}-unreceived-SAT`);
      expect(await shipmentsFor(unreceived.salesOrderId)).toEqual([]);
    }
  );

  databaseTest(
    "rebuilding a Draft from a sales order with nothing to ship is refused and keeps the Draft as it was",
    async () => {
      const draft = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentDefault",
          locationId: f.locationId
        })
      );
      const result = await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromSalesOrder",
        salesOrderId: unreceived.salesOrderId,
        locationId: f.locationId,
        shipmentId: draft.id
      });
      expect(result.error?.status).toBe(400);
      const header = await f.db
        .selectFrom("shipment")
        .select(["status", "sourceDocumentId"])
        .where("id", "=", draft.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({ status: "Draft", sourceDocumentId: null });
    }
  );

  databaseTest(
    "a sales order with other lines creates the shipment without the line and warns why",
    async () => {
      const shipment = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "shipmentFromSalesOrder",
          salesOrderId: unreceivedMixed.salesOrderId,
          locationId: f.locationId
        })
      );
      const lines = await f.db
        .selectFrom("shipmentLine")
        .select("lineId")
        .where("shipmentId", "=", shipment.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(lines).toEqual([{ lineId: untrackedLineId }]);
      expect(shipment.warnings).toHaveLength(1);
      expect(shipment.warnings?.[0]).toContain(
        `${f.prefix}-unreceived-mixed-SAT`
      );
    }
  );

  // The system on behalf of the seeded user, over the local PostgREST: the
  // operation's own checks are what refuse.
  function operationContext(client: SupabaseClient<Database>) {
    return createServiceContext({
      actor: { type: "system", onBehalfOf: USER },
      company: { id: f.companyId, groupId: f.groupId },
      caller: client,
      system: () => client,
      pg: () => f.db,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    });
  }
});
