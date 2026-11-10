// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. A published inventory operation is reached by
// the API and MCP too: it must leave a posted document alone, book as its
// caller, and see only the caller's active company.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as inventory from "../../app/modules/inventory/inventory.server";
import {
  alwaysPostFixture,
  type Fixture,
  receiveFromPurchaseOrder,
  seed,
  shipSalesOrder,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

let f: Fixture;
let ids: ReturnType<typeof idsOf>;
let postedReceipt: { id: string; receiptId: string; lineIds: string[] };
let postedShipment: { id: string; shipmentId: string; lineIds: string[] };

const idsOf = (prefix: string) => ({
  batchItem: `${prefix}-batch-item`,
  draftReceipt: `${prefix}-receipt-draft`,
  draftReceiptLine: `${prefix}-receipt-draft-line`,
  otherLot: `${prefix}-lot-other`,
  postedCount: `${prefix}-count-posted`,
  pendingCount: `${prefix}-count-pending`,
  pendingCountLine: `${prefix}-count-pending-line`,
  draftCount: `${prefix}-count-draft`,
  draftCountLine: `${prefix}-count-draft-line`,
  otherCompany: `${prefix}-other-company`,
  otherGroup: `${prefix}-other-group`,
  otherLocation: `${prefix}-other-location`,
  otherReceipt: `${prefix}-other-receipt`,
  otherUnit: `${prefix}-other-unit`,
  otherLotOfOtherCompany: `${prefix}-other-company-lot`
});

// The system, on behalf of the seeded system user: the permission gate passes,
// so what refuses is the operation's own check.
const ctx = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

beforeAll(async () => {
  if (!client) return;
  f = await alwaysPostFixture();
  ids = idsOf(f.prefix);

  // A posted purchase order receipt (10 parts) and a posted sales order
  // shipment (4 of them), through the postings themselves.
  const receiptId = await receiveFromPurchaseOrder(f);
  const shipmentId = await shipSalesOrder(f);
  const [receipt, receiptLines, shipment, shipmentLines] = await Promise.all([
    f.db
      .selectFrom("receipt")
      .select(["id", "receiptId"])
      .where("id", "=", receiptId)
      .executeTakeFirstOrThrow(),
    f.db
      .selectFrom("receiptLine")
      .select("id")
      .where("receiptId", "=", receiptId)
      .execute(),
    f.db
      .selectFrom("shipment")
      .select(["id", "shipmentId"])
      .where("id", "=", shipmentId)
      .executeTakeFirstOrThrow(),
    f.db
      .selectFrom("shipmentLine")
      .select("id")
      .where("shipmentId", "=", shipmentId)
      .execute()
  ]);
  postedReceipt = { ...receipt, lineIds: receiptLines.map((l) => l.id) };
  postedShipment = { ...shipment, lineIds: shipmentLines.map((l) => l.id) };
  expect(postedReceipt.lineIds.length).toBeGreaterThan(0);
  expect(postedShipment.lineIds.length).toBeGreaterThan(0);

  const companyId = f.companyId;
  const createdBy = USER;
  await seed(f, async (trx) => {
    await trx
      .insertInto("item")
      .values({
        id: ids.batchItem,
        readableId: `${f.prefix}-BATCH`,
        name: "Resin",
        type: "Part",
        itemTrackingType: "Batch",
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("receipt")
      .values({
        id: ids.draftReceipt,
        receiptId: `${f.prefix}-RE-DRAFT`,
        status: "Draft",
        locationId: f.locationId,
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("receiptLine")
      .values({
        id: ids.draftReceiptLine,
        receiptId: ids.draftReceipt,
        itemId: ids.batchItem,
        orderQuantity: 5,
        receivedQuantity: 5,
        unitOfMeasure: "EA",
        unitPrice: 0,
        requiresBatchTracking: true,
        locationId: f.locationId,
        companyId,
        createdBy
      })
      .execute();
    // A live lot of the same item that no receipt line holds.
    await trx
      .insertInto("trackedEntity")
      .values({
        id: ids.otherLot,
        readableId: "LOT-ON-THE-SHELF",
        quantity: 7,
        status: "Available",
        sourceDocument: "Item",
        sourceDocumentId: ids.batchItem,
        itemId: ids.batchItem,
        attributes: {},
        companyId,
        createdBy
      })
      .execute();
    const count = (id: string, status: "Draft" | "Pending" | "Posted") => ({
      id,
      inventoryCountId: id,
      locationId: f.locationId,
      status,
      companyId,
      createdBy
    });
    await trx
      .insertInto("inventoryCount")
      .values([
        count(ids.postedCount, "Posted"),
        count(ids.pendingCount, "Pending"),
        count(ids.draftCount, "Draft")
      ])
      .execute();
    await trx
      .insertInto("inventoryCountLine")
      .values([
        {
          id: ids.pendingCountLine,
          inventoryCountId: ids.pendingCount,
          itemId: f.partId,
          companyId,
          createdBy
        },
        {
          id: ids.draftCountLine,
          inventoryCountId: ids.draftCount,
          itemId: f.partId,
          companyId,
          createdBy
        }
      ])
      .execute();

    // A second company the same user could belong to.
    await trx
      .insertInto("companyGroup")
      .values({ id: ids.otherGroup, name: ids.otherGroup, createdBy })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: ids.otherCompany,
        name: ids.otherCompany,
        companyGroupId: ids.otherGroup,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: ids.otherLocation,
        name: "Elsewhere",
        addressLine1: "3 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId: ids.otherCompany,
        createdBy
      })
      .execute();
    await trx
      .insertInto("receipt")
      .values({
        id: ids.otherReceipt,
        receiptId: `${f.prefix}-RE-OTHER`,
        companyId: ids.otherCompany,
        createdBy
      })
      .execute();
    await trx
      .insertInto("storageUnit")
      .values({
        id: ids.otherUnit,
        name: "Other bin",
        locationId: ids.otherLocation,
        companyId: ids.otherCompany,
        createdBy
      })
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values({
        id: ids.otherLotOfOtherCompany,
        quantity: 1,
        status: "Available",
        sourceDocument: "Item",
        sourceDocumentId: "elsewhere",
        expirationDate: "2030-01-01",
        companyId: ids.otherCompany,
        createdBy
      })
      .execute();
  });
}, 120_000);

afterAll(async () => {
  if (!client) return;
  await seed(f, async (trx) => {
    await trx
      .deleteFrom("company")
      .where("id", "=", ids.otherCompany)
      .execute();
    await trx
      .deleteFrom("companyGroup")
      .where("id", "=", ids.otherGroup)
      .execute();
    await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${ids.otherCompany}`)}`.execute(
      trx
    );
    await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${ids.otherCompany}`)}`.execute(
      trx
    );
  });
  await f.cleanup();
}, 60_000);

const receiptLineIds = (receiptId: string) =>
  f.db
    .selectFrom("receiptLine")
    .select(["id", "receivedQuantity"])
    .where("receiptId", "=", receiptId)
    .orderBy("id")
    .execute();

const shipmentLineIds = (shipmentId: string) =>
  f.db
    .selectFrom("shipmentLine")
    .select(["id", "shippedQuantity"])
    .where("shipmentId", "=", shipmentId)
    .orderBy("id")
    .execute();

describeLocal("a posted receipt or shipment is a record", () => {
  it("refuses to rebuild a posted receipt's lines for another location", async () => {
    const before = await receiptLineIds(postedReceipt.id);

    const result = await inventory.updateReceipt(ctx(), {
      id: postedReceipt.id,
      receiptId: postedReceipt.receiptId,
      sourceDocument: "Purchase Order",
      sourceDocumentId: `${f.prefix}-po-1`,
      locationId: f.otherLocationId
    });

    expect(result.error?.category).toBe("rule");
    expect(await receiptLineIds(postedReceipt.id)).toEqual(before);
  });

  it("refuses to rebuild a posted shipment's lines for another location", async () => {
    const before = await shipmentLineIds(postedShipment.id);

    const result = await inventory.updateShipment(ctx(), {
      id: postedShipment.id,
      shipmentId: postedShipment.shipmentId,
      sourceDocument: "Sales Order",
      sourceDocumentId: `${f.prefix}-so-1`,
      locationId: f.otherLocationId
    });

    expect(result.error?.category).toBe("rule");
    expect(await shipmentLineIds(postedShipment.id)).toEqual(before);
  });

  it("refuses to edit, split or delete a posted receipt's lines", async () => {
    const before = await receiptLineIds(postedReceipt.id);
    const lineId = postedReceipt.lineIds[0]!;

    const updated = await inventory.updateReceiptLines(ctx(), {
      ids: [lineId],
      field: "receivedQuantity",
      value: "1"
    });
    const split = await inventory.splitReceiptLine(ctx(), {
      receiptId: postedReceipt.id,
      receiptLineId: lineId,
      locationId: f.locationId,
      quantity: 1
    });
    const deleted = await inventory.deleteReceiptLine(ctx(), {
      receiptLineId: lineId
    });

    for (const result of [updated, split, deleted]) {
      expect(result.error).toMatchObject({
        category: "rule",
        message: "A posted receipt can no longer be changed"
      });
    }
    expect(await receiptLineIds(postedReceipt.id)).toEqual(before);
  });

  it("refuses to edit, split or delete a posted shipment's lines", async () => {
    const before = await shipmentLineIds(postedShipment.id);
    const lineId = postedShipment.lineIds[0]!;

    const updated = await inventory.updateShipmentLines(ctx(), {
      ids: [lineId],
      field: "shippedQuantity",
      value: "1"
    });
    const split = await inventory.splitShipmentLine(ctx(), {
      shipmentId: postedShipment.id,
      shipmentLineId: lineId,
      locationId: f.locationId,
      quantity: 1
    });
    const deleted = await inventory.deleteShipmentLine(ctx(), {
      shipmentLineId: lineId
    });

    for (const result of [updated, split, deleted]) {
      expect(result.error).toMatchObject({
        category: "rule",
        message: "A posted shipment can no longer be changed"
      });
    }
    expect(await shipmentLineIds(postedShipment.id)).toEqual(before);
  });

  it("names an already posted receipt, and leaves it Posted", async () => {
    const result = await inventory.postReceipt(ctx(), {
      receiptId: postedReceipt.id
    });

    expect(result.error).toMatchObject({
      category: "conflict",
      message: "This receipt has already been posted"
    });
    const receipt = await f.db
      .selectFrom("receipt")
      .select("status")
      .where("id", "=", postedReceipt.id)
      .executeTakeFirstOrThrow();
    expect(receipt.status).toBe("Posted");
  });

  it("refuses a batch number on a posted receipt", async () => {
    const result = await inventory.setReceiptLineBatch(ctx(), {
      receiptId: postedReceipt.id,
      receiptLineId: postedReceipt.lineIds[0]!,
      batchNumber: "LATE",
      quantity: 1
    });

    expect(result.error?.category).toBe("rule");
  });
});

describeLocal("a receipt line's batch", () => {
  const lot = () =>
    f.db
      .selectFrom("trackedEntity")
      .select(["quantity", "status", "readableId", "attributes"])
      .where("id", "=", ids.otherLot)
      .executeTakeFirstOrThrow();

  it("is never another lot of the item", async () => {
    const before = await lot();

    const result = await inventory.setReceiptLineBatch(ctx(), {
      receiptId: ids.draftReceipt,
      receiptLineId: ids.draftReceiptLine,
      batchNumber: "B-1",
      quantity: 5,
      trackedEntityId: ids.otherLot
    });

    expect(result.error?.category).toBe("validation");
    expect(await lot()).toEqual(before);
  });

  it("is created, then renamed, through the line itself", async () => {
    const created = await inventory.setReceiptLineBatch(ctx(), {
      receiptId: ids.draftReceipt,
      receiptLineId: ids.draftReceiptLine,
      batchNumber: "B-1",
      quantity: 5
    });
    expect(created.error).toBeNull();
    const batch = await f.db
      .selectFrom("trackedEntity")
      .select("id")
      .where(sql`attributes->>'Receipt Line'`, "=", ids.draftReceiptLine)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();

    const renamed = await inventory.setReceiptLineBatch(ctx(), {
      receiptId: ids.draftReceipt,
      receiptLineId: ids.draftReceiptLine,
      batchNumber: "B-2",
      quantity: 5,
      trackedEntityId: batch.id
    });

    expect(renamed.error).toBeNull();
    const after = await f.db
      .selectFrom("trackedEntity")
      .select("readableId")
      .where("id", "=", batch.id)
      .executeTakeFirstOrThrow();
    expect(after.readableId).toBe("B-2");
  });
});

describeLocal("inventory counts", () => {
  it("refuses to delete a posted count", async () => {
    const result = await inventory.deleteInventoryCount(ctx(), {
      id: ids.postedCount
    });

    expect(result.error?.category).toBe("rule");
    const count = await f.db
      .selectFrom("inventoryCount")
      .select("id")
      .where("id", "=", ids.postedCount)
      .executeTakeFirst();
    expect(count).toBeDefined();
  });

  it("refuses a count on a count that is not Draft", async () => {
    const result = await inventory.updateInventoryCountLine(ctx(), {
      id: ids.pendingCountLine,
      countedQuantity: 3
    });

    expect(result.error?.category).toBe("conflict");
  });

  it("records the caller as the counter, whatever the input names", async () => {
    const result = await inventory.updateInventoryCountLine(ctx(), {
      id: ids.draftCountLine,
      countedQuantity: 3,
      countedBy: `${f.prefix}-someone-else`
    } as never);

    expect(result.error).toBeNull();
    const line = await f.db
      .selectFrom("inventoryCountLine")
      .select(["countedQuantity", "countedBy", "updatedBy"])
      .where("id", "=", ids.draftCountLine)
      .executeTakeFirstOrThrow();
    expect(line).toEqual({
      countedQuantity: 3,
      countedBy: USER,
      updatedBy: USER
    });
  });
});

describeLocal("a stock correction", () => {
  it("is booked as the caller", async () => {
    const movement = await f.db
      .selectFrom("itemLedger")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("itemId", "=", f.partId)
      .where("documentType", "=", "Purchase Receipt")
      .executeTakeFirstOrThrow();

    const result = await inventory.correctStockMovement(ctx(), {
      itemLedgerId: movement.id,
      correctedQuantity: 9
    });

    expect(result.error).toBeNull();
    const correction = await f.db
      .selectFrom("itemLedger")
      .select("createdBy")
      .where("correctionOfItemLedgerId", "=", movement.id)
      .executeTakeFirstOrThrow();
    expect(correction.createdBy).toBe(USER);
  });
});

describeLocal("another company's records", () => {
  it("read as missing", async () => {
    const receipt = await inventory.getReceipt(ctx(), {
      receiptId: ids.otherReceipt
    });
    const expirations = await inventory.getTrackedEntityExpirations(ctx(), {
      trackedEntityIds: [ids.otherLotOfOtherCompany]
    });

    expect(receipt.error?.category).toBe("notFound");
    expect(expirations.data).toEqual({});
  });

  it("are never updated into the active company", async () => {
    const result = await inventory.updateStorageUnit(ctx(), {
      id: ids.otherUnit,
      name: "Moved",
      locationId: f.locationId
    });

    expect(result.error?.category).toBe("notFound");
    const unit = await f.db
      .selectFrom("storageUnit")
      .select(["name", "companyId"])
      .where("id", "=", ids.otherUnit)
      .executeTakeFirstOrThrow();
    expect(unit).toEqual({ name: "Other bin", companyId: ids.otherCompany });
  });
});

describeLocal("completing a stock transfer", () => {
  // One transfer with one line of 5 parts, `picked` of them already moved.
  const transfer = async (
    status: "Draft" | "Released" | "In Progress",
    picked: number
  ) => {
    const id = `${f.prefix}-st-${crypto.randomUUID().slice(0, 8)}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("stockTransfer")
        .values({
          id,
          stockTransferId: id,
          locationId: f.locationId,
          status,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("stockTransferLine")
        .values({
          stockTransferId: id,
          itemId: f.partId,
          quantity: 5,
          pickedQuantity: picked,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return id;
  };

  const statusOf = async (id: string) =>
    (
      await f.db
        .selectFrom("stockTransfer")
        .select("status")
        .where("id", "=", id)
        .executeTakeFirstOrThrow()
    ).status;

  it("refuses a released transfer with nothing picked", async () => {
    const id = await transfer("Released", 0);

    const result = await inventory.setStockTransferStatus(ctx(), {
      id,
      status: "Completed"
    });

    expect(result.error?.category).toBe("rule");
    expect(await statusOf(id)).toBe("Released");
  });

  it("refuses a draft transfer even with a line picked", async () => {
    const id = await transfer("Draft", 2);

    const result = await inventory.setStockTransferStatus(ctx(), {
      id,
      status: "Completed"
    });

    expect(result.error?.category).toBe("rule");
    expect(await statusOf(id)).toBe("Draft");
  });

  it("completes a transfer that is only partly picked", async () => {
    const id = await transfer("In Progress", 2);

    const result = await inventory.setStockTransferStatus(ctx(), {
      id,
      status: "Completed"
    });

    expect(result).toEqual({
      data: { id, status: "Completed" },
      error: null
    });
    expect(await statusOf(id)).toBe("Completed");
  });
});

describeLocal("picking and editing a stock transfer", () => {
  // A transfer of `status` with one line of 5 parts and nothing picked.
  const transferLine = async (
    status: "Draft" | "Released",
    line: { requiresBatchTracking?: boolean } = {}
  ) => {
    const id = `${f.prefix}-st-${crypto.randomUUID().slice(0, 8)}`;
    const lineId = `${id}-line`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("stockTransfer")
        .values({
          id,
          stockTransferId: id,
          locationId: f.locationId,
          status,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("stockTransferLine")
        .values({
          id: lineId,
          stockTransferId: id,
          itemId: f.partId,
          quantity: 5,
          requiresBatchTracking: line.requiresBatchTracking ?? false,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return { id, lineId };
  };

  const movementsOf = (transferId: string) =>
    f.db
      .selectFrom("itemLedger")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("documentId", "=", transferId)
      .execute();

  it("refuses a pick that rounds to nothing", async () => {
    const { id, lineId } = await transferLine("Released");

    const result = await inventory.pickStockTransferLine(ctx(), {
      lineId,
      quantity: 0.000001,
      locationId: f.locationId
    });

    expect(result.error?.category).toBe("validation");
    expect(await movementsOf(id)).toEqual([]);
  });

  it("refuses a pick at another location of the company", async () => {
    const { id, lineId } = await transferLine("Released");
    const elsewhere = `${f.prefix}-loc-${crypto.randomUUID().slice(0, 8)}`;
    await seed(f, (trx) =>
      trx
        .insertInto("location")
        .values({
          id: elsewhere,
          name: elsewhere,
          addressLine1: "4 Main St",
          city: "Springfield",
          postalCode: "00000",
          timezone: "America/New_York",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

    const result = await inventory.pickStockTransferLine(ctx(), {
      lineId,
      quantity: 1,
      locationId: elsewhere
    });

    expect(result.error?.category).toBe("validation");
    expect(await movementsOf(id)).toEqual([]);
  });

  it("refuses a unit of another item", async () => {
    const { id, lineId } = await transferLine("Released", {
      requiresBatchTracking: true
    });
    // The lot has stock in the line's source, so only the item can refuse it.
    await seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values({
          postingDate: "2026-01-01",
          entryType: "Positive Adjmt.",
          itemId: ids.batchItem,
          trackedEntityId: ids.otherLot,
          locationId: f.locationId,
          quantity: 7,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );

    const result = await inventory.pickStockTransferLineEntity(ctx(), {
      lineId,
      trackedEntityId: ids.otherLot,
      quantity: 1,
      locationId: f.locationId
    });

    expect(result.error?.category).toBe("validation");
    expect(await movementsOf(id)).toEqual([]);
  });

  it("refuses a storage unit of another location", async () => {
    const before = await f.db
      .selectFrom("stockTransfer")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();

    const result = await inventory.createStockTransfer(ctx(), {
      locationId: f.locationId,
      lines: [{ itemId: f.partId, toStorageUnitId: ids.otherUnit, quantity: 1 }]
    });

    expect(result.error?.category).toBe("validation");
    const after = await f.db
      .selectFrom("stockTransfer")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();
    expect(after).toHaveLength(before.length);
  });

  it("never sets a line's From and To to the same place", async () => {
    // Both ends empty: stock recorded against the location on both sides.
    const { lineId } = await transferLine("Draft");

    const result = await inventory.updateStockTransferLines(ctx(), {
      ids: [lineId],
      field: "toStorageUnitId",
      value: null
    });

    expect(result.error?.category).toBe("validation");
  });

  it("refuses a line's storage unit at another location", async () => {
    const { lineId } = await transferLine("Draft");

    const result = await inventory.updateStockTransferLines(ctx(), {
      ids: [lineId],
      field: "fromStorageUnitId",
      value: ids.otherUnit
    });

    expect(result.error?.category).toBe("validation");
    const line = await f.db
      .selectFrom("stockTransferLine")
      .select("fromStorageUnitId")
      .where("id", "=", lineId)
      .executeTakeFirstOrThrow();
    expect(line.fromStorageUnitId).toBeNull();
  });
});
