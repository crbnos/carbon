import { describe, expect, it } from "vitest";
import { compareRevisions } from "./revision";

const sorted = (values: Array<string | null>) =>
  [...values].sort(compareRevisions);

describe("compareRevisions", () => {
  it("orders numbers numerically", () => {
    expect(sorted(["10", "9", "2", "0"])).toEqual(["0", "2", "9", "10"]);
  });

  it("orders letters by length, then alphabetically", () => {
    expect(sorted(["AA", "Y", "B", "AB", "A"])).toEqual([
      "A",
      "B",
      "Y",
      "AA",
      "AB"
    ]);
  });

  it("puts numbers before letters and empty first", () => {
    expect(sorted(["A", "0", null, "1"])).toEqual([null, "0", "1", "A"]);
  });

  it("ignores leading zeros when comparing numbers", () => {
    expect(compareRevisions("11", "010")).toBeGreaterThan(0);
    expect(compareRevisions("9", "010")).toBeLessThan(0);
  });

  it("sorts other schemes after both, naturally", () => {
    expect(sorted(["A10", "A2", "Z"])).toEqual(["Z", "A2", "A10"]);
  });
});
