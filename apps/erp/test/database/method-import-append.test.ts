// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The method import against a real database: it appends BOM lines and
// operations to a make method that already has them, skips what is already
// there, and refuses the versions the BOM and BOP editors refuse. Skips
// without a local database.

import { sql } from "kysely";
import { afterEach, describe, expect } from "vitest";
import { LOCKED_REVISION_MESSAGE } from "../../app/modules/items/items.service";
import { importMethods } from "../../app/modules/shared/shared.service";
import type { MethodRowsAdded } from "../../app/modules/shared/types";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

const USER = "system";

type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * A scratch company with an assembly `ASSY` (Draft v1 from the item
 * interceptor) whose BOM has `COMP-1` and whose BOP has operation 1 (Saw) with
 * the step "Measure". `COMP-2`, `COMP-3` and the process `Machining` exist.
 */
async function fixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `mimp-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const itemId = (readableId: string) => `${prefix}-${readableId}`;
  const processId = `${prefix}-machining`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy: USER })
      .execute();
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: "Machining",
        defaultStandardFactor: "Minutes/Piece",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values(
        ["ASSY", "COMP-1", "COMP-2", "COMP-3"].map((readableId) => ({
          id: itemId(readableId),
          readableId,
          name: readableId,
          type: "Part" as const,
          itemTrackingType: "Inventory" as const,
          unitOfMeasureCode: "EA",
          companyId,
          createdBy: USER
        }))
      )
      .execute();
  });

  const makeMethodId = (
    await db
      .selectFrom("makeMethod")
      .select("id")
      .where("itemId", "=", itemId("ASSY"))
      .where("companyId", "=", companyId)
      .executeTakeFirstOrThrow()
  ).id;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("methodMaterial")
      .values({
        makeMethodId,
        itemId: itemId("COMP-1"),
        itemType: "Part" as const,
        quantity: 1,
        unitOfMeasureCode: "EA",
        order: 1,
        companyId,
        createdBy: USER
      })
      .execute();
    const operation = await trx
      .insertInto("methodOperation")
      .values({
        makeMethodId,
        order: 1,
        processId,
        description: "Saw",
        setupUnit: "Total Minutes",
        laborUnit: "Minutes/Piece",
        machineUnit: "Minutes/Piece",
        companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("methodOperationStep")
      .values({
        operationId: operation.id,
        name: "Measure",
        type: "Task",
        sortOrder: 1,
        companyId,
        createdBy: USER
      })
      .execute();
  });

  return {
    db,
    companyId,
    makeMethodId,
    assyId: itemId("ASSY"),
    async run(
      table: "bom" | "operations" | "partWithMethod",
      mappedRecords: Record<string, string>[]
    ) {
      const summary = {
        inserted: 0,
        updated: 0,
        errors: [] as Array<{ row: number; reason: string }>,
        skipped: [] as Array<{ row: number; reason: string }>,
        added: undefined as MethodRowsAdded | undefined,
        warnings: undefined as string[] | undefined
      };
      await importMethods(db, {
        table,
        mappedRecords,
        companyId,
        userId: USER,
        summary
      });
      return summary;
    },
    async materials(methodId = makeMethodId) {
      const rows = await db
        .selectFrom("methodMaterial")
        .innerJoin("item", "item.id", "methodMaterial.itemId")
        .select([
          "item.readableId",
          "methodMaterial.quantity",
          "methodMaterial.order"
        ])
        .where("methodMaterial.makeMethodId", "=", methodId)
        .where("methodMaterial.companyId", "=", companyId)
        .orderBy("methodMaterial.order")
        .execute();
      return rows.map((r) => ({
        readableId: r.readableId,
        quantity: Number(r.quantity),
        order: Number(r.order)
      }));
    },
    async operations() {
      const rows = await db
        .selectFrom("methodOperation")
        .select(["order", "description"])
        .where("makeMethodId", "=", makeMethodId)
        .where("companyId", "=", companyId)
        .orderBy("order")
        .execute();
      return rows.map((r) => ({
        order: Number(r.order),
        description: r.description
      }));
    },
    async steps() {
      const rows = await db
        .selectFrom("methodOperationStep")
        .innerJoin(
          "methodOperation",
          "methodOperation.id",
          "methodOperationStep.operationId"
        )
        .select([
          "methodOperation.order as operationOrder",
          "methodOperationStep.name",
          "methodOperationStep.sortOrder"
        ])
        .where("methodOperation.makeMethodId", "=", makeMethodId)
        .where("methodOperationStep.companyId", "=", companyId)
        .orderBy("methodOperation.order")
        .orderBy("methodOperationStep.sortOrder")
        .execute();
      return rows.map((r) => ({
        operationOrder: Number(r.operationOrder),
        name: r.name,
        sortOrder: Number(r.sortOrder)
      }));
    },
    async setMethodStatus(status: "Draft" | "Active") {
      await db
        .updateTable("makeMethod")
        .set({ status })
        .where("id", "=", makeMethodId)
        .where("companyId", "=", companyId)
        .execute();
    },
    async setRevisionStatus(revisionStatus: "Design" | "Production") {
      await db
        .updateTable("item")
        .set({ revisionStatus })
        .where("id", "=", itemId("ASSY"))
        .where("companyId", "=", companyId)
        .execute();
    },
    async setReleaseControl(plmReleaseControl: "enforce" | "warn") {
      await db
        .updateTable("companySettings")
        .set({ plmReleaseControl })
        .where("id", "=", companyId)
        .execute();
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}

const bop = (opNo: string, extra: Record<string, string> = {}) => ({
  rowType: "BOP",
  parentId: "ASSY",
  opNo,
  process: "Machining",
  setupUnit: "Total Minutes",
  laborUnit: "Minutes/Piece",
  machineUnit: "Minutes/Piece",
  ...extra
});

const step = (opNo: string, stepName: string) => ({
  rowType: "STEP",
  parentId: "ASSY",
  opNo,
  stepName
});

describe("method import onto an existing method", () => {
  let f: Fixture | undefined;
  afterEach(async () => {
    await f?.cleanup();
    f = undefined;
    // Deleting the scratch company cascades through every company table.
  }, 60_000);

  databaseTest(
    "appends BOM lines after the existing ones and skips materials already on it",
    async () => {
      f = await fixture();
      const summary = await f.run("bom", [
        { parentId: "ASSY", componentId: "COMP-1", quantity: "5" },
        { parentId: "ASSY", componentId: "COMP-2", quantity: "2" },
        { parentId: "ASSY", componentId: "COMP-3", quantity: "3" }
      ]);

      expect(summary.errors).toEqual([]);
      expect(summary.updated).toBe(1);
      expect(summary.added).toEqual({
        materials: 2,
        operations: 0,
        steps: 0,
        tools: 0,
        parameters: 0
      });
      expect(summary.skipped).toEqual([
        {
          row: 0,
          reason:
            "Material COMP-1 rev 0 is already on the BOM of ASSY rev 0; skipped"
        }
      ]);
      expect(await f.materials()).toEqual([
        { readableId: "COMP-1", quantity: 1, order: 1 },
        { readableId: "COMP-2", quantity: 2, order: 2 },
        { readableId: "COMP-3", quantity: 3, order: 3 }
      ]);
    }
  );

  databaseTest(
    "adds operations to a part with a BOM and attaches steps to an existing operation",
    async () => {
      f = await fixture();
      const summary = await f.run("operations", [
        bop("10", { operationDescription: "Mill" }),
        step("10", "Deburr"),
        step("1", "Measure"),
        step("1", "Clean")
      ]);

      expect(summary.errors).toEqual([]);
      expect(summary.updated).toBe(1);
      expect(summary.added).toEqual({
        materials: 0,
        operations: 1,
        steps: 2,
        tools: 0,
        parameters: 0
      });
      expect(summary.skipped).toEqual([
        {
          row: 2,
          reason: 'Op 1 on ASSY rev 0 already has a step named "Measure"; skipped'
        }
      ]);
      expect(await f.operations()).toEqual([
        { order: 1, description: "Saw" },
        { order: 10, description: "Mill" }
      ]);
      expect(await f.steps()).toEqual([
        { operationOrder: 1, name: "Measure", sortOrder: 1 },
        { operationOrder: 1, name: "Clean", sortOrder: 2 },
        { operationOrder: 10, name: "Deburr", sortOrder: 1 }
      ]);
      expect(await f.materials()).toHaveLength(1);
    }
  );

  databaseTest("writes nothing when the same file runs again", async () => {
    f = await fixture();
    const rows: Record<string, string>[] = [
      { rowType: "BOM", parentId: "ASSY", componentId: "COMP-2", quantity: "2" },
      bop("10"),
      step("10", "Deburr"),
      {
        rowType: "PARAM",
        parentId: "ASSY",
        opNo: "10",
        paramKey: "Feed",
        paramValue: "0.2"
      }
    ];
    const first = await f.run("partWithMethod", rows);
    expect(first.errors).toEqual([]);
    expect(first.updated).toBe(1);
    expect(first.added).toEqual({
      materials: 1,
      operations: 1,
      steps: 1,
      tools: 0,
      parameters: 1
    });

    const second = await f.run("partWithMethod", rows);
    expect(second.errors).toEqual([]);
    expect(second.updated).toBe(0);
    expect(second.added).toEqual({
      materials: 0,
      operations: 0,
      steps: 0,
      tools: 0,
      parameters: 0
    });
    expect(second.skipped.map((s) => s.row)).toEqual([0, 1, 2, 3]);
    expect(await f.materials()).toHaveLength(2);
    expect(await f.operations()).toHaveLength(2);
    expect(await f.steps()).toHaveLength(2);
  });

  databaseTest(
    "refuses an Active version and writes into an explicit new Draft",
    async () => {
      f = await fixture();
      await f.setMethodStatus("Active");

      const refused = await f.run("bom", [
        { parentId: "ASSY", componentId: "COMP-2", quantity: "1" }
      ]);
      expect(refused.updated).toBe(0);
      expect(refused.errors).toEqual([
        {
          row: 0,
          reason:
            "Part ASSY rev 0: make method version 1 is Active, and only a Draft version can change. Create a new version, then set Make Method Version to it"
        }
      ]);
      expect(await f.materials()).toHaveLength(1);

      const accepted = await f.run("bom", [
        {
          parentId: "ASSY",
          makeMethodVersion: "2",
          componentId: "COMP-2",
          quantity: "1"
        }
      ]);
      expect(accepted.errors).toEqual([]);
      const draft = await f.db
        .selectFrom("makeMethod")
        .select(["id", "status"])
        .where("itemId", "=", f.assyId)
        .where("companyId", "=", f.companyId)
        .where("version", "=", 2)
        .executeTakeFirstOrThrow();
      expect(draft.status).toBe("Draft");
      expect(await f.materials(draft.id)).toEqual([
        { readableId: "COMP-2", quantity: 1, order: 1 }
      ]);
    }
  );

  databaseTest(
    "follows release control on a released revision",
    async () => {
      f = await fixture();
      await f.setRevisionStatus("Production");
      const rows = [{ parentId: "ASSY", componentId: "COMP-2", quantity: "1" }];

      const refused = await f.run("bom", rows);
      expect(refused.errors).toEqual([
        { row: 0, reason: `Part ASSY rev 0: ${LOCKED_REVISION_MESSAGE}` }
      ]);
      expect(await f.materials()).toHaveLength(1);

      await f.setReleaseControl("warn");
      const accepted = await f.run("bom", rows);
      expect(accepted.errors).toEqual([]);
      expect(accepted.warnings).toEqual([
        `Part ASSY rev 0: ${LOCKED_REVISION_MESSAGE}`
      ]);
      expect(await f.materials()).toHaveLength(2);

      // A re-run writes nothing, so there is nothing to warn about.
      const rerun = await f.run("bom", rows);
      expect(rerun.warnings).toEqual([]);
    }
  );

  databaseTest(
    "rolls back the whole part when one version is refused",
    async () => {
      f = await fixture();
      await f.setMethodStatus("Active");
      const summary = await f.run("bom", [
        {
          parentId: "ASSY",
          makeMethodVersion: "2",
          componentId: "COMP-2",
          quantity: "1"
        },
        { parentId: "ASSY", componentId: "COMP-3", quantity: "1" }
      ]);
      expect(summary.errors).toHaveLength(1);
      expect(summary.updated).toBe(0);
      const versions = await f.db
        .selectFrom("makeMethod")
        .select("version")
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", f.assyId)
        .execute();
      expect(versions.map((v) => Number(v.version))).toEqual([1]);
    }
  );
});
