// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { defaultsForNewRows, splitRefusedRows } from "./import-report";

describe("splitRefusedRows", () => {
  it("separates empty required values from values that match nothing", () => {
    const report = splitRefusedRows({
      success: true,
      inserted: 2,
      updated: 0,
      skipped: [],
      existingRows: [7],
      errors: [
        { row: 0, reason: "Missing required Part Number" },
        { row: 1, reason: "Name is required" },
        { row: 2, reason: "Op 10: Process is required" },
        { row: 3, reason: "Invalid contact (missing required fields)" },
        { row: 4, reason: 'Supplier "Acme" was not found in this company' },
        { row: 5, reason: "Item BRK-100 rev C not found" },
        { row: 6, reason: "Unit Price must be a number greater than 0" }
      ]
    });
    expect(report.missing.map((issue) => issue.row)).toEqual([0, 1, 2, 3]);
    expect(report.mismatched.map((issue) => issue.row)).toEqual([4, 5, 6]);
    expect(report).toMatchObject({ inserted: 2, updated: 0, defaults: [] });
    expect(report).not.toHaveProperty("errors");
    expect(report).not.toHaveProperty("existingRows");
  });
});

describe("defaultsForNewRows", () => {
  it("counts the defaults of rows that leave a field empty, not of updates", () => {
    const defaults = defaultsForNewRows({
      table: "part",
      rows: [
        { id: "P-1", Name: "Bracket", Replenishment: "" },
        { id: "P-2", Name: "Washer", Replenishment: "Buy" },
        { id: "P-3", Name: "Spacer", Replenishment: "" }
      ],
      columnMappings: {
        id: "id",
        name: "Name",
        replenishmentSystem: "Replenishment"
      },
      enumMappings: {
        replenishmentSystem: { Default: "Buy and Make", Buy: "Buy" },
        defaultMethodType: { Default: "Pull from Inventory" }
      },
      excludedRows: [2]
    });
    expect(defaults).toEqual(
      expect.arrayContaining([
        {
          field: "replenishmentSystem",
          label: "Replenishment System",
          value: "Buy and Make",
          rows: 1
        },
        {
          field: "defaultMethodType",
          label: "Default Method",
          value: "Pull from Inventory",
          rows: 2
        },
        { field: "revision", label: "Revision", value: "0", rows: 2 }
      ])
    );
  });

  it("gives a method file's rows only their own row type's defaults", () => {
    const defaults = defaultsForNewRows({
      table: "partWithMethod",
      rows: [
        { "Row Type": "PART", "Part Number": "A-1" },
        { "Row Type": "BOM", "Parent ID": "A-1", "Material ID": "P-1" }
      ],
      columnMappings: {
        rowType: "Row Type",
        readableId: "Part Number",
        parentId: "Parent ID",
        componentId: "Material ID"
      },
      enumMappings: {
        operationType: { Default: "Process" },
        unitOfMeasureCode: { Default: "EA" },
        replenishmentSystem: { Default: "Buy and Make" }
      },
      excludedRows: []
    });
    const byField = Object.fromEntries(defaults.map((d) => [d.field, d.rows]));
    expect(byField.operationType).toBeUndefined();
    expect(byField.componentRevision).toBeUndefined();
    expect(byField.replenishmentSystem).toBe(1);
    // Unit of Measure belongs to both the part and the BOM line.
    expect(byField.unitOfMeasureCode).toBe(2);
  });
});
