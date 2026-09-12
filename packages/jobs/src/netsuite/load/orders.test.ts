import { describe, expect, it } from "vitest";

import { numericSuffix } from "./orders";

describe("numericSuffix", () => {
  it("reads the trailing number out of a document number", () => {
    expect(numericSuffix("SO-001234")).toBe(1234);
    expect(numericSuffix("1042")).toBe(1042);
    expect(numericSuffix("PO2026-0007")).toBe(7);
    expect(numericSuffix("  SO99  ")).toBe(99);
  });

  it("returns null when there is no number to advance a sequence past", () => {
    expect(numericSuffix("DRAFT")).toBeNull();
    expect(numericSuffix("")).toBeNull();
  });

  it("takes the trailing digits even from a scheme that is mostly letters", () => {
    // `SO-2026-Q1` yields 1, not null. That is the useful answer: the sequence
    // only has to end up ABOVE every migrated number, and Carbon's own numbers
    // carry their own prefix, so they cannot collide with this scheme anyway.
    expect(numericSuffix("SO-2026-Q1")).toBe(1);
  });

  it("refuses a number too large to be a safe integer", () => {
    // A 20-digit "document number" is not a sequence position, and rounding it
    // into a float would set the sequence to a value nothing can reach.
    expect(numericSuffix("SO-99999999999999999999")).toBeNull();
  });
});
