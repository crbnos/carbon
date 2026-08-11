import { assertSingle, insertId, insertMaybe, maybeOne } from "../sql.ts";
import type { Ctx, ItemRef, ItemType } from "../types.ts";

export type ItemSpec = {
  readableId: string;
  revision?: string;
  name: string;
  type: ItemType;
  replenishment?: "Buy" | "Make" | "Buy and Make";
  defaultMethodType?:
    | "Pull from Inventory"
    | "Purchase to Order"
    | "Make to Order";
  trackingType?: "Inventory" | "Non-Inventory" | "Serial" | "Batch";
  unitOfMeasureCode?: string;
  standardCost?: number;
  unitSalePrice?: number;
  leadTime?: number;
  description?: string;
};

/**
 * Inserts an item and its positional extension row, then activates the
 * auto-created make method for Part/Tool items. Never inserts itemCost or
 * itemReplenishment (the interceptor already did that — duplicates fan out views).
 */
export async function createItem(ctx: Ctx, spec: ItemSpec): Promise<ItemRef> {
  const { client, companyId, userId } = ctx;

  const revision = spec.revision ?? "0";
  const uom = spec.unitOfMeasureCode ?? "EA";
  const isMake = (spec.replenishment ?? "Buy") === "Make";
  const defaultMethodType =
    spec.defaultMethodType ?? (isMake ? "Make to Order" : "Purchase to Order");

  const existing = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM item WHERE "readableId" = $1 AND revision = $2 AND "companyId" = $3`,
    [spec.readableId, revision, companyId]
  );
  if (existing) {
    // Already there — collect make method if any
    const mm = await maybeOne<{ id: string }>(
      client,
      `SELECT id FROM "makeMethod" WHERE "itemId" = $1 ORDER BY version LIMIT 1`,
      [existing.id]
    );
    return {
      id: existing.id,
      readableId: spec.readableId,
      revision,
      name: spec.name,
      type: spec.type,
      makeMethodId: mm?.id ?? null,
      unitCost: spec.standardCost ?? 0,
      unitOfMeasureCode: uom
    };
  }

  const itemId = await insertId(ctx, "item", {
    readableId: spec.readableId,
    revision,
    name: spec.name,
    type: spec.type,
    replenishmentSystem: spec.replenishment ?? "Buy",
    defaultMethodType,
    itemTrackingType: spec.trackingType ?? "Inventory",
    unitOfMeasureCode: uom,
    description: spec.description ?? null,
    active: true
  });

  // The item interceptor creates itemCost, itemReplenishment, itemUnitSalePrice,
  // itemPlanning (one per location). Guard against any double-insert bugs.
  await assertSingle(ctx, "itemCost", { itemId });

  // Positional extension row (part.id = readableId). All revisions share one row.
  const extensionTable = extensionTableFor(spec.type);
  await insertMaybe(ctx, extensionTable, {
    id: spec.readableId,
    approved: true,
    companyId,
    createdBy: userId
  });

  // Apply cost/price/lead-time by UPDATE (not insert).
  if (spec.standardCost !== undefined) {
    await client.query(
      `UPDATE "itemCost" SET "standardCost" = $1 WHERE "itemId" = $2`,
      [spec.standardCost, itemId]
    );
  }
  if (spec.unitSalePrice !== undefined) {
    await client.query(
      `UPDATE "itemUnitSalePrice" SET "unitSalePrice" = $1 WHERE "itemId" = $2`,
      [spec.unitSalePrice, itemId]
    );
  }
  if (spec.leadTime !== undefined) {
    await client.query(
      `UPDATE "itemReplenishment" SET "leadTime" = $1 WHERE "itemId" = $2`,
      [spec.leadTime, itemId]
    );
  }

  // For Part / Tool / Service the interceptor created a Draft makeMethod.
  // Adopt it to Active for Make items.
  let makeMethodId: string | null = null;
  if (["Part", "Tool", "Service"].includes(spec.type)) {
    const mmRow = await maybeOne<{ id: string }>(
      client,
      `SELECT id FROM "makeMethod" WHERE "itemId" = $1 ORDER BY version LIMIT 1`,
      [itemId]
    );
    if (!mmRow)
      throw new Error(
        `Seed: no makeMethod created for item ${spec.readableId}`
      );
    makeMethodId = mmRow.id;

    if (isMake) {
      await client.query(
        `UPDATE "makeMethod" SET status = 'Active', "updatedBy" = $2 WHERE id = $1`,
        [makeMethodId, userId]
      );
    }
  }

  return {
    id: itemId,
    readableId: spec.readableId,
    revision,
    name: spec.name,
    type: spec.type,
    makeMethodId,
    unitCost: spec.standardCost ?? 0,
    unitOfMeasureCode: uom
  };
}

function extensionTableFor(type: ItemType): string {
  switch (type) {
    case "Part":
      return "part";
    case "Material":
      return "material";
    case "Tool":
      return "tool";
    case "Consumable":
      return "consumable";
    case "Service":
      return "service";
    case "Fixture":
      return "fixture";
  }
}

export async function addBomLine(
  ctx: Ctx,
  makeMethodId: string,
  componentItem: ItemRef,
  quantity: number,
  order: number
): Promise<void> {
  await insertId(ctx, "methodMaterial", {
    makeMethodId,
    itemId: componentItem.id,
    itemType: componentItem.type,
    unitOfMeasureCode: componentItem.unitOfMeasureCode,
    quantity,
    order
  });
}

export async function addBopOperation(
  ctx: Ctx,
  makeMethodId: string,
  processId: string,
  workCenterId: string | undefined,
  description: string,
  order: number,
  opts: { laborTime?: number; laborUnit?: string; setupTime?: number } = {}
): Promise<string> {
  return insertId(ctx, "methodOperation", {
    makeMethodId,
    processId,
    workCenterId: workCenterId ?? null,
    description,
    order,
    laborTime: opts.laborTime ?? 0.5,
    laborUnit: opts.laborUnit ?? "Hours/Piece",
    setupTime: opts.setupTime ?? 0
  });
}
