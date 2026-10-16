// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { splitRefusedRows } from "./import-report";

describe("splitRefusedRows", () => {
  it("separates empty required values from values that match nothing", () => {
    const report = splitRefusedRows({
      success: true,
      inserted: 2,
      updated: 0,
      skipped: [],
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
    expect(report).toMatchObject({ inserted: 2, updated: 0, skipped: [] });
    expect(report).not.toHaveProperty("errors");
  });
});
