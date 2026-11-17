// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";
import type {
  QuoteLineRouting,
  QuoteMakeMethodRow,
  QuoteMaterialRow,
  QuoteOperationRow
} from "../scheduling/quote-lead-time.ts";

export type ItemMethodMaterial = {
  id: string;
  makeMethodId: string;
  itemId: string;
  itemReadableId: string;
  methodType: QuoteMaterialRow["methodType"];
  quantity: number;
  methodOperationId: string | null;
};

export type ItemMethodOperation = Omit<
  QuoteOperationRow,
  "quoteMakeMethodId" | "operationLeadTime"
> & {
  makeMethodId: string;
  operationLeadTime: number | null;
};

/**
 * An item's routing as the quote engine's rows. The engine keys each make
 * method by id and gives it one parent material, so a sub-assembly used twice
 * needs two copies: every method, material and operation id is prefixed with
 * the path that reached it. Only a Make to Order material explodes into a
 * child method, as on a quote; a Pull from Inventory or Purchase to Order
 * material stays a material the engine floors by stock or lead time.
 */
export function buildItemRouting(args: {
  rootItemId: string;
  activeMethodByItem: Map<string, string>;
  materialsByMethod: Map<string, ItemMethodMaterial[]>;
  operationsByMethod: Map<string, ItemMethodOperation[]>;
}): QuoteLineRouting | null {
  const { activeMethodByItem, materialsByMethod, operationsByMethod } = args;
  const rootMethodId = activeMethodByItem.get(args.rootItemId);
  if (!rootMethodId) return null;

  const makeMethods: QuoteMakeMethodRow[] = [];
  const materials: QuoteMaterialRow[] = [];
  const operations: QuoteOperationRow[] = [];

  const visit = (
    occurrenceId: string,
    methodId: string,
    parentMaterialId: string | null,
    itemsOnPath: Set<string>
  ) => {
    makeMethods.push({ id: occurrenceId, parentMaterialId });
    const opId = (id: string) => `${occurrenceId}/op:${id}`;

    for (const op of operationsByMethod.get(methodId) ?? []) {
      operations.push({
        id: opId(op.id),
        quoteMakeMethodId: occurrenceId,
        processId: op.processId,
        workCenterId: op.workCenterId,
        order: op.order,
        operationOrder: op.operationOrder,
        operationType: op.operationType,
        description: op.description,
        setupTime: op.setupTime,
        setupUnit: op.setupUnit,
        laborTime: op.laborTime,
        laborUnit: op.laborUnit,
        machineTime: op.machineTime,
        machineUnit: op.machineUnit,
        operationLeadTime: op.operationLeadTime ?? 0
      });
    }

    for (const material of materialsByMethod.get(methodId) ?? []) {
      const materialId = `${occurrenceId}/mat:${material.id}`;
      materials.push({
        id: materialId,
        quoteMakeMethodId: occurrenceId,
        itemId: material.itemId,
        itemReadableId: material.itemReadableId,
        methodType: material.methodType,
        quantity: material.quantity,
        quoteOperationId: material.methodOperationId
          ? opId(material.methodOperationId)
          : null
      });

      if (material.methodType !== "Make to Order") continue;
      if (itemsOnPath.has(material.itemId)) continue;
      const childMethodId = activeMethodByItem.get(material.itemId);
      if (!childMethodId) continue;
      visit(
        `${materialId}/method`,
        childMethodId,
        materialId,
        new Set([...itemsOnPath, material.itemId])
      );
    }
  };

  visit(rootMethodId, rootMethodId, null, new Set([args.rootItemId]));
  return operations.length > 0 ? { makeMethods, materials, operations } : null;
}

/**
 * Load an item's routing through its active make methods: one recursive query
 * for the methods a Make to Order line reaches, then their materials and
 * operations. Returns null when the item has no operation to schedule.
 */
export async function loadItemRouting(
  db: Kysely<DB>,
  companyId: string,
  itemId: string
): Promise<QuoteLineRouting | null> {
  const methodRows = await sql<{ id: string; itemId: string }>`
    WITH RECURSIVE "method" AS (
      SELECT am."id", am."itemId"
      FROM "activeMakeMethods" am
      WHERE am."companyId" = ${companyId} AND am."itemId" = ${itemId}
      UNION
      SELECT child."id", child."itemId"
      FROM "method" m
      JOIN "methodMaterial" mm
        ON mm."makeMethodId" = m."id" AND mm."companyId" = ${companyId}
      JOIN "activeMakeMethods" child
        ON child."itemId" = mm."itemId" AND child."companyId" = ${companyId}
      WHERE mm."methodType" = 'Make to Order'
    )
    SELECT "id", "itemId" FROM "method"
  `.execute(db);

  const methods = methodRows.rows;
  if (methods.length === 0) return null;
  const methodIds = methods.map((m) => m.id);

  const [materialRows, operationRows] = await Promise.all([
    db
      .selectFrom("methodMaterial")
      .innerJoin("item", (join) =>
        join
          .onRef("item.id", "=", "methodMaterial.itemId")
          .onRef("item.companyId", "=", "methodMaterial.companyId")
      )
      .select([
        "methodMaterial.id as id",
        "methodMaterial.makeMethodId as makeMethodId",
        "methodMaterial.itemId as itemId",
        "item.readableId as itemReadableId",
        "methodMaterial.methodType as methodType",
        "methodMaterial.quantity as quantity",
        "methodMaterial.methodOperationId as methodOperationId"
      ])
      .where("methodMaterial.makeMethodId", "in", methodIds)
      .where("methodMaterial.companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("methodOperation")
      .select([
        "id",
        "makeMethodId",
        "processId",
        "workCenterId",
        "order",
        "operationOrder",
        "operationType",
        "description",
        "setupTime",
        "setupUnit",
        "laborTime",
        "laborUnit",
        "machineTime",
        "machineUnit",
        "operationLeadTime"
      ])
      .where("makeMethodId", "in", methodIds)
      .where("companyId", "=", companyId)
      .execute()
  ]);

  const materialsByMethod = new Map<string, ItemMethodMaterial[]>();
  for (const row of materialRows) {
    const list = materialsByMethod.get(row.makeMethodId) ?? [];
    list.push({
      id: row.id,
      makeMethodId: row.makeMethodId,
      itemId: row.itemId,
      itemReadableId: row.itemReadableId,
      methodType: row.methodType as ItemMethodMaterial["methodType"],
      // Kysely hands NUMERIC back as a string.
      quantity: Number(row.quantity),
      methodOperationId: row.methodOperationId
    });
    materialsByMethod.set(row.makeMethodId, list);
  }

  const operationsByMethod = new Map<string, ItemMethodOperation[]>();
  for (const row of operationRows) {
    const list = operationsByMethod.get(row.makeMethodId) ?? [];
    list.push({
      id: row.id,
      makeMethodId: row.makeMethodId,
      processId: row.processId,
      workCenterId: row.workCenterId,
      order: Number(row.order),
      operationOrder: row.operationOrder,
      operationType: row.operationType,
      description: row.description,
      setupTime: Number(row.setupTime),
      setupUnit: row.setupUnit,
      laborTime: Number(row.laborTime),
      laborUnit: row.laborUnit,
      machineTime: Number(row.machineTime),
      machineUnit: row.machineUnit,
      operationLeadTime:
        row.operationLeadTime === null ? null : Number(row.operationLeadTime)
    });
    operationsByMethod.set(row.makeMethodId, list);
  }

  return buildItemRouting({
    rootItemId: itemId,
    activeMethodByItem: new Map(methods.map((m) => [m.itemId, m.id])),
    materialsByMethod,
    operationsByMethod
  });
}
