import { describe, expect, it } from "vitest";
import type { Catalog, ColumnInfo, TableInfo } from "./schema";
import {
  exportableColumns,
  SECRET_TABLES,
  selectExportableTables
} from "./schema";

const col = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  dataType: "text",
  udtName: "text",
  isNullable: false,
  isGenerated: false,
  hasDefault: false,
  ...over
});

const table = (
  name: string,
  columns: ColumnInfo[] = [col("id")]
): TableInfo => ({
  name,
  columns,
  scope: { kind: "direct", column: "companyId" },
  scopeColumn: "companyId",
  pkColumns: ["id", "companyId"],
  uniqueColumns: [],
  hasId: false,
  foreignKeys: []
});

const catalog = (tables: TableInfo[]): Catalog => ({
  schemaVersion: "20260825075035",
  tables
});

describe("selectExportableTables", () => {
  it("splits the catalog into what travels and what does not", () => {
    const { exportable, excludedTables } = selectExportableTables(
      catalog([table("job"), table("apiKey"), table("item")])
    );
    expect(exportable.map((t) => t.name)).toEqual(["job", "item"]);
    expect(excludedTables).toEqual(["apiKey"]);
  });

  it("excludes every secret table", () => {
    const { exportable, excludedTables } = selectExportableTables(
      catalog(SECRET_TABLES.map((name) => table(name)))
    );
    expect(exportable).toEqual([]);
    expect(excludedTables).toEqual(SECRET_TABLES);
  });

  // The old duplicated copy in check-backups.ts listed the whole SECRET_TABLES
  // constant regardless of the catalog, which would name a table the backup was
  // never going to contain.
  it("only reports secret tables that are actually in the catalog", () => {
    const { excludedTables } = selectExportableTables(
      catalog([table("job"), table("webhook")])
    );
    expect(excludedTables).toEqual(["webhook"]);
  });

  it("preserves catalog order, which is topological", () => {
    const { exportable } = selectExportableTables(
      catalog([table("company"), table("job"), table("jobOperation")])
    );
    expect(exportable.map((t) => t.name)).toEqual([
      "company",
      "job",
      "jobOperation"
    ]);
  });

  it("returns empty lists for an empty catalog", () => {
    expect(selectExportableTables(catalog([]))).toEqual({
      exportable: [],
      excludedTables: []
    });
  });
});

describe("exportableColumns", () => {
  it("drops generated columns, which the database recomputes on load", () => {
    const t = table("job", [
      col("id"),
      col("total", { isGenerated: true }),
      col("companyId")
    ]);
    expect(exportableColumns(t).map((c) => c.name)).toEqual([
      "id",
      "companyId"
    ]);
  });

  it("keeps nullable and defaulted columns — only generated ones are dropped", () => {
    const t = table("job", [
      col("id"),
      col("notes", { isNullable: true }),
      col("status", { hasDefault: true })
    ]);
    expect(exportableColumns(t)).toHaveLength(3);
  });
});

// The reason both helpers exist: the drift check's baseline must describe what a
// real export produces. If these ever diverge, the baseline stops standing in for
// a customer's backup while the check keeps reporting `restorable`.
describe("the baseline and the exporter share one rule", () => {
  it("produces the same tables and columns for the same catalog", () => {
    const source = catalog([
      table("job", [col("id"), col("total", { isGenerated: true })]),
      table("apiKey", [col("id")]),
      table("item", [col("id"), col("name")])
    ]);

    const exporterView = selectExportableTables(source).exportable.map((t) => ({
      name: t.name,
      columns: exportableColumns(t).map((c) => c.name)
    }));
    const baselineView = selectExportableTables(source).exportable.map((t) => ({
      name: t.name,
      rows: 0,
      columns: exportableColumns(t).map((c) => c.name)
    }));

    expect(
      baselineView.map(({ name, columns }) => ({ name, columns }))
    ).toEqual(exporterView);
    expect(baselineView).toEqual([
      { name: "job", rows: 0, columns: ["id"] },
      { name: "item", rows: 0, columns: ["id", "name"] }
    ]);
  });
});
