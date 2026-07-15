import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  classifyLatePlacement,
  composeLateConflict,
  composePlacementNote,
  formatWaitDuration,
} from "./conflict-messages.ts";

const HOUR = 3_600_000;

Deno.test("waited behind other jobs → machine-queue naming the blockers", () => {
  const cause = classifyLatePlacement({
    waitedMs: 30 * HOUR,
    blockers: "queued behind J000009 (3 ops), J000010 (1 op)",
    ownJobAhead: false,
    dominantDep: null,
  });
  assertEquals(cause, {
    kind: "machine-queue",
    blockers: "queued behind J000009 (3 ops), J000010 (1 op)",
  });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the work center, queued behind J000009 (3 ops), J000010 (1 op)"
  );
});

Deno.test("blockers win over own-job queueing and a dominant dep", () => {
  const cause = classifyLatePlacement({
    waitedMs: HOUR,
    blockers: "queued behind J000009 (1 op)",
    ownJobAhead: true,
    dominantDep: { description: "Assembly" },
  });
  assertEquals(cause.kind, "machine-queue");
});

Deno.test("waited behind this job's own operations → own-job-queue", () => {
  const cause = classifyLatePlacement({
    waitedMs: 8 * HOUR,
    blockers: null,
    ownJobAhead: true,
    dominantDep: null,
  });
  assertEquals(cause, { kind: "own-job-queue" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the work center, busy with earlier operations in this job"
  );
});

Deno.test("waited with a free machine and no own ops → operator-wait", () => {
  const cause = classifyLatePlacement({
    waitedMs: 8 * HOUR,
    blockers: null,
    ownJobAhead: false,
    dominantDep: null,
  });
  assertEquals(cause, { kind: "operator-wait" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for a qualified operator to be available"
  );
});

Deno.test("no wait, dep-dominated → inherited delay naming the predecessor", () => {
  const cause = classifyLatePlacement({
    waitedMs: 0,
    blockers: null,
    ownJobAhead: false,
    dominantDep: { description: "Battery Test" },
  });
  assertEquals(cause, {
    kind: "inherited-delay",
    predecessorDescription: "Battery Test",
  });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    'Finishes 2026-07-20 but the job is due 2026-07-17 — starts late because it waits for "Battery Test" earlier in this job; its own work center was free'
  );
});

Deno.test("inherited delay without a predecessor description stays readable", () => {
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", {
      kind: "inherited-delay",
      predecessorDescription: null,
    }),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — starts late because it waits for an earlier operation earlier in this job; its own work center was free"
  );
});

Deno.test("no wait, no dominant dep → no runway before the due date", () => {
  const cause = classifyLatePlacement({
    waitedMs: 0,
    blockers: null,
    ownJobAhead: false,
    dominantDep: null,
  });
  assertEquals(cause, { kind: "no-runway" });
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", cause),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — not enough time remains before the due date"
  );
});

Deno.test("formatWaitDuration is coarse and human", () => {
  assertEquals(formatWaitDuration(45 * 60_000), "45m");
  assertEquals(formatWaitDuration(14 * HOUR), "14h");
  assertEquals(formatWaitDuration(14 * HOUR + 30 * 60_000), "14h 30m");
  assertEquals(formatWaitDuration(51 * HOUR), "2d 3h");
  assertEquals(formatWaitDuration(48 * HOUR), "2d");
});

Deno.test("placement note: queued behind other jobs", () => {
  assertEquals(
    composePlacementNote(
      { kind: "machine-queue", blockers: "queued behind J000010 (2 ops)" },
      14 * HOUR
    ),
    "Waited 14h for the work center — queued behind J000010 (2 ops)"
  );
});

Deno.test("placement note: own job ahead / operator wait", () => {
  assertEquals(
    composePlacementNote({ kind: "own-job-queue" }, 8 * HOUR),
    "Waited 8h for the work center — busy with earlier operations in this job"
  );
  assertEquals(
    composePlacementNote({ kind: "operator-wait" }, 90 * 60_000),
    "Waited 1h 30m for a qualified operator to be available"
  );
});

Deno.test("placement note: chained after a predecessor", () => {
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

Deno.test("placement note: null when the op started as early as it could", () => {
  assertEquals(composePlacementNote({ kind: "no-runway" }, 0), null);
  assertEquals(composePlacementNote({ kind: "outside-processing" }, 0), null);
});

Deno.test("outside processing message", () => {
  assertEquals(
    composeLateConflict("2026-07-20", "2026-07-17", {
      kind: "outside-processing",
    }),
    "Finishes 2026-07-20 but the job is due 2026-07-17 — outside processing pushes it past the due date"
  );
});
