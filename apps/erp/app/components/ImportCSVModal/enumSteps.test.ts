// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { fieldMappings } from "~/modules/shared/imports.models";
import { isColumnMapped, isEnumStepAsked } from "./enumSteps";

const askedSteps = (
  table: keyof typeof fieldMappings,
  columnMappings: Record<string, string>
) =>
  Object.entries(fieldMappings[table])
    .filter(([_, field]) => isEnumStepAsked(field, columnMappings))
    .map(([name]) => name);

describe("isColumnMapped", () => {
  it.each([
    ["Region", true],
    ["", false],
    ["None", false],
    ["N/A", false],
    [undefined, false]
  ])("%s → %s", (column, mapped) => {
    expect(isColumnMapped(column)).toBe(mapped);
  });
});

describe("isEnumStepAsked", () => {
  it("never asks a field that is not an enum", () => {
    expect(isEnumStepAsked({ type: "string" }, {})).toBe(false);
  });

  it("always asks an enum field without askWhenMapped", () => {
    expect(isEnumStepAsked({ type: "enum", enumData: {} }, {})).toBe(true);
  });

  it("asks an enum field with askWhenMapped only while that column is mapped", () => {
    const field = {
      type: "enum",
      enumData: { askWhenMapped: "regionValue" }
    };
    expect(isEnumStepAsked(field, {})).toBe(false);
    expect(isEnumStepAsked(field, { regionValue: "None" })).toBe(false);
    expect(isEnumStepAsked(field, { regionValue: "Region" })).toBe(true);
  });
});

describe("journal entry wizard steps", () => {
  it("asks only for the status when no dimension value column is mapped", () => {
    expect(
      askedSteps("journalEntry", {
        journalReference: "Reference",
        postingDate: "Date",
        accountNumber: "Account",
        debit: "Debit",
        credit: "Credit"
      })
    ).toEqual(["status"]);
  });

  it("asks for a dimension only when its value column is mapped", () => {
    expect(
      askedSteps("journalEntry", {
        dimension1Value: "None",
        dimension2Value: "Region"
      })
    ).toEqual(["status", "dimension2"]);
  });

  it("does not ask for a dimension whose own column is mapped without values", () => {
    expect(askedSteps("journalEntry", { dimension1: "Dimension" })).toEqual([
      "status"
    ]);
  });
});
