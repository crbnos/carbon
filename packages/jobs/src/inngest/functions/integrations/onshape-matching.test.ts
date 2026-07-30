import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  releaseKey,
  sharedNumberSuffix
} from "./onshape-matching";

// These three pure helpers are the entire Onshape→Carbon matching contract:
// releaseKey joins a released revision to item.readableIdWithRevision, and
// sharedNumberSuffix + escapeLikePattern decide which model item a released
// drawing attaches to. A wrong match here attaches CAD/drawings to the wrong
// part, so the edge cases are pinned rather than left to convention.

describe("releaseKey", () => {
  it("appends the revision with a dot separator", () => {
    expect(releaseKey("PRT-002033", "A")).toBe("PRT-002033.A");
    expect(releaseKey("PRT-002033", "A2")).toBe("PRT-002033.A2");
  });

  it("omits the revision when it is '0' (Carbon's default revision)", () => {
    expect(releaseKey("PRT-002033", "0")).toBe("PRT-002033");
  });

  it("omits the revision when it is empty, null, or undefined", () => {
    expect(releaseKey("PRT-002033", "")).toBe("PRT-002033");
    expect(releaseKey("PRT-002033", null)).toBe("PRT-002033");
    expect(releaseKey("PRT-002033", undefined)).toBe("PRT-002033");
  });
});

describe("sharedNumberSuffix", () => {
  it("strips the leading letter prefix, keeping the separator as the anchor", () => {
    expect(sharedNumberSuffix("DRW-002033")).toBe("-002033");
    expect(sharedNumberSuffix("ASM-002033")).toBe("-002033");
    expect(sharedNumberSuffix("DRW_002033")).toBe("_002033");
  });

  it("gives a drawing and its model the same suffix (the join key)", () => {
    expect(sharedNumberSuffix("DRW-002033")).toBe(
      sharedNumberSuffix("PRT-002033")
    );
  });

  it("returns '' for a part number with no letter prefix (no anchor)", () => {
    // Without a separator anchor, "%002033" would suffix-match the WRONG item
    // (e.g. "PRT-1002033"), so an unanchored number must be skipped entirely.
    expect(sharedNumberSuffix("002033")).toBe("");
  });

  it("returns '' when letters run straight into digits (no separator)", () => {
    expect(sharedNumberSuffix("DRW002033")).toBe("");
  });

  it("returns '' for empty or all-letter part numbers", () => {
    expect(sharedNumberSuffix("")).toBe("");
    expect(sharedNumberSuffix("DRW")).toBe("");
  });
});

describe("escapeLikePattern", () => {
  it("leaves values without wildcards untouched", () => {
    expect(escapeLikePattern("-002033")).toBe("-002033");
  });

  it("escapes % and _ so they match literally", () => {
    expect(escapeLikePattern("_002033")).toBe("\\_002033");
    expect(escapeLikePattern("PRT%33")).toBe("PRT\\%33");
  });

  it("escapes backslashes so they can't form escape sequences", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(escapeLikePattern("_a_%b%")).toBe("\\_a\\_\\%b\\%");
  });
});
