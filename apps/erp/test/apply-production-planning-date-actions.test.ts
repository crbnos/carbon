// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  nextJobPriority,
  planJobDateMoves
} from "../app/modules/production/production.service";

// Deadline types rank ASAP < Hard < Soft < No Deadline.
describe("nextJobPriority", () => {
  it("starts at 0 on a date with no other jobs", () => {
    expect(nextJobPriority([], "Soft Deadline")).toBe(0);
  });

  it("goes after the last job when nothing ranks lower", () => {
    expect(
      nextJobPriority(
        [{ priority: 4, deadlineType: "Soft Deadline" }],
        "Soft Deadline"
      )
    ).toBe(5);
  });

  it("goes before the first job that ranks lower, at half its priority", () => {
    expect(
      nextJobPriority([{ priority: 4, deadlineType: "Soft Deadline" }], "ASAP")
    ).toBe(2);
  });

  it("goes to -1 before a first job at priority 0", () => {
    expect(
      nextJobPriority([{ priority: 0, deadlineType: "Soft Deadline" }], "ASAP")
    ).toBe(-1);
  });

  it("goes halfway between the jobs it falls between", () => {
    expect(
      nextJobPriority(
        [
          { priority: 2, deadlineType: "ASAP" },
          { priority: 4, deadlineType: "Soft Deadline" }
        ],
        "Hard Deadline"
      )
    ).toBe(3);
  });
});

describe("planJobDateMoves", () => {
  const job = (
    id: string,
    deadlineType: "ASAP" | "Soft Deadline" | "No Deadline" = "Soft Deadline"
  ) => ({ id, locationId: "loc", deadlineType });
  const sibling = (
    overrides: Partial<{
      locationId: string;
      dueDate: string;
      priority: number;
      deadlineType: "Soft Deadline" | "No Deadline";
    }> = {}
  ) => ({
    locationId: "loc",
    dueDate: "2026-11-02",
    priority: 4,
    deadlineType: "Soft Deadline" as const,
    ...overrides
  });
  const move = (jobId: string) => ({ jobId, suggestedDate: "2026-11-02" });

  it("places jobs moved to one date in turn, each after the one before", () => {
    expect(
      planJobDateMoves(
        [move("job-a"), move("job-b")],
        [job("job-a"), job("job-b")],
        [sibling()]
      )
    ).toEqual([
      {
        jobId: "job-a",
        dueDate: "2026-11-02",
        deadlineType: "Soft Deadline",
        priority: 5
      },
      {
        jobId: "job-b",
        dueDate: "2026-11-02",
        deadlineType: "Soft Deadline",
        priority: 6
      }
    ]);
  });

  // The job form hides the due date of a No Deadline job, so a dated job
  // must carry a dated type; it then ranks as Soft, ahead of undated jobs.
  it("gives a No Deadline job a Soft Deadline and ranks it as one", () => {
    expect(
      planJobDateMoves(
        [move("job-a")],
        [job("job-a", "No Deadline")],
        [sibling({ deadlineType: "No Deadline" })]
      )
    ).toEqual([
      {
        jobId: "job-a",
        dueDate: "2026-11-02",
        deadlineType: "Soft Deadline",
        priority: 2
      }
    ]);
  });

  it("ranks only among jobs at the same location on the same date", () => {
    expect(
      planJobDateMoves(
        [move("job-a")],
        [job("job-a", "ASAP")],
        [sibling({ locationId: "elsewhere" }), sibling({ dueDate: "2026-11-03" })]
      )
    ).toEqual([
      {
        jobId: "job-a",
        dueDate: "2026-11-02",
        deadlineType: "ASAP",
        priority: 0
      }
    ]);
  });

  it("leaves out a move whose job was not found", () => {
    expect(planJobDateMoves([move("gone")], [job("job-a")], [])).toEqual([]);
  });
});
