// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  calculatePrioritiesByWorkCenter,
  committedDueDate,
  sortOperationsByPriority
} from "./priority-calculator.ts";
import type { OperationWithJobInfo } from "./types.ts";

const op = (
  id: string,
  projectedCompletionAt: string | null
): OperationWithJobInfo => ({
  id,
  dueDate: null,
  startDate: "2026-10-06",
  priority: null,
  deadlineType: "No Deadline",
  jobPriority: 1,
  workCenterId: "wc1",
  projectedCompletionAt
});

describe("sortOperationsByPriority", () => {
  it("orders same-day ties by planned finish, then id, whatever order they arrive in", () => {
    const ops = [
      op("c", null),
      op("b", "2026-10-06T15:00:00Z"),
      op("d", "2026-10-06T10:00:00Z"),
      op("a", "2026-10-06T15:00:00Z")
    ];
    const expected = ["d", "a", "b", "c"];
    expect(sortOperationsByPriority(ops).map((o) => o.id)).toEqual(expected);
    expect(
      sortOperationsByPriority([...ops].reverse()).map((o) => o.id)
    ).toEqual(expected);
  });
});

describe("committedDueDate", () => {
  // The job form hides the date of ASAP and No Deadline jobs, so it is never late.
  it.each([
    ["Hard Deadline", "2026-10-24"],
    ["Soft Deadline", "2026-10-24"],
    ["ASAP", null],
    ["No Deadline", null]
  ] as const)("a %s job dated 24 Oct is due %s", (deadlineType, expected) => {
    expect(committedDueDate({ deadlineType, dueDate: "2026-10-24" })).toBe(
      expected
    );
  });
});

describe("calculatePrioritiesByWorkCenter", () => {
  // An outside op runs at the supplier: a work center it still carries from
  // an in-house type is stale, and must not take a place in that queue.
  it("leaves an outside op out of the queue of the work center it carries", () => {
    const priorities = calculatePrioritiesByWorkCenter([
      {
        ...op("outside", "2026-10-05T12:00:00Z"),
        workCenterId: "wc-7",
        startDate: "2026-10-05",
        operationType: "Outside Processing"
      },
      { ...op("first", "2026-10-06T10:00:00Z"), workCenterId: "wc-7" },
      { ...op("second", "2026-10-06T15:00:00Z"), workCenterId: "wc-7" }
    ]);
    expect(Object.fromEntries(priorities)).toEqual({ first: 1, second: 2 });
  });
});
