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
      isMake,
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
    thumbnailPath: ctx.dataset.industryId
      ? `_templates/${ctx.dataset.industryId}/${spec.readableId}.svg`
      : null,
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

  // For Part / Tool / Service the interceptor created a Draft makeMethod. Leave
  // it Draft — Active freezes the BOM and BOP, and a demo company should be able
  // to edit them without first cutting a new version.
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
  }

  return {
    id: itemId,
    readableId: spec.readableId,
    revision,
    name: spec.name,
    type: spec.type,
    makeMethodId,
    isMake,
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

/**
 * A Make component is a subassembly: `methodType` must say so, and
 * `materialMakeMethodId` must point at the component's own active method, or the
 * BOM renders as one flat level and the Subassembly/Kit control never appears.
 */
export async function addBomLine(
  ctx: Ctx,
  makeMethodId: string,
  componentItem: ItemRef,
  quantity: number,
  order: number,
  opts: { methodType?: MethodType; kit?: boolean } = {}
): Promise<string> {
  const methodType =
    opts.methodType ??
    (componentItem.isMake ? "Make to Order" : "Pull from Inventory");
  const isSubassembly = methodType === "Make to Order";

  return insertId(ctx, "methodMaterial", {
    makeMethodId,
    itemId: componentItem.id,
    itemType: componentItem.type,
    unitOfMeasureCode: componentItem.unitOfMeasureCode,
    methodType,
    materialMakeMethodId: isSubassembly ? componentItem.makeMethodId : null,
    kit: opts.kit ?? false,
    quantity,
    order
  });
}

export type MethodType =
  | "Make to Order"
  | "Pull from Inventory"
  | "Purchase to Order";

export type OperationType =
  | "Process"
  | "Assembly"
  | "Inspection"
  | "Outside Processing";

export async function addBopOperation(
  ctx: Ctx,
  makeMethodId: string,
  processId: string,
  workCenterId: string | undefined,
  description: string,
  order: number,
  opts: {
    laborTime?: number;
    laborUnit?: string;
    setupTime?: number;
    machineTime?: number;
    operationType?: OperationType;
    // Required by the UI for an Outside Processing step — without it the job
    // cannot be released and no supplier name renders on the operation.
    operationSupplierProcessId?: string;
    operationLeadTime?: number;
    operationUnitCost?: number;
    procedureId?: string;
  } = {}
): Promise<string> {
  return insertId(ctx, "methodOperation", {
    makeMethodId,
    processId,
    workCenterId: workCenterId ?? null,
    description,
    order,
    laborTime: opts.laborTime ?? 0.5,
    laborUnit: opts.laborUnit ?? "Hours/Piece",
    setupTime: opts.setupTime ?? 0,
    machineTime: opts.machineTime ?? 0,
    operationType: opts.operationType ?? "Process",
    operationSupplierProcessId: opts.operationSupplierProcessId ?? null,
    operationLeadTime: opts.operationLeadTime ?? 0,
    operationUnitCost: opts.operationUnitCost ?? 0,
    procedureId: opts.procedureId ?? null
  });
}
