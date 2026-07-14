import { describe, expect, it } from "vitest";
import { nameSimilarity, tokenizeName } from "./assembly-units";

describe("tokenizeName", () => {
  it("lowercases and splits on punctuation, keeping dots", () => {
    expect([...tokenizeName("Flanged Screw, M4x10")].sort()).toEqual([
      "flanged",
      "m4x10",
      "screw"
    ]);
    expect([...tokenizeName("R_0402_1.5k")].sort()).toEqual([
      "0402",
      "1.5k",
      "r"
    ]);
  });
});

describe("nameSimilarity", () => {
  it("scores identical names 1 and disjoint names 0", () => {
    expect(nameSimilarity("Seal Electronics Box", "Seal Electronics Box")).toBe(
      1
    );
    expect(nameSimilarity("Bracket", "Washer")).toBe(0);
    expect(nameSimilarity("", "Washer")).toBe(0);
  });

  it("scores partial token overlap between CAD and BOM names", () => {
    const score = nameSimilarity("Seal Electronics Box", "Electronics Box Lid");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1);
  });
});
