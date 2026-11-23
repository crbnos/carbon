// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { DayEvent } from "../app/modules/production/ui/MachineTime/machine-time-suggestions.ee";
import { suggestMachineTimeOperations } from "../app/modules/production/ui/MachineTime/machine-time-suggestions.ee";

// One day in America/Chicago (UTC−5 in October).
const day = {
  start: "2026-10-12T05:00:00.000Z",
  end: "2026-10-13T05:00:00.000Z"
};
const interval = {
  startTime: "2026-10-12T15:00:00.000Z",
  endTime: "2026-10-12T15:30:00.000Z"
};
const nowMs = Date.parse("2026-10-13T12:00:00.000Z");

function event(
  operationId: string,
  startTime: string,
  endTime: string | null,
  overrides: {
    operationStatus?: string;
    jobStatus?: string;
  } = {}
): DayEvent {
  return {
    jobOperationId: operationId,
    startTime,
    endTime,
    jobOperation: {
      id: operationId,
      description: `Op ${operationId}`,
      status: overrides.operationStatus ?? "In Progress",
      job: {
        id: `job-${operationId}`,
        jobId: `J-${operationId}`,
        status: overrides.jobStatus ?? "In Progress",
        item: { readableIdWithRevision: "PART-1" }
      }
    }
  };
}

const suggest = (events: DayEvent[], limit?: number) =>
  suggestMachineTimeOperations({
    events,
    interval,
    window: day,
    nowMs,
    limit
  });

describe("suggestMachineTimeOperations", () => {
  it("puts the operation that ran during the time first", () => {
    const result = suggest([
      // Ran most of the day, but not during the interval.
      event("long", "2026-10-12T06:00:00.000Z", "2026-10-12T14:00:00.000Z"),
      event("during", "2026-10-12T15:10:00.000Z", "2026-10-12T15:20:00.000Z")
    ]);
    expect(result.map((s) => s.jobOperationId)).toEqual(["during", "long"]);
    expect(result[0]?.overlaps).toBe(true);
    expect(result[1]?.overlaps).toBe(false);
  });

  it("ranks the rest by how close they ran to the time", () => {
    const result = suggest([
      event("far", "2026-10-12T07:00:00.000Z", "2026-10-12T08:00:00.000Z"),
      event("after", "2026-10-12T15:45:00.000Z", "2026-10-12T16:00:00.000Z"),
      event("before", "2026-10-12T14:00:00.000Z", "2026-10-12T14:55:00.000Z")
    ]);
    // 5 minutes before, 15 minutes after, 7 hours before.
    expect(result.map((s) => s.jobOperationId)).toEqual([
      "before",
      "after",
      "far"
    ]);
  });

  it("groups an operation's events and counts only time inside the window", () => {
    const [suggestion] = suggest([
      // Started the evening before: only the 1 hour after the window starts counts.
      event("op", "2026-10-12T03:00:00.000Z", "2026-10-12T06:00:00.000Z"),
      event("op", "2026-10-12T15:00:00.000Z", "2026-10-12T15:30:00.000Z")
    ]);
    expect(suggestion?.totalMs).toBe(90 * 60 * 1000);
    expect(suggestion?.firstStart).toBe("2026-10-12T03:00:00.000Z");
    expect(suggestion?.lastEnd).toBe("2026-10-12T15:30:00.000Z");
  });

  it("keeps a running event open-ended and counts it to now", () => {
    const [suggestion] = suggest([
      event("op", "2026-10-12T15:00:00.000Z", "2026-10-12T15:05:00.000Z"),
      event("op", "2026-10-13T04:00:00.000Z", null)
    ]);
    expect(suggestion?.lastEnd).toBeNull();
    // 5 minutes, plus the running event clipped at the window's end.
    expect(suggestion?.totalMs).toBe((5 + 60) * 60 * 1000);
  });

  it("marks operations that cannot take the time and puts them last", () => {
    const result = suggest([
      event("done", "2026-10-12T15:00:00.000Z", "2026-10-12T15:30:00.000Z", {
        operationStatus: "Done"
      }),
      event("locked", "2026-10-12T15:00:00.000Z", "2026-10-12T15:30:00.000Z", {
        jobStatus: "Completed"
      }),
      event("open", "2026-10-12T08:00:00.000Z", "2026-10-12T09:00:00.000Z")
    ]);
    expect(result.map((s) => [s.jobOperationId, s.blockedBy])).toEqual([
      ["open", null],
      ["done", "Done"],
      ["locked", "Locked"]
    ]);
  });

  it("suggests from both days of an interval across midnight", () => {
    // 23:30 to 00:30 local: the window runs from the start of the first day
    // to the end of the second.
    const result = suggestMachineTimeOperations({
      events: [
        event("before", "2026-10-13T03:00:00.000Z", "2026-10-13T04:00:00.000Z"),
        event("after", "2026-10-13T06:00:00.000Z", "2026-10-13T07:00:00.000Z")
      ],
      interval: {
        startTime: "2026-10-13T04:30:00.000Z",
        endTime: "2026-10-13T05:30:00.000Z"
      },
      window: {
        start: "2026-10-12T05:00:00.000Z",
        end: "2026-10-14T05:00:00.000Z"
      },
      nowMs
    });
    expect(result.map((s) => [s.jobOperationId, s.totalMs])).toEqual([
      ["before", 60 * 60 * 1000],
      ["after", 60 * 60 * 1000]
    ]);
  });

  it("returns at most the limit", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event(`op${i}`, "2026-10-12T15:00:00.000Z", "2026-10-12T15:10:00.000Z")
    );
    expect(suggest(events)).toHaveLength(6);
    expect(suggest(events, 3)).toHaveLength(3);
  });

  it("skips an event whose operation or job could not be read", () => {
    const orphan: DayEvent = {
      jobOperationId: "gone",
      startTime: "2026-10-12T15:00:00.000Z",
      endTime: "2026-10-12T15:10:00.000Z",
      jobOperation: null
    };
    expect(suggest([orphan])).toEqual([]);
  });
});
