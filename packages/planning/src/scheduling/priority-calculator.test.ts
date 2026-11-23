// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
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
