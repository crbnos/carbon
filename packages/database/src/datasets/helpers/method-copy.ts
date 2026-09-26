import {
  insertId,
  maybeOne,
  need,
  one,
  type Row,
  rows,
  sharedColumns
} from "../sql.ts";
import type { Ctx } from "../types.ts";

/**
 * The seed's copy of the `get-method` edge function, which it cannot invoke from
 * inside its one SQL transaction. Narrower on purpose: no configuration rules,
 * supersession redirect, assembly-instruction step expansion or method steps.
 */

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

type Kind = "method" | "job" | "quote";

const TABLES: Record<
  Kind,
  { operation: string; material: string; tool: string; parameter: string }
> = {
  method: {
    operation: "methodOperation",
    material: "methodMaterial",
    tool: "methodOperationTool",
    parameter: "methodOperationParameter"
  },
  job: {
    operation: "jobOperation",
    material: "jobMaterial",
    tool: "jobOperationTool",
    parameter: "jobOperationParameter"
  },
  quote: {
    operation: "quoteOperation",
    material: "quoteMaterial",
    tool: "quoteOperationTool",
    parameter: "quoteOperationParameter"
  }
};

// get-method gives job/quote rows fresh customFields.
const NEVER_COPIED = [
  "id",
  "makeMethodId",
  "companyId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "productionQuantity"
];

type SourceOperation = Row & {
  id: string;
  procedureId: string | null;
  procedureFound: boolean;
  procedureContent: unknown;
  workInstruction: unknown;
  operationUnitCost: string | null;
  operationMinimumCost: string | null;
  supplierMinimumCost: string;
  supplierLeadTime: string;
  laborRate: string;
  machineRate: string;
  overheadRate: string;
};

type SourceMaterial = Row & {
  itemId: string;
  methodType: string;
  materialMakeMethodId: string | null;
  quantity: string;
  methodOperationId: string | null;
  itemName: string;
  itemTrackingType: string;
  standardCost: string | null;
  defaultStorageUnitId: string | null;
};

type Level = { makeMethodId: string; quantity: number };

type Target = {
  kind: Kind;
  locationId: string | null;
  operation: (op: SourceOperation, level: Level) => Row;
  material: (
    material: SourceMaterial,
    operationId: string | null,
    level: Level
  ) => Row;
  /** Absent for a method → method copy, which (like get-method's) copies one level. */
  adoptChild?: (
    materialId: string,
    quantityPerParent: number
  ) => Promise<string>;
};

export async function copyMethodToJob(
  ctx: Ctx,
  jobId: string,
  quantity: number,
  status: JobOperationStatus = "Todo"
): Promise<CopyMethodResult> {
  const root = await one<{ id: string; itemId: string }>(
    ctx.client,
    `SELECT id, "itemId" FROM "jobMakeMethod"
     WHERE "jobId" = $1 AND "parentMaterialId" IS NULL AND "companyId" = $2`,
    [jobId, ctx.companyId]
  );
  const target: Target = {
    kind: "job",
    locationId: null,
    operation: (op, level) => ({
      jobId,
      jobMakeMethodId: level.makeMethodId,
      operationMinimumCost: op.supplierMinimumCost,
      workInstruction: op.procedureId
        ? (op.procedureContent ?? {})
        : op.workInstruction,
      operationQuantity: level.quantity,
      targetQuantity: level.quantity,
      status
    }),
    material: (material, operationId, level) => ({
      jobId,
      jobMakeMethodId: level.makeMethodId,
      jobOperationId: operationId,
      ...materialCore(material),
      quantity: material.quantity,
      estimatedQuantity: Number(material.quantity) * level.quantity,
      requiresSerialTracking: material.itemTrackingType === "Serial",
      requiresBatchTracking: material.itemTrackingType === "Batch"
    }),
    adoptChild: async (materialId, quantityPerParent) =>
      adopted(
        await maybeOne<{ id: string }>(
          ctx.client,
          `UPDATE "jobMakeMethod" SET "quantityPerParent" = $4
           WHERE "jobId" = $1 AND "parentMaterialId" = $2 AND "companyId" = $3
           RETURNING id`,
          [jobId, materialId, ctx.companyId, quantityPerParent]
        ),
        `job material ${materialId}`
      )
  };
  return copyTree(ctx, target, root, quantity);
}

export async function copyMethodToQuoteLine(
  ctx: Ctx,
  quoteId: string,
  quoteLineId: string
): Promise<CopyMethodResult> {
  const root = await one<{ id: string; itemId: string }>(
    ctx.client,
    `SELECT id, "itemId" FROM "quoteMakeMethod"
     WHERE "quoteLineId" = $1 AND "parentMaterialId" IS NULL AND "companyId" = $2`,
    [quoteLineId, ctx.companyId]
  );
  const { locationId } = await one<{ locationId: string | null }>(
    ctx.client,
    `SELECT "locationId" FROM quote WHERE id = $1 AND "companyId" = $2`,
    [quoteId, ctx.companyId]
  );
  const target: Target = {
    kind: "quote",
    locationId,
    // get-method keeps the method's own minimum cost on a quote operation.
    operation: (op, level) => ({
      quoteId,
      quoteLineId,
      quoteMakeMethodId: level.makeMethodId,
      operationMinimumCost: op.operationMinimumCost ?? 0
    }),
    material: (material, operationId, level) => ({
      quoteId,
      quoteLineId,
      quoteMakeMethodId: level.makeMethodId,
      quoteOperationId: operationId,
      ...materialCore(material),
      quantity: material.quantity,
      storageUnitId: material.defaultStorageUnitId
    }),
    adoptChild: async (materialId) =>
      adopted(
        await maybeOne<{ id: string }>(
          ctx.client,
          `SELECT id FROM "quoteMakeMethod"
           WHERE "quoteLineId" = $1 AND "parentMaterialId" = $2 AND "companyId" = $3`,
          [quoteLineId, materialId, ctx.companyId]
        ),
        `quote material ${materialId}`
      )
  };
  return copyTree(ctx, target, root, 1);
}

/** Mirrors the app's `copyMakeMethod`. */
export async function copyMethodToMethod(
  ctx: Ctx,
  sourceMakeMethodId: string,
  targetMakeMethodId: string
): Promise<void> {
  const materialColumns = await sharedColumns(
    ctx.client,
    "methodMaterial",
    "methodMaterial",
    NEVER_COPIED
  );
  const target: Target = {
    kind: "method",
    locationId: null,
    operation: (_op, level) => ({ makeMethodId: level.makeMethodId }),
    material: (material, operationId, level) => ({
      ...pick(material, materialColumns),
      makeMethodId: level.makeMethodId,
      methodOperationId: operationId
    })
  };
  await copyLevel(
    ctx,
    target,
    sourceMakeMethodId,
    { makeMethodId: targetMakeMethodId, quantity: 1 },
    { operations: 0, materials: 0, levels: 0 },
    new Set([sourceMakeMethodId])
  );
}

async function copyTree(
  ctx: Ctx,
  target: Target,
  root: { id: string; itemId: string },
  quantity: number
): Promise<CopyMethodResult> {
  const makeMethodId = await methodOfItem(ctx, root.itemId);
  const result: CopyMethodResult = { operations: 0, materials: 0, levels: 0 };
  await copyLevel(
    ctx,
    target,
    makeMethodId,
    { makeMethodId: root.id, quantity },
    result,
    new Set([makeMethodId])
  );
  return result;
}

// Prefers Active; falls back to the newest version (a buy part's interceptor
// method stays Draft).
async function methodOfItem(ctx: Ctx, itemId: string): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM "makeMethod"
     WHERE "itemId" = $1 AND "companyId" = $2
     ORDER BY (status = 'Active') DESC, version DESC
     LIMIT 1`,
    [itemId, ctx.companyId]
  );
  if (!row) throw new Error(`Seed: item ${itemId} has no make method to copy`);
  return row.id;
}

function adopted(row: { id: string } | null, what: string): string {
  if (!row) {
    throw new Error(`Seed: ${what} has no interceptor child make method`);
  }
  return row.id;
}

function pick(row: Row, columns: string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

function materialCore(material: SourceMaterial): Row {
  return {
    itemId: material.itemId,
    itemType: material.itemType,
    methodType: material.methodType,
    kit: material.kit,
    order: material.order,
    description: material.itemName,
    unitOfMeasureCode: material.unitOfMeasureCode,
    unitCost: material.standardCost ?? 0
  };
}

// `visited` holds the make methods on the current path: the DB only blocks a
// method listing itself, and a longer cycle would recurse inside the open
// transaction forever.
async function copyLevel(
  ctx: Ctx,
  target: Target,
  makeMethodId: string,
  level: Level,
  result: CopyMethodResult,
  visited: Set<string>
): Promise<void> {
  result.levels += 1;
  const operationIds = await copyOperations(ctx, target, makeMethodId, level);
  result.operations += Object.keys(operationIds).length;

  const materials = await rows<SourceMaterial>(
    ctx.client,
    `SELECT mm.*, i.name AS "itemName", i."itemTrackingType",
            ic."standardCost", pm."defaultStorageUnitId"
     FROM "methodMaterial" mm
     JOIN item i ON i.id = mm."itemId" AND i."companyId" = mm."companyId"
     LEFT JOIN "itemCost" ic
       ON ic."itemId" = mm."itemId" AND ic."companyId" = mm."companyId"
     LEFT JOIN "pickMethod" pm
       ON pm."itemId" = mm."itemId" AND pm."locationId" = $3
      AND pm."companyId" = mm."companyId"
     WHERE mm."makeMethodId" = $1 AND mm."companyId" = $2
     ORDER BY mm."order"`,
    [makeMethodId, ctx.companyId, target.locationId]
  );

  for (const material of materials) {
    const operationId = material.methodOperationId
      ? need(operationIds, material.methodOperationId, "copied operation")
      : null;
    const materialId = await insertId(
      ctx,
      TABLES[target.kind].material,
      target.material(material, operationId, level)
    );
    result.materials += 1;

    if (!target.adoptChild || material.methodType !== "Make to Order") continue;

    const childMakeMethodId =
      material.materialMakeMethodId ??
      (await methodOfItem(ctx, material.itemId));
    if (visited.has(childMakeMethodId)) {
      throw new Error(
        `Seed: make method ${childMakeMethodId} is its own subassembly (BOM cycle)`
      );
    }
    const perParent = Number(material.quantity);
    const childLevel = {
      makeMethodId: await target.adoptChild(materialId, perParent),
      quantity: perParent * level.quantity
    };
    await copyLevel(
      ctx,
      target,
      childMakeMethodId,
      childLevel,
      result,
      new Set([...visited, childMakeMethodId])
    );
  }
}

async function copyOperations(
  ctx: Ctx,
  target: Target,
  makeMethodId: string,
  level: Level
): Promise<Record<string, string>> {
  const tables = TABLES[target.kind];
  const columns = await sharedColumns(
    ctx.client,
    "methodOperation",
    tables.operation,
    target.kind === "method" ? NEVER_COPIED : [...NEVER_COPIED, "customFields"]
  );
  const operations = await rows<SourceOperation>(
    ctx.client,
    `SELECT mo.*,
            p.id IS NOT NULL AS "procedureFound", p.content AS "procedureContent",
            COALESCE(sp."minimumCost", avg_sp."minimumCost", 0) AS "supplierMinimumCost",
            COALESCE(sp."leadTime", avg_sp."leadTime", 0) AS "supplierLeadTime",
            COALESCE(wc."laborRate", 0) AS "laborRate",
            COALESCE(wc."machineRate", 0) AS "machineRate",
            COALESCE(wc."overheadRate", 0) AS "overheadRate"
     FROM "methodOperation" mo
     LEFT JOIN procedure p
       ON p.id = mo."procedureId" AND p."companyId" = mo."companyId"
     LEFT JOIN "supplierProcess" sp
       ON sp.id = mo."operationSupplierProcessId" AND sp."companyId" = mo."companyId"
     LEFT JOIN LATERAL (
       SELECT avg(s."minimumCost") AS "minimumCost", avg(s."leadTime") AS "leadTime"
       FROM "supplierProcess" s
       WHERE s."processId" = mo."processId" AND s."companyId" = mo."companyId"
     ) avg_sp ON true
     LEFT JOIN "workCenter" wc
       ON wc.id = mo."workCenterId" AND wc."companyId" = mo."companyId"
     WHERE mo."makeMethodId" = $1 AND mo."companyId" = $2
     ORDER BY mo."order"`,
    [makeMethodId, ctx.companyId]
  );

  const operationIds: Record<string, string> = {};
  for (const op of operations) {
    if (op.procedureId && !op.procedureFound) {
      throw new Error(
        `Seed: operation ${op.id} names procedure ${op.procedureId}, which is not this company's`
      );
    }
    const runtime =
      target.kind === "method"
        ? {}
        : {
            laborRate: op.laborRate,
            machineRate: op.machineRate,
            overheadRate: op.overheadRate,
            operationUnitCost: op.operationUnitCost ?? 0,
            operationLeadTime: op.supplierLeadTime
          };
    const operationId = await insertId(ctx, tables.operation, {
      ...pick(op, columns),
      ...runtime,
      ...target.operation(op, level)
    });
    operationIds[op.id] = operationId;
    await copyOperationChildren(ctx, target.kind, op, operationId);
  }
  return operationIds;
}

async function copyOperationChildren(
  ctx: Ctx,
  kind: Kind,
  op: SourceOperation,
  operationId: string
): Promise<void> {
  const tables = TABLES[kind];
  const params = [op.id, operationId, ctx.companyId, ctx.userId];
  await ctx.client.query(
    `INSERT INTO "${tables.tool}"
       ("operationId", "toolId", "quantity", "companyId", "createdBy")
     SELECT $2, t."toolId", t."quantity", $3, $4
     FROM "methodOperationTool" t
     WHERE t."operationId" = $1 AND t."companyId" = $3`,
    params
  );

  if (!op.procedureId) {
    await ctx.client.query(
      `INSERT INTO "${tables.parameter}"
         ("operationId", "key", "value", "companyId", "createdBy")
       SELECT $2, p."key", p."value", $3, $4
       FROM "methodOperationParameter" p
       WHERE p."operationId" = $1 AND p."companyId" = $3`,
      params
    );
    return;
  }
  if (kind !== "job") return;

  // insertProcedureDataForJobOperation: the procedure is snapshotted onto the
  // job operation, so a later revision cannot rewrite what the floor was told.
  const procedureParams = [
    op.procedureId,
    operationId,
    ctx.companyId,
    ctx.userId
  ];
  await ctx.client.query(
    `INSERT INTO "jobOperationStep"
       ("name", "required", "sortOrder", "type", "unitOfMeasureCode",
        "minValue", "maxValue", "listValues", "fileTypes", "description",
        "operationId", "companyId", "createdBy")
     SELECT ps."name", ps."required", ps."sortOrder", ps."type", ps."unitOfMeasureCode",
            ps."minValue", ps."maxValue", ps."listValues", ps."fileTypes", ps."description",
            $2, $3, $4
     FROM "procedureStep" ps
     WHERE ps."procedureId" = $1 AND ps."companyId" = $3
     ORDER BY ps."sortOrder"`,
    procedureParams
  );
  await ctx.client.query(
    `INSERT INTO "jobOperationParameter"
       ("operationId", "key", "value", "companyId", "createdBy")
     SELECT $2, pp."key", pp."value", $3, $4
     FROM "procedureParameter" pp
     WHERE pp."procedureId" = $1 AND pp."companyId" = $3`,
    procedureParams
  );
}
