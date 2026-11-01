// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  addBulkActionCounts,
  bulkActionProblemsBody,
  bulkActionTitle,
  bulkActionTruncatedBody,
  collectRowIds,
  MAX_BULK_PROBLEMS,
  NO_BULK_COUNTS,
  planIdSlices
} from "./bulk";

describe("addBulkActionCounts", () => {
  it("sums each count", () => {
    expect(
      addBulkActionCounts(
        { done: 1, skipped: 2, failed: 3 },
        { done: 10, skipped: 20, failed: 30 }
      )
    ).toEqual({ done: 11, skipped: 22, failed: 33 });
  });

  it("starts from zero", () => {
    expect(
      addBulkActionCounts(NO_BULK_COUNTS, { done: 4, skipped: 0, failed: 1 })
    ).toEqual({ done: 4, skipped: 0, failed: 1 });
  });
});

describe("addBulkActionCounts problems", () => {
  it("keeps every slice's problem lines in order", () => {
    expect(
      addBulkActionCounts(
        { done: 1, skipped: 0, failed: 1, problems: ["J1: no operations"] },
        {
          done: 2,
          skipped: 0,
          failed: 0,
          problems: ["J2 (done): PO failed"],
          problemCount: 1
        }
      )
    ).toEqual({
      done: 3,
      skipped: 0,
      failed: 1,
      problems: ["J1: no operations", "J2 (done): PO failed"],
      problemCount: 2
    });
  });

  it("keeps the first lines and counts the rest", () => {
    const many = Array.from(
      { length: MAX_BULK_PROBLEMS },
      (_, i) => `J${i}: failed`
    );
    const sum = addBulkActionCounts(
      { done: 0, skipped: 0, failed: MAX_BULK_PROBLEMS, problems: many },
      { done: 0, skipped: 0, failed: 5, problems: ["late"], problemCount: 5 }
    );
    expect(sum.problems).toEqual(many);
    expect(sum.problemCount).toBe(MAX_BULK_PROBLEMS + 5);
    expect(bulkActionProblemsBody(sum)).toMatch(/\nand 5 more$/);
  });

  it("has no body without problems", () => {
    expect(
      bulkActionProblemsBody({ done: 3, skipped: 0, failed: 0 })
    ).toBeUndefined();
  });
});

describe("collectRowIds", () => {
  it("reads the id column and keeps the page order", () => {
    const ids = new Set<string>();
    collectRowIds(ids, [{ itemId: "b" }, { itemId: "a" }], "itemId");
    expect([...ids]).toEqual(["b", "a"]);
  });

  it("drops rows without an id and ids it already holds", () => {
    const ids = new Set<string>(["a"]);
    collectRowIds(
      ids,
      [{ id: "a" }, { id: null }, { id: "" }, {}, { id: 7 }, { id: "c" }],
      "id"
    );
    expect([...ids]).toEqual(["a", "7", "c"]);
  });
});

describe("bulkActionTitle", () => {
  it("names the action and every count", () => {
    expect(
      bulkActionTitle("Release jobs", { done: 1200, skipped: 3, failed: 0 })
    ).toBe("Release jobs finished: 1,200 done, 3 skipped, 0 failed");
  });
});

describe("bulkActionTruncatedBody", () => {
  it("names the action's own row limit", () => {
    expect(bulkActionTruncatedBody(2000)).toContain("first 2,000");
  });
});

describe("planIdSlices", () => {
  it("cuts each file into slices of at most idsPerStep", () => {
    expect(planIdSlices([2500, 10], 1000)).toEqual([
      { file: 0, start: 0, end: 1000 },
      { file: 0, start: 1000, end: 2000 },
      { file: 0, start: 2000, end: 2500 },
      { file: 1, start: 0, end: 10 }
    ]);
  });

  it("skips an empty file", () => {
    expect(planIdSlices([0, 3], 25)).toEqual([{ file: 1, start: 0, end: 3 }]);
  });
});
