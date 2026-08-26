import { describe, expect, it } from "vitest";
import { withRevisionSuffix } from "./revision";

describe("withRevisionSuffix", () => {
  it("leaves the original bare", () => {
    expect(withRevisionSuffix("PO-001042", 0)).toBe("PO-001042");
    expect(withRevisionSuffix("PO-001042", null)).toBe("PO-001042");
    expect(withRevisionSuffix("PO-001042", undefined)).toBe("PO-001042");
  });

  it("suffixes a revision", () => {
    expect(withRevisionSuffix("PO-001042", 1)).toBe("PO-001042-1");
    expect(withRevisionSuffix("Q000001", 12)).toBe("Q000001-12");
  });

  it("returns an empty string for a missing id, even with a revision", () => {
    expect(withRevisionSuffix(null, 2)).toBe("");
    expect(withRevisionSuffix(undefined, 2)).toBe("");
    expect(withRevisionSuffix("", 2)).toBe("");
  });
});
