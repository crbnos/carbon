import { it } from "vitest";
import {
  classifyLatePlacement,
  composeBehindTarget,
  composeLateConflict,
  composePlacementNote,
  formatWaitDuration
} from "./conflict-messages.ts";
import { assertEquals } from "./test-helpers.ts";

const HOUR = 3_600_000;

it("waited behind other jobs' operators → operator-queue naming the blockers", () => {
  const cause = classifyLatePlacement({
    waitedMs: 30 * HOUR,
    wait: {
      resource: "operator",
      blockers: "queued behind J000009 (3 ops), J000010 (1 op)",
      ownJobAhead: false
    },
    dominantDep: null
  });
  assertEquals(cause, {
    kind: "operator-queue",
    blockers: "queued behind J000009 (3 ops), J000010 (1 op)"
  });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for a qualified operator, queued behind J000009 (3 ops), J000010 (1 op)"
  );
});

it("waited behind other jobs on the machine → machine-queue naming the blockers", () => {
  const cause = classifyLatePlacement({
    waitedMs: 30 * HOUR,
    wait: {
      resource: "machine",
      blockers: "queued behind J000009 (1 op)",
      ownJobAhead: false
    },
    dominantDep: null
  });
  assertEquals(cause, {
    kind: "machine-queue",
    blockers: "queued behind J000009 (1 op)"
  });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the work center, queued behind J000009 (1 op)"
  );
});

it("machine busy with this job's own operations → machine-own-job", () => {
  const cause = classifyLatePlacement({
    waitedMs: 8 * HOUR,
    wait: { resource: "machine", blockers: null, ownJobAhead: true },
    dominantDep: null
  });
  assertEquals(cause, { kind: "machine-own-job" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the work center, busy with earlier operations in this job"
  );
});

it("machine-bound wait with no attributable reservations → machine-wait", () => {
  const cause = classifyLatePlacement({
    waitedMs: 2 * HOUR,
    wait: { resource: "machine", blockers: null, ownJobAhead: false },
    dominantDep: null
  });
  assertEquals(cause, { kind: "machine-wait" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the work center to be available"
  );
});

it("blockers win over own-job queueing and a dominant dep", () => {
  const cause = classifyLatePlacement({
    waitedMs: HOUR,
    wait: {
      resource: "operator",
      blockers: "queued behind J000009 (1 op)",
      ownJobAhead: true
    },
    dominantDep: { description: "Assembly" }
  });
  assertEquals(cause.kind, "operator-queue");
});

it("waited behind this job's own operations → own-job-queue", () => {
  const cause = classifyLatePlacement({
    waitedMs: 8 * HOUR,
    wait: { resource: "operator", blockers: null, ownJobAhead: true },
    dominantDep: null
  });
  assertEquals(cause, { kind: "own-job-queue" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for a qualified operator, busy with earlier operations in this job"
  );
});

it("waited with no blockers and no own ops → operator-wait", () => {
  const cause = classifyLatePlacement({
    waitedMs: 8 * HOUR,
    wait: { resource: "operator", blockers: null, ownJobAhead: false },
    dominantDep: null
  });
  assertEquals(cause, { kind: "operator-wait" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for a qualified operator to be available"
  );
});

it("shift-gap wait (null attribution) still classifies as operator-wait", () => {
  const cause = classifyLatePlacement({
    waitedMs: 12 * HOUR,
    wait: null,
    dominantDep: null
  });
  assertEquals(cause, { kind: "operator-wait" });
});

it("no wait, dep-dominated → inherited delay naming the predecessor", () => {
  const cause = classifyLatePlacement({
    waitedMs: 0,
    wait: null,
    dominantDep: { description: "Battery Test" }
  });
  assertEquals(cause, {
    kind: "inherited-delay",
    predecessorDescription: "Battery Test"
  });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    'Finishes 2026-07-20 but the job is due 2026-07-17 — starts late because it waits for "Battery Test" earlier in this job; its own work center was free'
  );
});

it("inherited delay without a predecessor description stays readable", () => {
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", {
      kind: "inherited-delay",
      predecessorDescription: null
    }),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — starts late because it waits for an earlier operation earlier in this job; its own work center was free"
  );
});

it("no wait, no dominant dep → no runway before the due date", () => {
  const cause = classifyLatePlacement({
    waitedMs: 0,
    wait: null,
    dominantDep: null
  });
  assertEquals(cause, { kind: "no-runway" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — not enough time remains before the due date"
  );
});

it("formatWaitDuration is coarse and human", () => {
  assertEquals(formatWaitDuration(45 * 60_000), "45m");
  assertEquals(formatWaitDuration(14 * HOUR), "14h");
  assertEquals(formatWaitDuration(14 * HOUR + 30 * 60_000), "14h 30m");
  assertEquals(formatWaitDuration(51 * HOUR), "2d 3h");
  assertEquals(formatWaitDuration(48 * HOUR), "2d");
});

it("placement note: queued behind other jobs", () => {
  assertEquals(
    composePlacementNote(
      { kind: "operator-queue", blockers: "queued behind J000010 (2 ops)" },
      14 * HOUR
    ),
    "Waited 14h for a qualified operator — queued behind J000010 (2 ops)"
  );
});

it("placement note: queued at the work center", () => {
  assertEquals(
    composePlacementNote(
      { kind: "machine-queue", blockers: "queued behind J000009 (1 op)" },
      14 * HOUR
    ),
    "Waited 14h for the work center — queued behind J000009 (1 op)"
  );
  assertEquals(
    composePlacementNote({ kind: "machine-own-job" }, 8 * HOUR),
    "Waited 8h for the work center — busy with earlier operations in this job"
  );
  assertEquals(
    composePlacementNote({ kind: "machine-wait" }, 2 * HOUR),
    "Waited 2h for the work center to be available"
  );
});

it("placement note: own job ahead / operator wait", () => {
  assertEquals(
    composePlacementNote({ kind: "own-job-queue" }, 8 * HOUR),
    "Waited 8h for a qualified operator — busy with earlier operations in this job"
  );
  assertEquals(
    composePlacementNote({ kind: "operator-wait" }, 90 * 60_000),
    "Waited 1h 30m for a qualified operator to be available"
  );
});

it("placement note: chained after a predecessor", () => {
  assertEquals(
    composePlacementNote(
      { kind: "inherited-delay", predecessorDescription: "Flash Firmware" },
      0
    ),
    'Starts after "Flash Firmware" finishes'
  );
  assertEquals(
    composePlacementNote(
      { kind: "inherited-delay", predecessorDescription: null },
      0
    ),
    "Starts after an earlier operation in this job finishes"
  );
});

it("placement note: null when the op started as early as it could", () => {
  assertEquals(composePlacementNote({ kind: "no-runway" }, 0), null);
  assertEquals(composePlacementNote({ kind: "outside-processing" }, 0), null);
});

it("outside processing message", () => {
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", {
      kind: "outside-processing"
    }),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — outside processing pushes it past the due date"
  );
});

it("people-manned wait classifies and words as the assigned people", () => {
  const cause = classifyLatePlacement({
    waitedMs: 2 * HOUR,
    wait: { resource: "operator", blockers: null, ownJobAhead: false },
    dominantDep: null,
    staffed: true
  });
  assertEquals(cause, { kind: "people-wait" });
  assertEquals(
    composePlacementNote(cause, 2 * HOUR),
    "Waited 2h for the assigned people"
  );
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the assigned people to be available"
  );
});

it("behind target: names the FIRST op past its need-by in the given order", () => {
  assertEquals(
    composeBehindTarget(
      [
        {
          // On target — projected day equals its need-by.
          description: "Cut Stock",
          needBy: "2026-07-15",
          projectedCompletionAt: "2026-07-15T20:00:00.000Z"
        },
        {
          // First behind target — this one is named.
          description: "Machining",
          needBy: "2026-07-16",
          projectedCompletionAt: "2026-07-18T14:00:00.000Z"
        },
        {
          // Also behind, but later in topological order — never reached.
          description: "Assembly",
          needBy: "2026-07-17",
          projectedCompletionAt: "2026-07-20T14:00:00.000Z"
        }
      ],
      "UTC"
    ),
    "First behind target: Machining (due 2026-07-16, projected 2026-07-18)"
  );
});

it("behind target: projected day is the FACTORY day, not UTC's", () => {
  // 03:30 IST on the 17th is 22:00 UTC on the 16th — on target in UTC,
  // behind target on the factory calendar.
  assertEquals(
    composeBehindTarget(
      [
        {
          description: "Machining",
          needBy: "2026-07-16",
          projectedCompletionAt: "2026-07-16T22:00:00.000Z"
        }
      ],
      "Asia/Kolkata"
    ),
    "First behind target: Machining (due 2026-07-16, projected 2026-07-17)"
  );
});

it("behind target: null when every op meets its target", () => {
  assertEquals(
    composeBehindTarget(
      [
        {
          description: "Cut Stock",
          needBy: "2026-07-15",
          projectedCompletionAt: "2026-07-14T20:00:00.000Z"
        },
        {
          description: "Assembly",
          needBy: "2026-07-17",
          projectedCompletionAt: "2026-07-17T14:00:00.000Z"
        }
      ],
      "UTC"
    ),
    null
  );
});

it("behind target: ops with no need-by (or no placement) are skipped", () => {
  // No due date on the job → every need-by is null → nothing to attribute.
  assertEquals(
    composeBehindTarget(
      [
        {
          description: "Cut Stock",
          needBy: null,
          projectedCompletionAt: "2026-07-18T14:00:00.000Z"
        }
      ],
      "UTC"
    ),
    null
  );
  // A null-needBy op is skipped, not treated as behind; an unplaced op
  // (null projection) is skipped too — the next behind-target op is named.
  assertEquals(
    composeBehindTarget(
      [
        {
          description: "Cut Stock",
          needBy: null,
          projectedCompletionAt: "2026-07-18T14:00:00.000Z"
        },
        {
          description: "Deburr",
          needBy: "2026-07-16",
          projectedCompletionAt: null
        },
        {
          description: "Machining",
          needBy: "2026-07-16",
          projectedCompletionAt: "2026-07-18T14:00:00.000Z"
        }
      ],
      "UTC"
    ),
    "First behind target: Machining (due 2026-07-16, projected 2026-07-18)"
  );
  assertEquals(composeBehindTarget([], "UTC"), null);
});

it("behind target: a blank description stays readable", () => {
  assertEquals(
    composeBehindTarget(
      [
        {
          description: null,
          needBy: "2026-07-16",
          projectedCompletionAt: "2026-07-18T14:00:00.000Z"
        }
      ],
      "UTC"
    ),
    "First behind target: an operation (due 2026-07-16, projected 2026-07-18)"
  );
});

it("staffed never reclassifies a machine-bound wait", () => {
  const cause = classifyLatePlacement({
    waitedMs: 2 * HOUR,
    wait: { resource: "machine", blockers: null, ownJobAhead: false },
    dominantDep: null,
    staffed: true
  });
  assertEquals(cause, { kind: "machine-wait" });
});
