// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { CONFIGS, parseCsvNonNettable } from "./shared.service";

it("unit of measure requires both a code and a name", () => {
  expect(CONFIGS.unitOfMeasure.validate({ code: "", name: "Each" })).toEqual(
    "Code is required"
  );
  expect(CONFIGS.unitOfMeasure.validate({ code: "EA", name: "  " })).toEqual(
    "Name is required"
  );
  expect(CONFIGS.unitOfMeasure.validate({ code: "EA", name: "Each" })).toEqual(
    null
  );
});

it("unit of measure enforces the same lengths the form does", () => {
  expect(
    CONFIGS.unitOfMeasure.validate({ code: "X".repeat(11), name: "Each" })
  ).toEqual("Code must be 10 characters or fewer");
  expect(
    CONFIGS.unitOfMeasure.validate({ code: "EA", name: "X".repeat(51) })
  ).toEqual("Name must be 50 characters or fewer");
});

// unitOfMeasure has UNIQUE (code, companyId) AND UNIQUE (name, companyId).
// Dedup on the code alone would let a row with a fresh code but a taken name
// through, where ON CONFLICT DO NOTHING would drop it with no reported reason.
it("unit of measure dedups on code and name", () => {
  const existing = CONFIGS.unitOfMeasure.keysOfExisting({
    name: "Each",
    code: "EA"
  });
  const sameNameNewCode = CONFIGS.unitOfMeasure.keysOf({
    code: "EACH",
    name: "each"
  });
  expect(sameNameNewCode.some((k) => existing.includes(k))).toEqual(true);
});

it("name-keyed lookups match case- and whitespace-insensitively", () => {
  for (const table of ["storageType", "scrapReason", "department"] as const) {
    expect(CONFIGS[table].keysOf({ name: "  Cold Storage " })).toEqual(
      CONFIGS[table].keysOfExisting({ name: "cold storage" })
    );
  }
});

it("optional columns are omitted rather than written blank", () => {
  expect(CONFIGS.itemPostingGroup.values({ name: "Finished Goods" })).toEqual({
    name: "Finished Goods"
  });
  expect(
    CONFIGS.itemPostingGroup.values({
      name: "Finished Goods",
      description: "  "
    })
  ).toEqual({ name: "Finished Goods" });
  expect(
    CONFIGS.itemPostingGroup.values({
      name: " Finished Goods ",
      description: " Sellable "
    })
  ).toEqual({ name: "Finished Goods", description: "Sellable" });
});

// Only `department` carries a parent; the second pass in `importConfigLookups`
// is gated on this field, so a stray one would start resolving parent names
// against a table that has no parent column.
it("department is the only table with a parent pass", () => {
  const withParent = (
    Object.keys(CONFIGS) as Array<keyof typeof CONFIGS>
  ).filter((table) => CONFIGS[table].parentField);
  expect(withParent).toEqual(["department"]);
});

it.each([
  ["true", true],
  ["Yes", true],
  ["1", true],
  ["false", false],
  ["no", false],
  ["0", false],
  ["", undefined],
  ["maybe", "invalid"]
])("reads a Non-nettable cell %j as %j", (cell, expected) => {
  expect(parseCsvNonNettable(cell)).toBe(expected);
});

it("refuses a storage type row whose Non-nettable cell is not true or false", () => {
  expect(
    CONFIGS.storageType.validate({ name: "Quarantine", nonNettable: "maybe" })
  ).toEqual("Non-nettable must be true or false");
});

it("imports a storage type as non-nettable only when the cell says so", () => {
  expect(
    CONFIGS.storageType.values({ name: " Quarantine ", nonNettable: "yes" })
  ).toEqual({ name: "Quarantine", nettable: false });
  expect(
    CONFIGS.storageType.values({ name: "Shelf", nonNettable: "" })
  ).toEqual({ name: "Shelf" });
});
