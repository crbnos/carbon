// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildItemIndex, numberCell, resolveItem } from "./existing-item";

const index = buildItemIndex([
  { id: "part-0", readableId: "BRK-100", revision: "0", type: "Part" },
  { id: "part-b", readableId: "BRK-100", revision: "B", type: "Part" },
  // Stored with an empty revision: still the initial revision.
  { id: "mat-0", readableId: "SHEET-2", revision: "", type: "Material" },
  // Same key, two types.
  { id: "part-x", readableId: "KIT-7", revision: "0", type: "Part" },
  { id: "tool-x", readableId: "KIT-7", revision: "0", type: "Tool" },
  { id: "svc-1", readableId: "ANODIZE", revision: "0", type: "Service" }
]);

const ALL = ["Part", "Material", "Tool", "Consumable", "Service"];

describe("resolveItem", () => {
  it("reads a blank revision as 0, and matches a stored empty revision", () => {
    expect(resolveItem(index, { readableId: " BRK-100 " }, ALL)).toEqual({
      itemId: "part-0",
      readableId: "BRK-100",
      revision: "0"
    });
    expect(
      resolveItem(index, { readableId: "SHEET-2", revision: "" }, ALL)
    ).toMatchObject({ itemId: "mat-0" });
    expect(
      resolveItem(index, { readableId: "BRK-100", revision: "B" }, ALL)
    ).toMatchObject({ itemId: "part-b" });
  });

  it("reports a missing part number and an unknown item", () => {
    expect(resolveItem(index, { readableId: "" }, ALL)).toEqual({
      error: "Missing required Part Number"
    });
    expect(
      resolveItem(index, { readableId: "BRK-100", revision: "C" }, ALL)
    ).toEqual({ error: "Item BRK-100 rev C not found" });
  });

  it("refuses a key that names items of more than one accepted type", () => {
    expect(resolveItem(index, { readableId: "KIT-7" }, ALL)).toEqual({
      error: "Part number KIT-7 rev 0 matches more than one item: Part, Tool"
    });
  });

  it("only looks at the types the import accepts", () => {
    expect(resolveItem(index, { readableId: "KIT-7" }, ["Part"])).toMatchObject(
      { itemId: "part-x" }
    );
    expect(resolveItem(index, { readableId: "ANODIZE" }, ["Part"])).toEqual({
      error: "Item ANODIZE rev 0 is a Service; this import takes Part items"
    });
  });
});

describe("numberCell", () => {
  it("is undefined for a blank cell and NaN for text", () => {
    expect(numberCell(undefined)).toBeUndefined();
    expect(numberCell("  ")).toBeUndefined();
    expect(numberCell(" 12.5 ")).toBe(12.5);
    expect(numberCell("0")).toBe(0);
    expect(numberCell("1,000")).toBeNaN();
    expect(numberCell("Infinity")).toBeNaN();
  });
});
