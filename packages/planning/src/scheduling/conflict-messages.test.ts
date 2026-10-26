// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type BehindTargetOperation,
  classifyLatePlacement,
  composeBehindTarget,
  composeLateConflict,
  composePlacementNote,
  formatWaitDuration,
  type LatePlacementCause,
  type WaitAttribution
} from "./conflict-messages.ts";

const HOUR = 3_600_000;
const BLOCKERS = "queued behind J000009 (3 ops), J000010 (1 op)";

function wait(overrides: Partial<WaitAttribution>): WaitAttribution {
  return {
    resource: "operator",
    blockers: null,
    ownJobAhead: false,
    ...overrides
  };
}

describe("classifyLatePlacement", () => {
  it.each<
    [string, Parameters<typeof classifyLatePlacement>[0], LatePlacementCause]
  >([
    [
      "another job held the operator",
      { waitedMs: HOUR, wait: wait({ blockers: BLOCKERS }), dominantDep: null },
      { kind: "operator-queue", blockers: BLOCKERS }
    ],
    [
      "another job held the operator, over own-job queueing and a dominant dep",
      {
        waitedMs: HOUR,
        wait: wait({ blockers: BLOCKERS, ownJobAhead: true }),
        dominantDep: { description: "Assembly" }
      },
      { kind: "operator-queue", blockers: BLOCKERS }
    ],
    [
      "this job's own operations held the operator",
      { waitedMs: HOUR, wait: wait({ ownJobAhead: true }), dominantDep: null },
      { kind: "own-job-queue" }
    ],
    [
      "the operator wait has no attributable reservation",
      { waitedMs: HOUR, wait: wait({}), dominantDep: null },
      { kind: "operator-wait" }
    ],
    [
      "the wait was a shift gap with no attribution",
      { waitedMs: HOUR, wait: null, dominantDep: null },
      { kind: "operator-wait" }
    ],
    [
      "a staffed station waited for its people",
      { waitedMs: HOUR, wait: wait({}), dominantDep: null, staffed: true },
      { kind: "people-wait" }
    ],
    [
      "another job held the machine",
      {
        waitedMs: HOUR,
        wait: wait({ resource: "machine", blockers: BLOCKERS }),
        dominantDep: null
      },
      { kind: "machine-queue", blockers: BLOCKERS }
    ],
    [
      "this job's own operations held the machine",
      {
        waitedMs: HOUR,
        wait: wait({ resource: "machine", ownJobAhead: true }),
        dominantDep: null
      },
      { kind: "machine-own-job" }
    ],
    [
      "a staffed station waited for the machine",
      {
        waitedMs: HOUR,
        wait: wait({ resource: "machine" }),
        dominantDep: null,
        staffed: true
      },
      { kind: "machine-wait" }
    ],
    [
      "it did not wait but a predecessor bound its start",
      { waitedMs: 0, wait: null, dominantDep: { description: "Battery Test" } },
      { kind: "inherited-delay", predecessorDescription: "Battery Test" }
    ],
    [
      "nothing delayed it",
      { waitedMs: 0, wait: null, dominantDep: null },
      { kind: "no-runway" }
    ]
  ])("classifies the case where %s", (_, args, expected) => {
    expect(classifyLatePlacement(args)).toEqual(expected);
  });
});

describe("composeLateConflict", () => {
  // Stored on jobOperation.conflictReason and shown verbatim on the boards.
  it.each<[LatePlacementCause, string]>([
    [
      { kind: "operator-queue", blockers: BLOCKERS },
      `waited for a qualified operator, ${BLOCKERS}`
    ],
    [
      { kind: "own-job-queue" },
      "waited for a qualified operator, busy with earlier operations in this job"
    ],
    [
      { kind: "operator-wait" },
      "waited for a qualified operator to be available"
    ],
    [{ kind: "people-wait" }, "waited for the assigned people to be available"],
    [
      { kind: "machine-queue", blockers: BLOCKERS },
      `waited for the work center, ${BLOCKERS}`
    ],
    [
      { kind: "machine-own-job" },
      "waited for the work center, busy with earlier operations in this job"
    ],
    [{ kind: "machine-wait" }, "waited for the work center to be available"],
    [
      { kind: "inherited-delay", predecessorDescription: "Battery Test" },
      'starts late because it waits for "Battery Test" earlier in this job; its own work center was free'
    ],
    [
      { kind: "inherited-delay", predecessorDescription: null },
      "starts late because it waits for an earlier operation earlier in this job; its own work center was free"
    ],
    [{ kind: "no-runway" }, "not enough time remains before the due date"],
    [
      { kind: "outside-processing" },
      "outside processing pushes it past the due date"
    ]
  ])("explains %j", (cause, reason) => {
    expect(composeLateConflict("2026-07-20", "2026-07-17", cause)).toBe(
      `Finishes 2026-07-20 but the job is due 2026-07-17 — ${reason}`
    );
  });
});

describe("composePlacementNote", () => {
  it.each<[LatePlacementCause, number, string | null]>([
    [
      { kind: "operator-queue", blockers: BLOCKERS },
      14 * HOUR,
      `Waited 14h for a qualified operator — ${BLOCKERS}`
    ],
    [
      { kind: "own-job-queue" },
      8 * HOUR,
      "Waited 8h for a qualified operator — busy with earlier operations in this job"
    ],
    [
      { kind: "operator-wait" },
      90 * 60_000,
      "Waited 1h 30m for a qualified operator to be available"
    ],
    [{ kind: "people-wait" }, 2 * HOUR, "Waited 2h for the assigned people"],
    [
      { kind: "machine-queue", blockers: BLOCKERS },
      14 * HOUR,
      `Waited 14h for the work center — ${BLOCKERS}`
    ],
    [
      { kind: "machine-own-job" },
      8 * HOUR,
      "Waited 8h for the work center — busy with earlier operations in this job"
    ],
    [
      { kind: "machine-wait" },
      2 * HOUR,
      "Waited 2h for the work center to be available"
    ],
    [
      { kind: "inherited-delay", predecessorDescription: "Flash Firmware" },
      0,
      'Starts after "Flash Firmware" finishes'
    ],
    [
      { kind: "inherited-delay", predecessorDescription: null },
      0,
      "Starts after an earlier operation in this job finishes"
    ],
    // Started as early as it could: nothing to explain.
    [{ kind: "no-runway" }, 0, null],
    [{ kind: "outside-processing" }, 0, null]
  ])("notes %j", (cause, waitedMs, expected) => {
    expect(composePlacementNote(cause, waitedMs)).toBe(expected);
  });
});

describe("formatWaitDuration", () => {
  it.each([
    [45 * 60_000, "45m"],
    [14 * HOUR, "14h"],
    [14 * HOUR + 30 * 60_000, "14h 30m"],
    [48 * HOUR, "2d"],
    [51 * HOUR, "2d 3h"]
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatWaitDuration(ms)).toBe(expected);
  });
});

describe("composeBehindTarget", () => {
  function op(
    overrides: Partial<BehindTargetOperation>
  ): BehindTargetOperation {
    return {
      description: "Machining",
      needBy: "2026-07-16",
      projectedCompletionAt: "2026-07-18T14:00:00.000Z",
      ...overrides
    };
  }

  it("names the first operation in the given order whose projected day passes its need-by", () => {
    expect(
      composeBehindTarget(
        [
          op({
            description: "Cut Stock",
            needBy: "2026-07-15",
            projectedCompletionAt: "2026-07-15T20:00:00.000Z"
          }),
          op({}),
          op({
            description: "Assembly",
            needBy: "2026-07-17",
            projectedCompletionAt: "2026-07-20T14:00:00.000Z"
          })
        ],
        "UTC"
      )
    ).toBe(
      "First behind target: Machining (due 2026-07-16, projected 2026-07-18)"
    );
  });

  it("compares the factory's business day, not UTC's", () => {
    // 22:00 UTC on the 16th is 03:30 on the 17th in Kolkata.
    expect(
      composeBehindTarget(
        [op({ projectedCompletionAt: "2026-07-16T22:00:00.000Z" })],
        "Asia/Kolkata"
      )
    ).toBe(
      "First behind target: Machining (due 2026-07-16, projected 2026-07-17)"
    );
  });

  it("skips operations with no need-by or no placement", () => {
    expect(
      composeBehindTarget(
        [
          op({ description: "Cut Stock", needBy: null }),
          op({ description: "Deburr", projectedCompletionAt: null }),
          op({})
        ],
        "UTC"
      )
    ).toBe(
      "First behind target: Machining (due 2026-07-16, projected 2026-07-18)"
    );
  });

  it.each<[string, BehindTargetOperation[]]>([
    [
      "every operation meets its target",
      [op({ projectedCompletionAt: "2026-07-16T14:00:00.000Z" })]
    ],
    ["the job has no due date", [op({ needBy: null })]],
    ["there are no operations", []]
  ])("returns null when %s", (_, operations) => {
    expect(composeBehindTarget(operations, "UTC")).toBeNull();
  });

  it("calls an operation with no description 'an operation'", () => {
    expect(composeBehindTarget([op({ description: null })], "UTC")).toBe(
      "First behind target: an operation (due 2026-07-16, projected 2026-07-18)"
    );
  });
});
