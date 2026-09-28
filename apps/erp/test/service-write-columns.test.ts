import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProgram,
  findLiteralWrites,
  findTypedWrites,
  readTableColumns,
  serviceWriteFiles,
  unknownColumns
} from "./lib/service-write-columns";

// A service write that names a column its table does not have compiles —
// postgrest-js types `.insert()` / `.update()` / `.upsert()` generically — and
// fails at runtime: PostgREST refuses the whole write with PGRST204. Over MCP
// that is a tool that can never succeed (`closeSalesOrder` wrote `closed` for
// its whole life), and behind a form it is a save that silently does nothing
// (the RFQ line mapper's customer-part upsert sent `createdBy`). These guards
// compare every write against the generated `Database` type.

const ROOT = path.resolve(__dirname, "../../..");
const ERP = path.join(ROOT, "apps/erp");
const TYPES = path.join(ROOT, "packages/database/src/types.ts");

const tables = readTableColumns(fs.readFileSync(TYPES, "utf-8"));

const format = (
  hits: ReturnType<typeof unknownColumns>
): string[] =>
  hits.map(
    (h) => `${h.file}:${h.line} ${h.op} "${h.table}" names "${h.column}"`
  );

describe("the reader", () => {
  const types = `
export type Database = {
  public: {
    Tables: {
      widget: {
        Row: { id: string; name: string; createdAt: string }
        Insert: { id?: string; name: string; createdBy: string }
        Update: { id?: string; name?: string; updatedBy?: string }
      }
    }
    Views: {
      widgets: { Row: { id: string; extra: string } }
    }
  }
}`;
  const widgetTables = readTableColumns(types);

  const hitsFor = (source: string) =>
    unknownColumns(findLiteralWrites("widget.service.ts", source), widgetTables);

  it("reads Insert and Update keys per table and skips views", () => {
    expect([...(widgetTables.get("widget")?.insert ?? [])].sort()).toEqual([
      "createdBy",
      "id",
      "name"
    ]);
    expect([...(widgetTables.get("widget")?.update ?? [])].sort()).toEqual([
      "id",
      "name",
      "updatedBy"
    ]);
    expect(widgetTables.has("widgets")).toBe(false);
  });

  it("flags a literal key the table lacks, per operation", () => {
    const hits = hitsFor(`
      export async function closeWidget(client, id, userId) {
        return client.from("widget").update({ closed: true, updatedBy: userId }).eq("id", id);
      }
      export async function stampWidget(client, id, userId) {
        return client.from("widget").update({ createdBy: userId }).eq("id", id);
      }`);
    expect(hits.map((h) => `${h.op}:${h.column}`)).toEqual([
      "update:closed",
      "update:createdBy"
    ]);
  });

  it("follows arrays, conditional spreads and same-function variables", () => {
    const hits = hitsFor(`
      export async function f(client, flag, extra) {
        const row = { name: "a" };
        row.color = "red";
        await client.from("widget").insert([{ name: "a", size: 1 }]);
        await client.from("widget").update({ name: "a", ...(flag ? { weight: 2 } : {}), ...extra });
        await client.from("widget").insert(row);
      }`);
    expect(hits.map((h) => h.column)).toEqual(["size", "weight", "color"]);
  });

  it("ignores writes to tables it does not know and non-literal arguments", () => {
    expect(
      hitsFor(`
        export async function f(client, input) {
          await client.from("widgets").update({ extra: 1 });
          await client.from("widget").update(input);
        }`)
    ).toEqual([]);
  });
});

describe("service writes name only real columns", () => {
  it("in literal writes of ERP module service and server files", () => {
    const writes = serviceWriteFiles(path.join(ERP, "app/modules")).flatMap(
      (file) =>
        findLiteralWrites(
          path.relative(ROOT, file),
          fs.readFileSync(file, "utf-8")
        )
    );
    // The scan is only meaningful while it finds the writes.
    expect(writes.length).toBeGreaterThan(300);
    expect(format(unknownColumns(writes, tables))).toEqual([]);
  });

  it(
    "in every ERP write, by the argument's static type",
    { timeout: 180_000 },
    () => {
      const program = createProgram(path.join(ERP, "tsconfig.json"));
      const app = `${path.join(ERP, "app")}${path.sep}`;
      const writes = findTypedWrites(
        program,
        ROOT,
        (file) =>
          path.resolve(file).startsWith(app) &&
          !file.endsWith(".test.ts") &&
          !file.endsWith(".test.tsx")
      );
      expect(writes.length).toBeGreaterThan(300);
      expect(format(unknownColumns(writes, tables))).toEqual([]);
    }
  );

  it(
    "in every MES write, by the argument's static type",
    { timeout: 180_000 },
    () => {
      const mes = path.join(ROOT, "apps/mes");
      const program = createProgram(path.join(mes, "tsconfig.json"));
      const app = `${path.join(mes, "app")}${path.sep}`;
      const writes = findTypedWrites(
        program,
        ROOT,
        (file) =>
          path.resolve(file).startsWith(app) &&
          !file.endsWith(".test.ts") &&
          !file.endsWith(".test.tsx")
      );
      expect(writes.length).toBeGreaterThan(20);
      expect(format(unknownColumns(writes, tables))).toEqual([]);
    }
  );
});
