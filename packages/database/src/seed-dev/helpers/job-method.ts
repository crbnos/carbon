import { insertId, maybeOne, rows } from "../sql.ts";
import type { Ctx } from "../types.ts";

/**
 * Copies an item's active make method onto a job, the way the `get-method` edge
 * function's `itemToJob` path does at runtime.
 *
 * The seed runs as one SQL transaction and cannot invoke an edge function, so
 * without this every seeded job has a bare `jobMakeMethod` (the insert
 * interceptor creates that much) and nothing else — no operations, no
 * materials, no subassembly tree. That is what left the job pages, the MES
 * schedule board and the method explorer empty.
 *
 * Deliberately narrower than the edge function: no configuration rules, no
 * supersession redirect, no tool or parameter copy. Those need runtime inputs
 * the seed has no opinion about. Procedure steps ARE copied — without them the
 * operator's Instructions tab is blank.
 */

type MethodOperationRow = {
  id: string;
  order: number;
  processId: string;
  workCenterId: string | null;
  description: string;
  setupTime: string;
  setupUnit: string;
  laborTime: string;
  laborUnit: string;
  machineTime: string;
  machineUnit: string;
  operationOrder: string;
  operationType: string;
  operationSupplierProcessId: string | null;
  operationLeadTime: string | null;
  operationUnitCost: string | null;
  procedureId: string | null;
};

type MethodMaterialRow = {
  id: string;
  itemId: string;
  itemType: string;
  methodType: string;
  materialMakeMethodId: string | null;
  quantity: string;
  order: number;
  methodOperationId: string | null;
  unitOfMeasureCode: string;
  kit: boolean;
  description: string | null;
  itemTrackingType: string;
  unitCost: string | null;
};

type Rates = {
  laborRate: number;
  machineRate: number;
  overheadRate: number;
};

export type JobOperationStatus =
  | "Todo"
  | "Ready"
  | "Waiting"
  | "In Progress"
  | "Paused"
  | "Done"
  | "Canceled";

export type CopyMethodResult = {
  operations: number;
  materials: number;
  levels: number;
};

/**
 * @param operationStatus status for every copied operation. The caller decides:
 *   a Draft job's operations are Todo, a released job's are Ready.
 */
export async function copyMethodToJob(
  ctx: Ctx,
  jobId: string,
  quantity: number,
  operationStatus: JobOperationStatus = "Todo"
): Promise<CopyMethodResult> {
  const { client, companyId } = ctx;

  const root = await maybeOne<{ id: string; itemId: string }>(
    client,
    `SELECT id, "itemId" FROM "jobMakeMethod"
     WHERE "jobId" = $1 AND "parentMaterialId" IS NULL AND "companyId" = $2
     LIMIT 1`,
    [jobId, companyId]
  );
  if (!root) {
    throw new Error(`Seed: job ${jobId} has no root jobMakeMethod`);
  }

  const makeMethod = await activeMakeMethod(ctx, root.itemId);
  if (!makeMethod) return { operations: 0, materials: 0, levels: 0 };

  const result: CopyMethodResult = { operations: 0, materials: 0, levels: 0 };
  await copyLevel(
    ctx,
    jobId,
    makeMethod,
    root.id,
    quantity,
    operationStatus,
    result,
    new Set([makeMethod])
  );
  return result;
}

async function activeMakeMethod(
  ctx: Ctx,
  itemId: string
): Promise<string | null> {
  const row = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM "makeMethod"
     WHERE "itemId" = $1 AND "companyId" = $2 AND status = 'Active'
     ORDER BY version DESC
     LIMIT 1`,
    [itemId, ctx.companyId]
  );
  return row?.id ?? null;
}

async function ratesFor(ctx: Ctx, workCenterId: string | null): Promise<Rates> {
  if (!workCenterId) return { laborRate: 0, machineRate: 0, overheadRate: 0 };
  const row = await maybeOne<{
    laborRate: string;
    machineRate: string;
    overheadRate: string;
  }>(
    ctx.client,
    `SELECT "laborRate", "machineRate", "overheadRate" FROM "workCenter" WHERE id = $1`,
    [workCenterId]
  );
  return {
    laborRate: Number(row?.laborRate ?? 0),
    machineRate: Number(row?.machineRate ?? 0),
    overheadRate: Number(row?.overheadRate ?? 0)
  };
}

// The operator's Instructions tab reads jobOperationStep, not the procedure —
// the steps are snapshotted onto the operation so a later procedure revision
// cannot rewrite what the floor was told to do.
async function copyProcedureSteps(
  ctx: Ctx,
  procedureId: string,
  jobOperationId: string
): Promise<void> {
  await ctx.client.query(
    `INSERT INTO "jobOperationStep"
       ("name", "required", "sortOrder", "type", "unitOfMeasureCode",
        "minValue", "maxValue", "listValues", "fileTypes", "description",
        "operationId", "companyId", "createdBy")
     SELECT ps."name", ps."required", ps."sortOrder", ps."type", ps."unitOfMeasureCode",
            ps."minValue", ps."maxValue", ps."listValues", ps."fileTypes", ps."description",
            $2, $3, $4
     FROM "procedureStep" ps
     WHERE ps."procedureId" = $1
     ORDER BY ps."sortOrder"`,
    [procedureId, jobOperationId, ctx.companyId, ctx.userId]
  );
}

async function adoptChildMakeMethod(
  ctx: Ctx,
  jobId: string,
  jobMaterialId: string,
  quantityPerParent: number
): Promise<string | null> {
  const row = await maybeOne<{ id: string }>(
    ctx.client,
    `UPDATE "jobMakeMethod" SET "quantityPerParent" = $4
     WHERE "jobId" = $1 AND "parentMaterialId" = $2 AND "companyId" = $3
     RETURNING id`,
    [jobId, jobMaterialId, ctx.companyId, quantityPerParent]
  );
  return row?.id ?? null;
}

// `visited` guards against a BOM that references itself through a chain — the
// DB only blocks the one-node case, and an infinite recursion here would hang
// the seed inside an open transaction.
async function copyLevel(
  ctx: Ctx,
  jobId: string,
  makeMethodId: string,
  jobMakeMethodId: string,
  extendedQuantity: number,
  operationStatus: JobOperationStatus,
  result: CopyMethodResult,
  visited: Set<string>
): Promise<void> {
  const { client, companyId } = ctx;
  result.levels += 1;

  const operations = await rows<MethodOperationRow>(
    client,
    `SELECT id, "order", "processId", "workCenterId", description,
            "setupTime", "setupUnit"::text, "laborTime", "laborUnit"::text,
            "machineTime", "machineUnit"::text, "operationOrder"::text,
            "operationType"::text, "operationSupplierProcessId",
            "operationLeadTime", "operationUnitCost", "procedureId"
     FROM "methodOperation"
     WHERE "makeMethodId" = $1 AND "companyId" = $2
     ORDER BY "order"`,
    [makeMethodId, companyId]
  );

  // methodOperation.id -> jobOperation.id, so a material can keep the operation
  // it is consumed at.
  const operationMap = new Map<string, string>();
  for (const op of operations) {
    const rates = await ratesFor(ctx, op.workCenterId);
    const jobOperationId = await insertId(ctx, "jobOperation", {
      jobId,
      jobMakeMethodId,
      order: op.order,
      operationOrder: op.operationOrder,
      processId: op.processId,
      workCenterId: op.workCenterId,
      description: op.description,
      setupTime: op.setupTime,
      setupUnit: op.setupUnit,
      laborTime: op.laborTime,
      laborUnit: op.laborUnit,
      machineTime: op.machineTime,
      machineUnit: op.machineUnit,
      operationType: op.operationType,
      operationSupplierProcessId: op.operationSupplierProcessId,
      operationLeadTime: op.operationLeadTime ?? 0,
      operationUnitCost: op.operationUnitCost ?? 0,
      procedureId: op.procedureId,
      laborRate: rates.laborRate,
      machineRate: rates.machineRate,
      overheadRate: rates.overheadRate,
      operationQuantity: extendedQuantity,
      targetQuantity: extendedQuantity,
      status: operationStatus
    });
    operationMap.set(op.id, jobOperationId);
    if (op.procedureId)
      await copyProcedureSteps(ctx, op.procedureId, jobOperationId);
    result.operations += 1;
  }

  const materials = await rows<MethodMaterialRow>(
    client,
    `SELECT mm.id, mm."itemId", mm."itemType", mm."methodType"::text,
            mm."materialMakeMethodId", mm.quantity, mm."order",
            mm."methodOperationId", mm."unitOfMeasureCode", mm.kit,
            i.name AS description, i."itemTrackingType"::text, ic."standardCost" AS "unitCost"
     FROM "methodMaterial" mm
     JOIN item i ON i.id = mm."itemId"
     LEFT JOIN "itemCost" ic ON ic."itemId" = mm."itemId"
     WHERE mm."makeMethodId" = $1 AND mm."companyId" = $2
     ORDER BY mm."order"`,
    [makeMethodId, companyId]
  );

  for (const material of materials) {
    const perParent = Number(material.quantity);
    const childExtended = perParent * extendedQuantity;
    const isSubassembly = material.methodType === "Make to Order";

    const jobMaterialId = await insertId(ctx, "jobMaterial", {
      jobId,
      jobMakeMethodId,
      jobOperationId: material.methodOperationId
        ? (operationMap.get(material.methodOperationId) ?? null)
        : null,
      itemId: material.itemId,
      itemType: material.itemType,
      methodType: material.methodType,
      kit: material.kit,
      order: material.order,
      description: material.description ?? material.itemId,
      quantity: perParent,
      estimatedQuantity: childExtended,
      unitOfMeasureCode: material.unitOfMeasureCode,
      unitCost: material.unitCost ?? 0,
      requiresSerialTracking: material.itemTrackingType === "Serial",
      requiresBatchTracking: material.itemTrackingType === "Batch"
    });
    result.materials += 1;

    if (!isSubassembly) continue;

    const childMakeMethodId =
      material.materialMakeMethodId ??
      (await activeMakeMethod(ctx, material.itemId));
    if (!childMakeMethodId || visited.has(childMakeMethodId)) continue;

    // The `sync_insert_job_material_make_method` interceptor already created this
    // row (and its Reserved trackedEntity) the moment the Make-to-Order material
    // was inserted. Inserting a second one gives the method explorer two identical
    // branches per subassembly. Adopt the interceptor's row and fill in what it
    // does not know.
    const childJobMakeMethodId = await adoptChildMakeMethod(
      ctx,
      jobId,
      jobMaterialId,
      perParent
    );
    if (!childJobMakeMethodId) continue;

    await copyLevel(
      ctx,
      jobId,
      childMakeMethodId,
      childJobMakeMethodId,
      childExtended,
      operationStatus,
      result,
      new Set([...visited, childMakeMethodId])
    );
  }
}
