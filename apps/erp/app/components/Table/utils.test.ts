import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { buildColumnMaps } from "./utils";

type Row = {
  id: string;
  supplierTypeId: string;
  type: string;
  tags: string[];
};

const upper = (value: string) => value.toUpperCase();

const cols = (...columns: ColumnDef<Row, unknown>[]) => columns;

describe("buildColumnMaps", () => {
  it("keeps today's behavior: accessorKey + string header -> accessors + sortKey", () => {
    const { accessors, exportValues, sortKeyToLabel } = buildColumnMaps(
      cols({ accessorKey: "type", header: "Type" }),
      upper
    );
    expect(accessors).toEqual({ type: "TYPE" });
    expect(exportValues).toEqual({});
    expect(sortKeyToLabel).toEqual({ type: "TYPE" });
  });

  it("throws when an accessorKey contains an underscore", () => {
    expect(() =>
      buildColumnMaps(cols({ accessorKey: "a_b", header: "X" }), upper)
    ).toThrow(/Cannot contain '_'/);
  });

  it("includes a display column (id, no accessor) that has exportValue", () => {
    const exportValue = (row: Row) => row.tags.join(", ");
    const { accessors, exportValues, sortKeyToLabel } = buildColumnMaps(
      cols({ id: "labels", header: "Labels", meta: { exportValue } }),
      upper
    );
    expect(accessors).toEqual({ labels: "LABELS" });
    expect(exportValues.labels).toBe(exportValue);
    // a display column is not sortable on the server
    expect(sortKeyToLabel).toEqual({});
  });

  it("uses filterHeader as the export label for a JSX-header column", () => {
    const exportValue = (row: Row) => row.type;
    const { accessors, sortKeyToLabel } = buildColumnMaps(
      cols({
        id: "week1",
        header: () => null,
        meta: { filterHeader: "Week 1", exportValue }
      }),
      upper
    );
    expect(accessors).toEqual({ week1: "WEEK 1" });
    // JSX-header columns never enter the sort picker
    expect(sortKeyToLabel).toEqual({});
  });

  it("falls back to filterHeader when the string header is empty", () => {
    const exportValue = (row: Row) => row.type;
    const { accessors, sortKeyToLabel } = buildColumnMaps(
      cols({
        accessorKey: "type",
        header: "",
        meta: { filterHeader: "Unit of Measure", exportValue }
      }),
      upper
    );
    expect(accessors).toEqual({ type: "UNIT OF MEASURE" });
    // an empty string header still yields a (blank) sort-picker label, unchanged
    expect(sortKeyToLabel).toEqual({ type: "" });
  });

  it("ignores a JSX-header column with no exportValue and no filterHeader", () => {
    const { accessors, exportValues, sortKeyToLabel } = buildColumnMaps(
      cols({ id: "week1", header: () => null }),
      upper
    );
    expect(accessors).toEqual({});
    expect(exportValues).toEqual({});
    expect(sortKeyToLabel).toEqual({});
  });

  it("decouples sort/export from the accessor (supplier-type class)", () => {
    const exportValue = (row: Row) => row.type;
    const { accessors, exportValues, sortKeyToLabel } = buildColumnMaps(
      cols({
        accessorKey: "supplierTypeId",
        header: "Type",
        meta: { sortBy: "type", exportValue }
      }),
      upper
    );
    // value + filter stay on the id; export + sort move to the name
    expect(accessors).toEqual({ supplierTypeId: "TYPE" });
    expect(exportValues.supplierTypeId).toBe(exportValue);
    expect(sortKeyToLabel).toEqual({ type: "TYPE" });
  });
});
