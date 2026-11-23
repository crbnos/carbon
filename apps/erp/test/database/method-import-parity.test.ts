// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The method import writes the same rows as the BOM and Bill of Process
// editors. One method is built the way the editors' routes build it (their
// form validators, then the building blocks), the other by the import from a
// CSV with the same content; every column but ids, owners and timestamps must
// match. Runs against the local stack (database and PostgREST); skips without.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import {
  methodMaterialValidator,
  methodOperationValidator
} from "../../app/modules/items/items.models";
import {
  upsertMethodMaterial,
  upsertMethodOperation,
  upsertMethodOperationParameter,
  upsertMethodOperationStep,
  upsertMethodOperationTool
} from "../../app/modules/items/items.service";
import {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../../app/modules/shared/shared.models";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import {
  type MethodImportFixture,
  methodImportFixture
} from "./fixtures/method-import";

const USER = "system";
const test = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!hasLocalDatabase || !localServiceRoleClient())(name, fn, 120_000);

// The BOM lines and operations both paths build, as a person would enter them
// in the editors: pick the item (or process) and type what differs.
const LINES = [
  ["COMP-1", 2],
  ["COMP-2", 3],
  ["MAT-YD", 1.5],
  ["SUB", 1],
  ["CONS", 4]
] as const;

/** Every row of one make method, ids and audit columns removed, children nested by order. */
async function snapshot(db: Kysely<KyselyDatabase>, makeMethodId: string) {
  const materials = await db
    .selectFrom("methodMaterial")
    .selectAll()
    .where("makeMethodId", "=", makeMethodId)
    .orderBy("order")
    .execute();
  const operations = await db
    .selectFrom("methodOperation")
    .selectAll()
    .where("makeMethodId", "=", makeMethodId)
    .orderBy("order")
    .execute();
  // Both methods in the test have operations, so the `in` lists are never empty.
  const operationIds = operations.map((o) => o.id);
  const steps = await db
    .selectFrom("methodOperationStep")
    .selectAll()
    .where("operationId", "in", operationIds)
    .execute();
  const tools = await db
    .selectFrom("methodOperationTool")
    .selectAll()
    .where("operationId", "in", operationIds)
    .execute();
  const parameters = await db
    .selectFrom("methodOperationParameter")
    .selectAll()
    .where("operationId", "in", operationIds)
    .execute();
  const orderOf = new Map(operations.map((o) => [o.id, Number(o.order)]));
  const strip = (row: Record<string, unknown>) => {
    const {
      id: _id,
      makeMethodId: _makeMethodId,
      operationId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...rest
    } = row;
    return operationId === undefined
      ? rest
      : { ...rest, operationOrder: orderOf.get(operationId as string) };
  };
  const byOrder = (rows: Record<string, unknown>[]) =>
    rows
      .map(strip)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    materials: materials.map(strip),
    operations: operations.map(strip),
    steps: byOrder(steps),
    tools: byOrder(tools),
    parameters: byOrder(parameters)
  };
}

describe("method import parity with the editors", () => {
  let f: MethodImportFixture | undefined;
  afterEach(async () => {
    await f?.cleanup();
    f = undefined;
    // Deleting the scratch company cascades through every company table.
  }, 60_000);

  test("an imported BOM and BOP match the editors' rows", async () => {
    f = await methodImportFixture();
    const client = f.client!;
    const viaEditor = await f.methodOf("ASSY");

    // --- the editors -----------------------------------------------------
    for (const [index, [readableId, quantity]] of LINES.entries()) {
      const item = await f.db
        .selectFrom("item")
        .select([
          "id",
          "type",
          "unitOfMeasureCode",
          "defaultMethodType",
          "sourcingType"
        ])
        .where("id", "=", f.itemId(readableId))
        .executeTakeFirstOrThrow();
      // What BillOfMaterial posts once the item is picked (onItemChange).
      const form = await methodMaterialValidator.parseAsync({
        id: nanoid(),
        makeMethodId: viaEditor,
        order: String(index + 1),
        itemType: item.type,
        kit: "false",
        methodType: item.defaultMethodType,
        sourcingType: item.sourcingType,
        itemId: item.id,
        methodOperationId: "",
        quantity: String(quantity),
        unitOfMeasureCode: item.unitOfMeasureCode,
        storageUnitIds: "{}"
      });
      const result = await upsertMethodMaterial(client, {
        ...form,
        companyId: f.companyId,
        createdBy: USER,
        customFields: {}
      });
      expect(result.error).toBeNull();
    }

    // What BillOfProcess posts after the process is picked (onProcessChange
    // fills the description, the units and the operation type).
    const operationForms = [
      {
        order: "1",
        operationType: "Process",
        processId: f.processId("machining"),
        workCenterId: f.workCenterId,
        description: "Mill pocket",
        setupTime: "5",
        laborTime: "2",
        machineTime: "3"
      },
      {
        order: "2",
        operationType: "Assembly",
        processId: f.processId("bench-assembly"),
        workCenterId: "",
        description: "Bench Assembly",
        setupTime: "0",
        laborTime: "1",
        machineTime: "0"
      }
    ];
    const operationIds: string[] = [];
    for (const values of operationForms) {
      const form = await methodOperationValidator.parseAsync({
        id: nanoid(),
        makeMethodId: viaEditor,
        operationOrder: "After Previous",
        procedureId: "",
        assemblyInstructionId: "",
        inspectionDocumentId: "",
        setupUnit: "Total Minutes",
        laborUnit: "Minutes/Piece",
        machineUnit: "Minutes/Piece",
        operationMinimumCost: "0",
        operationUnitCost: "0",
        operationLeadTime: "0",
        ...values
      });
      const { id: _id, ...operation } = form;
      const result = await upsertMethodOperation(client, {
        ...operation,
        companyId: f.companyId,
        createdBy: USER,
        customFields: {}
      });
      expect(result.error).toBeNull();
      operationIds.push(result.data!.id);
    }
    const [machining, assembly] = operationIds as [string, string];

    const steps = [
      {
        operationId: machining,
        name: "Torque",
        description: "Torque to 5 Nm",
        type: "Task",
        sortOrder: "1"
      },
      {
        operationId: assembly,
        name: "Bore",
        description: "Measure the bore",
        type: "Measurement",
        unitOfMeasureCode: "EA",
        minValue: "1",
        maxValue: "2",
        sortOrder: "1"
      }
    ];
    for (const values of steps) {
      const { id: _id, ...step } =
        await operationStepValidator.parseAsync(values);
      const result = await upsertMethodOperationStep(client, {
        ...step,
        companyId: f.companyId,
        createdBy: USER
      });
      expect(result.error).toBeNull();
    }
    {
      const { id: _id, ...tool } = await operationToolValidator.parseAsync({
        operationId: machining,
        toolId: f.itemId("TOOL-1"),
        quantity: "1"
      });
      const result = await upsertMethodOperationTool(client, {
        ...tool,
        companyId: f.companyId,
        createdBy: USER
      });
      expect(result.error).toBeNull();
    }
    {
      const { id: _id, ...parameter } =
        await operationParameterValidator.parseAsync({
          operationId: machining,
          key: "Feed",
          value: "0.2"
        });
      const result = await upsertMethodOperationParameter(client, {
        ...parameter,
        companyId: f.companyId,
        createdBy: USER
      });
      expect(result.error).toBeNull();
    }

    // --- the import, the same content as a CSV ----------------------------
    // No Unit of Measure, Operation Type or Operation Description columns:
    // the import fills them the way the editors do.
    const units = {
      setupUnit: "Total Minutes",
      laborUnit: "Minutes/Piece",
      machineUnit: "Minutes/Piece"
    };
    const summary = await f.run("partWithMethod", [
      ...LINES.map(([componentId, quantity]) => ({
        rowType: "BOM",
        parentId: "TWIN",
        componentId,
        quantity: String(quantity)
      })),
      {
        rowType: "BOP",
        parentId: "TWIN",
        opNo: "1",
        process: "Machining",
        workCenter: "Mill",
        operationDescription: "Mill pocket",
        setupTime: "5",
        laborTime: "2",
        machineTime: "3",
        ...units
      },
      {
        rowType: "BOP",
        parentId: "TWIN",
        opNo: "2",
        process: "Bench Assembly",
        laborTime: "1",
        ...units
      },
      {
        rowType: "STEP",
        parentId: "TWIN",
        opNo: "1",
        stepName: "Torque",
        stepDescription: "Torque to 5 Nm"
      },
      {
        rowType: "STEP",
        parentId: "TWIN",
        opNo: "2",
        stepName: "Bore",
        stepDescription: "Measure the bore",
        stepType: "Measurement",
        stepUnitOfMeasureCode: "EA",
        stepMinValue: "1",
        stepMaxValue: "2"
      },
      {
        rowType: "TOOL",
        parentId: "TWIN",
        opNo: "1",
        toolId: "TOOL-1",
        toolQuantity: "1"
      },
      {
        rowType: "PARAM",
        parentId: "TWIN",
        opNo: "1",
        paramKey: "Feed",
        paramValue: "0.2"
      }
    ]);
    expect(summary.errors).toEqual([]);

    const editor = await snapshot(f.db, viaEditor);
    const imported = await snapshot(f.db, await f.methodOf("TWIN"));
    expect.soft(imported.materials).toEqual(editor.materials);
    expect.soft(imported.operations).toEqual(editor.operations);
    expect.soft(imported.steps).toEqual(editor.steps);
    expect.soft(imported.tools).toEqual(editor.tools);
    expect.soft(imported.parameters).toEqual(editor.parameters);
    // The comparison covers real content, not two empty methods.
    expect(editor.materials).toHaveLength(LINES.length);
    expect(editor.operations).toHaveLength(2);
    expect(editor.steps).toHaveLength(2);
  });
});
