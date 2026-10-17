// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Each published operation must refuse what its
// route refuses: an API or MCP caller reaches the function, not the route.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import * as inventory from "../../app/modules/inventory/inventory.server";
import * as items from "../../app/modules/items/items.server";
import { LOCKED_REVISION_MESSAGE } from "../../app/modules/items/items.service";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `sfguard-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  company: `${prefix}-company`,
  group: `${prefix}-group`,
  plant: `${prefix}-plant`,
  warehouse: `${prefix}-warehouse`,
  released: `${prefix}-released`,
  serial: `${prefix}-serial`,
  doneNotice: `${prefix}-co-done`,
  postedReceipt: `${prefix}-receipt`,
  postedShipment: `${prefix}-shipment`,
  shippingTransfer: `${prefix}-wt-ship`,
  draftTransfer: `${prefix}-wt-draft`,
  releasedStockTransfer: `${prefix}-st-released`,
  draftStockTransfer: `${prefix}-st-draft`,
  draftStockTransferLine: `${prefix}-stl-draft`,
  postedCount: `${prefix}-count`
};

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;
let releasedMethodId = "";

// The system, on behalf of the seeded system user: the permission gate passes,
// so what refuses is the operation's own check.
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

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  const createdBy = "system";
  const companyId = ids.company;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: ids.group, name: prefix, createdBy })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: ids.group,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    const location = (id: string, name: string) => ({
      id,
      name,
      addressLine1: "1 Test Way",
      city: "Testville",
      postalCode: "00000",
      timezone: "America/New_York",
      companyId,
      createdBy
    });
    await trx
      .insertInto("location")
      .values([
        location(ids.plant, "Plant"),
        location(ids.warehouse, "Warehouse")
      ])
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy })
      .execute();
    await trx
      .insertInto("item")
      .values([
        {
          id: ids.released,
          readableId: `${prefix}-RELEASED`,
          name: "Released assembly",
          type: "Part",
          itemTrackingType: "Inventory",
          revisionStatus: "Production",
          unitOfMeasureCode: "EA",
          companyId,
          createdBy
        },
        {
          id: ids.serial,
          readableId: `${prefix}-SERIAL`,
          name: "Serial part",
          type: "Part",
          itemTrackingType: "Serial",
          unitOfMeasureCode: "EA",
          companyId,
          createdBy
        }
      ])
      .execute();
    // The item's insert trigger creates its make method.
    const method = await trx
      .updateTable("makeMethod")
      .set({ status: "Active" })
      .where("itemId", "=", ids.released)
      .where("companyId", "=", companyId)
      .returning("id")
      .executeTakeFirstOrThrow();
    releasedMethodId = method.id;
    await trx
      .insertInto("changeOrder")
      .values({
        id: ids.doneNotice,
        changeOrderId: `${prefix}-CO`,
        name: "Released notice",
        status: "Done",
        openDate: "2026-01-01",
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("receipt")
      .values({
        id: ids.postedReceipt,
        receiptId: `${prefix}-RE`,
        status: "Posted",
        postingDate: "2026-01-02",
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("shipment")
      .values({
        id: ids.postedShipment,
        shipmentId: `${prefix}-SH`,
        status: "Posted",
        postingDate: "2026-01-02",
        companyId,
        createdBy
      })
      .execute();
    const transfer = (id: string, status: "Draft" | "To Ship") => ({
      id,
      transferId: id,
      fromLocationId: ids.plant,
      toLocationId: ids.warehouse,
      status,
      companyId,
      createdBy
    });
    await trx
      .insertInto("warehouseTransfer")
      .values([
        transfer(ids.shippingTransfer, "To Ship"),
        transfer(ids.draftTransfer, "Draft")
      ])
      .execute();
    await trx
      .insertInto("stockTransfer")
      .values([
        {
          id: ids.releasedStockTransfer,
          stockTransferId: ids.releasedStockTransfer,
          locationId: ids.plant,
          status: "Released",
          companyId,
          createdBy
        },
        {
          id: ids.draftStockTransfer,
          stockTransferId: ids.draftStockTransfer,
          locationId: ids.plant,
          status: "Draft",
          companyId,
          createdBy
        }
      ])
      .execute();
    await trx
      .insertInto("stockTransferLine")
      .values({
        id: ids.draftStockTransferLine,
        stockTransferId: ids.draftStockTransfer,
        itemId: ids.serial,
        quantity: 1,
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("inventoryCount")
      .values({
        id: ids.postedCount,
        inventoryCountId: `${prefix}-IC`,
        locationId: ids.plant,
        status: "Posted",
        companyId,
        createdBy
      })
      .execute();
  });
});

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx.deleteFrom("company").where("id", "=", ids.company).execute();
    await trx.deleteFrom("companyGroup").where("id", "=", ids.group).execute();
    await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${ids.company}`)}`.execute(
      trx
    );
    await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${ids.company}`)}`.execute(
      trx
    );
  });
  await db.destroy();
}, 60_000);

const count = async (
  table: "methodMaterial" | "changeOrderAffectedItem" | "stockTransferLine",
  column: "makeMethodId" | "changeOrderId" | "stockTransferId",
  value: string
) => {
  const row = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM ${sql.id(table)} WHERE ${sql.id(column)} = ${value}`.execute(
    db
  );
  return row.rows[0]?.n;
};

describeLocal("published operations hold their routes' checks", () => {
  it("refuses a material write on a released method", async () => {
    const result = await items.createMethodMaterial(ctx(), {
      id: `${prefix}-mm-line`,
      makeMethodId: releasedMethodId,
      order: 1,
      itemType: "Part",
      methodType: "Pull from Inventory",
      sourcingType: "Specified",
      itemId: ids.serial,
      quantity: 1,
      unitOfMeasureCode: "EA"
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message: LOCKED_REVISION_MESSAGE
    });
    expect(await count("methodMaterial", "makeMethodId", releasedMethodId)).toBe(
      0
    );
  });

  it("refuses an affected item on a Done change notice", async () => {
    const result = await items.addChangeNoticeAffectedItem(ctx(), {
      changeNoticeId: ids.doneNotice,
      itemId: ids.released,
      changeType: "Version"
    });

    expect(result.error?.category).toBe("rule");
    expect(
      await count("changeOrderAffectedItem", "changeOrderId", ids.doneNotice)
    ).toBe(0);
  });

  it("creates a warehouse transfer as Draft whatever status is sent", async () => {
    const result = await inventory.insertWarehouseTransfer(ctx(), {
      fromLocationId: ids.plant,
      toLocationId: ids.warehouse,
      transferId: `${prefix}-wt-new`,
      status: "Completed"
    } as never);

    expect(result.error).toBeNull();
    const created = await db
      .selectFrom("warehouseTransfer")
      .select("status")
      .where("transferId", "=", `${prefix}-wt-new`)
      .where("companyId", "=", ids.company)
      .executeTakeFirstOrThrow();
    expect(created.status).toBe("Draft");
  });

  it("refuses to edit a warehouse transfer that is not Draft", async () => {
    const result = await inventory.updateWarehouseTransfer(ctx(), {
      id: ids.shippingTransfer,
      notes: "changed"
    });

    expect(result.error?.category).toBe("rule");
  });

  it("never moves a Draft warehouse transfer's status through an edit", async () => {
    const result = await inventory.updateWarehouseTransfer(ctx(), {
      id: ids.draftTransfer,
      reference: "REF-1",
      status: "Completed"
    } as never);

    expect(result.error).toBeNull();
    const transfer = await db
      .selectFrom("warehouseTransfer")
      .select(["status", "reference"])
      .where("id", "=", ids.draftTransfer)
      .executeTakeFirstOrThrow();
    expect(transfer).toEqual({ status: "Draft", reference: "REF-1" });
  });

  it("posts a count only through postInventoryCount", async () => {
    const posted = await inventory.updateInventoryCountStatus(ctx(), {
      id: ids.postedCount,
      status: "Posted"
    } as never);
    const reopened = await inventory.updateInventoryCountStatus(ctx(), {
      id: ids.postedCount,
      status: "Draft"
    });

    expect(posted.error?.category).toBe("validation");
    expect(reopened.error).toMatchObject({
      category: "rule",
      message: "Only a pending count can be reopened"
    });
    const row = await db
      .selectFrom("inventoryCount")
      .select("status")
      .where("id", "=", ids.postedCount)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("Posted");
  });

  it("refuses a line on a stock transfer that is not Draft", async () => {
    const result = await inventory.createStockTransferLine(ctx(), {
      stockTransferId: ids.releasedStockTransfer,
      itemId: ids.serial,
      quantity: 1,
      requiresBatchTracking: "false",
      requiresSerialTracking: "true"
    });

    expect(result.error?.category).toBe("rule");
    expect(
      await count(
        "stockTransferLine",
        "stockTransferId",
        ids.releasedStockTransfer
      )
    ).toBe(0);
  });

  it("never marks a stock transfer line picked through an edit", async () => {
    const result = await inventory.updateStockTransferLine(ctx(), {
      id: ids.draftStockTransferLine,
      stockTransferId: ids.draftStockTransfer,
      itemId: ids.serial,
      quantity: 1,
      pickedQuantity: 1,
      requiresBatchTracking: "false",
      requiresSerialTracking: "true"
    } as never);

    expect(result.error).toBeNull();
    const line = await db
      .selectFrom("stockTransferLine")
      .select("pickedQuantity")
      .where("id", "=", ids.draftStockTransferLine)
      .executeTakeFirstOrThrow();
    expect(Number(line.pickedQuantity)).toBe(0);
  });

  it("refuses to delete a posted receipt or shipment", async () => {
    const receipt = await inventory.deleteReceipt(ctx(), {
      receiptId: ids.postedReceipt
    });
    const shipment = await inventory.deleteShipment(ctx(), {
      shipmentId: ids.postedShipment
    });

    expect(receipt.error).toMatchObject({
      category: "rule",
      message: "Cannot delete a posted receipt"
    });
    expect(shipment.error).toMatchObject({
      category: "rule",
      message: "Cannot delete a posted shipment"
    });
    const left = await sql<{ n: number }>`
      SELECT (SELECT count(*) FROM receipt WHERE id = ${ids.postedReceipt})
           + (SELECT count(*) FROM shipment WHERE id = ${ids.postedShipment}) AS n`.execute(
      db
    );
    expect(Number(left.rows[0]?.n)).toBe(2);
  });

  it("caps a serial item's adjustment at one unit, from the item itself", async () => {
    const result = await inventory.adjustInventory(ctx(), {
      itemId: ids.serial,
      adjustmentType: "Positive Adjmt.",
      quantity: 2,
      locationId: ids.plant
    });

    expect(result.error).toMatchObject({
      category: "validation",
      message: "Serial items can only have a quantity of 1"
    });
  });
});
