// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The method import refuses what the BOM and Bill of Process editors refuse,
// and two imports of one file at the same time write each line once. Runs
// against the local database; skips without one.

import { sql } from "kysely";
import { afterEach, describe, expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import {
  type MethodImportFixture,
  methodImportFixture
} from "./fixtures/method-import";

type Rows = Record<string, string>[];

// Resolves once another session of this database waits on a row lock.
async function waitForLockWait(
  db: Awaited<ReturnType<typeof connectLocalTestDatabase>>
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await sql<{ waiting: number }>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%for update%'`.execute(db);
    if (rows[0]!.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The import never waited for the row lock");
}

const bom = (
  parentId: string,
  componentId: string,
  quantity: string,
  extra: Record<string, string> = {}
) => ({ rowType: "BOM", parentId, componentId, quantity, ...extra });

const bop = (
  parentId: string,
  opNo: string,
  extra: Record<string, string> = {}
) => ({
  rowType: "BOP",
  parentId,
  opNo,
  process: "Machining",
  setupUnit: "Total Minutes",
  laborUnit: "Minutes/Piece",
  machineUnit: "Minutes/Piece",
  ...extra
});

// Each file and the reasons the import gives for it. ASSY, SUB and COMP-2
// start with empty Draft methods, and none of them may change.
const REFUSALS: Array<[string, Rows, string[]]> = [
  [
    "the part itself as a BOM line",
    [bom("ASSY", "ASSY", "1")],
    [
      "Material ASSY rev 0 is the part itself; an item cannot be added to its own BOM"
    ]
  ],
  [
    "a service and a tool as BOM lines",
    [bom("ASSY", "SVC", "1"), bom("ASSY", "TOOL-1", "1")],
    [
      "Material SVC rev 0 is a Service; a BOM line takes a Part, Material or Consumable",
      "Material TOOL-1 rev 0 is a Tool; a BOM line takes a Part, Material or Consumable"
    ]
  ],
  [
    "a negative quantity",
    [bom("ASSY", "COMP-1", "-3")],
    ["BOM row Quantity must be a number of 0 or more"]
  ],
  [
    "a part as a tool, with quantity 0",
    [
      bop("COMP-2", "10"),
      {
        rowType: "TOOL",
        parentId: "COMP-2",
        opNo: "10",
        toolId: "COMP-1",
        toolQuantity: "0"
      }
    ],
    [
      "Tool COMP-1 rev 0 is a Part, not a Tool",
      "TOOL row Quantity must be a number above 0"
    ]
  ],
  [
    "a negative time, a minimum above the maximum and an empty list",
    [
      bop("SUB", "10", { setupTime: "-5" }),
      {
        rowType: "STEP",
        parentId: "SUB",
        opNo: "10",
        stepName: "Gauge",
        stepType: "Measurement",
        stepUnitOfMeasureCode: "EA",
        stepMinValue: "10",
        stepMaxValue: "2"
      },
      {
        rowType: "STEP",
        parentId: "SUB",
        opNo: "10",
        stepName: "Pick",
        stepType: "List",
        stepListValues: "|"
      }
    ],
    [
      "Op 10: Setup Time must be a number of 0 or more",
      "Step Max Value must be greater than or equal to Step Min Value",
      "List step requires Step List Values"
    ]
  ],
  [
    "an Inspection operation, from its process's type",
    [bop("SUB", "10", { process: "Final Check" })],
    [
      "Op 10: an Inspection operation needs an Inspection Plan; add it in the app"
    ]
  ],
  [
    "an Op No that is not a number, and one Op No given twice",
    [bop("SUB", "Deburr"), bop("SUB", "10"), bop("SUB", "10.0")],
    [
      'BOP row Op No "Deburr" must be a number of 0 or more',
      'Duplicate Op No "10.0" for SUB rev 0'
    ]
  ],
  [
    "a version that is not a number",
    [bom("ASSY", "COMP-1", "1", { makeMethodVersion: "abc" })],
    [
      'Make Method Version "abc" must be a number above 0 with at most 2 decimals'
    ]
  ],
  [
    "a version with more decimals than the column keeps",
    [bom("ASSY", "COMP-1", "1", { makeMethodVersion: "1.555" })],
    [
      'Make Method Version "1.555" must be a number above 0 with at most 2 decimals'
    ]
  ]
];

describe("method import guards", () => {
  let f: MethodImportFixture | undefined;
  afterEach(async () => {
    await f?.cleanup();
    f = undefined;
    // Deleting the scratch company cascades through every company table.
  }, 60_000);

  const rowCounts = async () => {
    const count = async (
      table: "methodMaterial" | "methodOperation" | "methodOperationStep"
    ) =>
      Number(
        (
          await f!.db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll().as("count"))
            .where("companyId", "=", f!.companyId)
            .executeTakeFirstOrThrow()
        ).count
      );
    return {
      materials: await count("methodMaterial"),
      operations: await count("methodOperation"),
      steps: await count("methodOperationStep")
    };
  };

  databaseTest(
    "refuses the rows the editors refuse and writes nothing",
    async () => {
      f = await methodImportFixture();
      for (const [, rows, reasons] of REFUSALS) {
        const table = rows.some((r) => r.rowType !== "BOM")
          ? "operations"
          : "bom";
        const summary = await f.run(table, rows);
        expect(summary.errors.map((e) => e.reason)).toEqual(reasons);
        expect(summary.updated).toBe(0);
      }
      expect(await rowCounts()).toEqual({
        materials: 0,
        operations: 0,
        steps: 0
      });
    }
  );

  databaseTest(
    "a BOM line without a unit takes the material's own unit",
    async () => {
      f = await methodImportFixture();
      const summary = await f.run("bom", [bom("TWIN", "MAT-YD", "2")]);
      expect(summary.errors).toEqual([]);
      const line = await f.db
        .selectFrom("methodMaterial")
        .select("unitOfMeasureCode")
        .where("makeMethodId", "=", await f.methodOf("TWIN"))
        .executeTakeFirstOrThrow();
      expect(line.unitOfMeasureCode).toBe("YD");
    }
  );

  databaseTest(
    "an Op No written another way names the same operation on a re-run",
    async () => {
      f = await methodImportFixture();
      const step = (opNo: string) => ({
        rowType: "STEP",
        parentId: "SUB",
        opNo,
        stepName: "Deburr"
      });
      const first = await f.run("operations", [bop("SUB", "10"), step("10")]);
      expect(first.errors).toEqual([]);
      const again = await f.run("operations", [bop("SUB", "010"), step("10.0")]);
      expect(again.errors).toEqual([]);
      expect(again.updated).toBe(0);
      expect(again.skipped).toHaveLength(2);
      expect(await rowCounts()).toEqual({
        materials: 0,
        operations: 1,
        steps: 1
      });
    }
  );

  databaseTest(
    "refuses a Draft held by a change notice in Implementation",
    async () => {
      f = await methodImportFixture();
      const changeOrderId = `${f.companyId}-notice`;
      await f.db
        .insertInto("changeOrder")
        .values({
          id: changeOrderId,
          changeOrderId: "CN-TEST",
          name: "Test notice",
          openDate: "2026-10-21",
          status: "Implementation",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .updateTable("makeMethod")
        .set({ changeOrderId })
        .where("id", "=", await f.methodOf("ASSY"))
        .where("companyId", "=", f.companyId)
        .execute();
      const summary = await f.run("bom", [bom("ASSY", "COMP-1", "1")]);
      expect(summary.errors).toEqual([
        {
          row: 0,
          reason:
            "Part ASSY rev 0: This change notice is being implemented, so its changes are locked. Reopen it to make changes."
        }
      ]);
      expect((await rowCounts()).materials).toBe(0);
    }
  );

  databaseTest(
    "refuses a Draft an editor activates while the import waits for it",
    async () => {
      f = await methodImportFixture();
      const companyId = f.companyId;
      const makeMethodId = await f.methodOf("ASSY");
      const editor = await connectLocalTestDatabase();
      const watcher = await connectLocalTestDatabase();
      let commit = () => {};
      const committed = new Promise<void>((resolve) => {
        commit = resolve;
      });
      let holding = () => {};
      const held = new Promise<void>((resolve) => {
        holding = resolve;
      });
      // The editor activates the Draft and keeps its row lock until commit.
      const activate = editor.transaction().execute(async (trx) => {
        await trx
          .updateTable("makeMethod")
          .set({ status: "Active" })
          .where("id", "=", makeMethodId)
          .where("companyId", "=", companyId)
          .execute();
        holding();
        await committed;
      });
      try {
        await held;
        // The import reads the version as a Draft, then waits for the lock.
        const run = f.run("bom", [bom("ASSY", "COMP-1", "1")]);
        await waitForLockWait(watcher);
        commit();
        await activate;
        const summary = await run;
        expect(summary.errors.map((e) => e.reason)).toEqual([
          "Part ASSY rev 0: make method version 1 is Active, and only a Draft version can change. Create a new version, then set Make Method Version to it"
        ]);
        expect((await rowCounts()).materials).toBe(0);
      } finally {
        commit();
        await activate.catch(() => {});
        await editor.destroy();
        await watcher.destroy();
      }
    }
  );

  databaseTest(
    "counts a part as created only when its PART row created it",
    async () => {
      f = await methodImportFixture();
      const part = {
        rowType: "PART",
        readableId: "NEW-1",
        name: "New assembly"
      };
      const line = (componentId: string) => ({
        rowType: "BOM",
        parentId: "NEW-1",
        componentId,
        quantity: "2"
      });

      const created = await f.run("partWithMethod", [part, line("COMP-1")]);
      expect(created.errors).toEqual([]);
      expect([created.inserted, created.updated]).toEqual([1, 0]);
      expect(created.skipped).toEqual([]);

      const again = await f.run("partWithMethod", [part, line("COMP-1")]);
      expect(again.errors).toEqual([]);
      expect([again.inserted, again.updated]).toEqual([0, 0]);
      expect(again.skipped.map((s) => s.reason)).toEqual([
        "Part NEW-1 rev 0 already exists; its PART row changes nothing",
        "Material COMP-1 rev 0 is already on the BOM of NEW-1 rev 0; skipped"
      ]);

      const more = await f.run("partWithMethod", [part, line("COMP-2")]);
      expect(more.errors).toEqual([]);
      expect([more.inserted, more.updated]).toEqual([0, 1]);
      expect(more.added?.materials).toBe(1);
    }
  );

  databaseTest(
    "two imports that create the same version at the same time create it once",
    async () => {
      f = await methodImportFixture();
      const second = await connectLocalTestDatabase();
      try {
        const rows = [
          bom("ASSY", "COMP-1", "1", { makeMethodVersion: "2" }),
          bom("ASSY", "COMP-2", "2", { makeMethodVersion: "2" })
        ];
        const [a, b] = await Promise.all([
          f.run("bom", rows),
          f.run("bom", rows, second)
        ]);
        expect([...a.errors, ...b.errors]).toEqual([]);
        expect(a.updated + b.updated).toBe(1);
        expect(a.skipped.length + b.skipped.length).toBe(2);
        const versions = await f.db
          .selectFrom("makeMethod")
          .select("version")
          .where("itemId", "=", f.itemId("ASSY"))
          .where("companyId", "=", f.companyId)
          .orderBy("version")
          .execute();
        expect(versions.map((v) => Number(v.version))).toEqual([1, 2]);
        expect((await rowCounts()).materials).toBe(2);
      } finally {
        await second.destroy();
      }
    }
  );

  databaseTest(
    "two imports of one file at the same time write each line once",
    async () => {
      f = await methodImportFixture();
      const second = await connectLocalTestDatabase();
      try {
        const rows = [bom("ASSY", "COMP-1", "1"), bom("ASSY", "COMP-2", "2")];
        const [a, b] = await Promise.all([
          f.run("bom", rows),
          f.run("bom", rows, second)
        ]);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
        expect(a.updated + b.updated).toBe(1);
        expect(a.skipped.length + b.skipped.length).toBe(2);
        expect((await rowCounts()).materials).toBe(2);
      } finally {
        await second.destroy();
      }
    }
  );
});
