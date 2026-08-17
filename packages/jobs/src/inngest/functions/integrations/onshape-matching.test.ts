import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  isInitialRevision,
  releaseKey,
  selectReleaseTarget,
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

describe("isInitialRevision", () => {
  it("treats '0', '' , null and undefined as the initial revision", () => {
    expect(isInitialRevision("0")).toBe(true);
    expect(isInitialRevision("")).toBe(true);
    expect(isInitialRevision(null)).toBe(true);
    expect(isInitialRevision(undefined)).toBe(true);
  });

  it("treats a named revision as not initial", () => {
    expect(isInitialRevision("A")).toBe(false);
    expect(isInitialRevision("A2")).toBe(false);
  });
});

describe("selectReleaseTarget", () => {
  const row = (
    revision: string | null,
    active: boolean,
    createdAt = "2026-01-01T00:00:00Z"
  ) => ({ revision, active, createdAt });

  it("reports not-found when the part number is unknown to Carbon", () => {
    expect(selectReleaseTarget([], "B")).toEqual({ kind: "not-found" });
  });

  it("reports already-imported when an ACTIVE sibling holds that revision", () => {
    const rows = [row("A", true), row("B", true)];
    expect(selectReleaseTarget(rows, "B")).toEqual({
      kind: "already-imported"
    });
  });

  it("reports already-imported when an INACTIVE draft holds that revision", () => {
    // The draft still occupies item_unique, so re-importing would 23505 and
    // leave an empty change notice behind a marker claiming success.
    const rows = [row("A", true), row("B", false)];
    expect(selectReleaseTarget(rows, "B")).toEqual({
      kind: "already-imported"
    });
  });

  it("never sources from an inactive draft revision", () => {
    // A human cannot pick one: the affected-item picker filters inactive items.
    const rows = [row("A", true), row("B", false)];
    const result = selectReleaseTarget(rows, "C");
    expect(result).toEqual({ kind: "revision", item: rows[0] });
  });

  it("reports not-found when every sibling is inactive", () => {
    expect(selectReleaseTarget([row("A", false)], "B")).toEqual({
      kind: "not-found"
    });
  });

  it("prefers a named revision over the initial one", () => {
    const rows = [row("0", true), row("A", true)];
    expect(selectReleaseTarget(rows, "B")).toEqual({
      kind: "revision",
      item: rows[1]
    });
  });

  it("breaks ties on the newest createdAt", () => {
    const older = row("A", true, "2026-01-01T00:00:00Z");
    const newer = row("B", true, "2026-06-01T00:00:00Z");
    expect(selectReleaseTarget([older, newer], "C")).toEqual({
      kind: "revision",
      item: newer
    });
  });

  it("distinguishes revision '0' from the empty initial revision", () => {
    // Matching the RAW revision column is what makes a numeric Onshape scheme
    // representable — readableIdWithRevision collapses both to no revision.
    expect(selectReleaseTarget([row("", true)], "0")).toEqual({
      kind: "revision",
      item: { revision: "", active: true, createdAt: "2026-01-01T00:00:00Z" }
    });
  });
});
