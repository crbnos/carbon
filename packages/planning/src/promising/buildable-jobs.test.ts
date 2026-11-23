// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { coverJobs, type OpenJob } from "./buildable-jobs.ts";

// A job for 1, due on the given day of January, that still has to issue `needs`.
const job = (
  readableId: string,
  day: number | null,
  needs: Record<string, number>,
  overrides: Partial<OpenJob> = {}
): OpenJob => ({
  id: readableId,
  readableId,
  status: "In Progress",
  dueDate: day === null ? null : `2026-01-${String(day).padStart(2, "0")}`,
  priority: null,
  quantityRemaining: 1,
  materials: Object.entries(needs).map(([itemId, quantityToIssue]) => ({
    itemId,
    quantityToIssue,
    unitOfMeasureCode: "EA"
  })),
  ...overrides
});

const cover = (jobs: OpenJob[], stock: Record<string, number>) =>
  coverJobs({ jobs, stock: (itemId) => stock[itemId] ?? 0 });

const summary = (result: ReturnType<typeof coverJobs>) =>
  result.jobs.map((j) => [j.readableId, j.hasAllParts, j.shortItems]);

describe("coverJobs", () => {
  it("covers the most urgent jobs until the stock runs out", () => {
    const result = cover(
      [job("C", 3, { A: 2 }), job("A", 1, { A: 2 }), job("B", 2, { A: 2 })],
      { A: 5 }
    );
    expect(summary(result)).toEqual([
      ["A", true, 0],
      ["B", true, 0],
      ["C", false, 1]
    ]);
    // 5 − 2 − 2 leaves 1 of the 2 that C needs.
    expect(result.shortages).toEqual([
      { itemId: "A", quantityShort: 1, jobs: 1 }
    ]);
  });

  it("counts a job with nothing left to issue as having its parts", () => {
    const result = cover([job("A", 1, {}), job("B", 2, { A: 0 })], {});
    expect(summary(result)).toEqual([
      ["A", true, 0],
      ["B", true, 0]
    ]);
    expect(result.shortages).toEqual([]);
  });

  it("does not let a job it cannot finish hold stock back from one it can", () => {
    // A is due first but has no B at all. Its A must not block job B.
    const result = cover([job("A", 1, { A: 3, B: 1 }), job("B", 2, { A: 3 })], {
      A: 3
    });
    expect(summary(result)).toEqual([
      ["A", false, 2],
      ["B", true, 0]
    ]);
    expect(result.shortages).toEqual([
      { itemId: "A", quantityShort: 3, jobs: 1 },
      { itemId: "B", quantityShort: 1, jobs: 1 }
    ]);
  });

  it("adds up what several jobs lack of one item, after the stock that is left", () => {
    const result = cover(
      [
        job("A", 1, { A: 4, B: 1 }),
        job("B", 2, { A: 4, B: 1 }),
        job("C", 3, { C: 1 })
      ],
      { A: 6, B: 5, C: 0 }
    );
    expect(summary(result)).toEqual([
      ["A", true, 0],
      ["B", false, 1],
      ["C", false, 1]
    ]);
    expect(result.shortages).toEqual([
      // B needs 4 and 2 are left.
      { itemId: "A", quantityShort: 2, jobs: 1 },
      { itemId: "C", quantityShort: 1, jobs: 1 }
    ]);
  });

  it("counts an item a more urgent waiting job used up as short for the next one", () => {
    // Neither can finish. A takes the 1 A in stock, so B lacks A as well as C.
    const result = cover(
      [job("A", 1, { A: 2, B: 1 }), job("B", 2, { A: 1, C: 1 })],
      { A: 1 }
    );
    expect(summary(result)).toEqual([
      ["A", false, 2],
      ["B", false, 2]
    ]);
    expect(result.shortages).toEqual([
      { itemId: "A", quantityShort: 2, jobs: 2 },
      { itemId: "B", quantityShort: 1, jobs: 1 },
      { itemId: "C", quantityShort: 1, jobs: 1 }
    ]);
  });

  it("puts the item most jobs wait on first", () => {
    const result = cover(
      [job("A", 1, { A: 1, B: 9 }), job("B", 2, { A: 1 })],
      {}
    );
    expect(result.shortages.map((s) => [s.itemId, s.jobs])).toEqual([
      ["A", 2],
      ["B", 1]
    ]);
  });

  it("adds the lines of one job for the same item", () => {
    const result = cover(
      [
        job(
          "A",
          1,
          {},
          {
            materials: [
              { itemId: "A", quantityToIssue: 2, unitOfMeasureCode: "EA" },
              { itemId: "A", quantityToIssue: 2, unitOfMeasureCode: "EA" }
            ]
          }
        )
      ],
      { A: 3 }
    );
    expect(result.shortages).toEqual([
      { itemId: "A", quantityShort: 1, jobs: 1 }
    ]);
  });

  it("orders jobs with no due date last, then by priority", () => {
    const result = cover(
      [
        job("C", null, {}),
        job("B", 5, {}, { priority: 2 }),
        job("A", 5, {}, { priority: 1 }),
        job("D", 1, {})
      ],
      {}
    );
    expect(result.jobs.map((j) => j.readableId)).toEqual(["D", "A", "B", "C"]);
  });
});
