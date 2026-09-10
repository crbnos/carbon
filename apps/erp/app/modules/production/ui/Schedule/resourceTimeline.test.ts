import { describe, expect, it } from "vitest";
import type { ResourceTimelineReservation } from "./resourceTimeline";
import { buildResourceTimeline } from "./resourceTimeline";

const HOUR = 3_600_000;

function reservation(
  overrides: Partial<ResourceTimelineReservation>
): ResourceTimelineReservation {
  const merged: ResourceTimelineReservation = {
    id: "res-1",
    resourceKind: "WorkCenter",
    resourceId: "wc-1",
    resourceName: "CNC Router",
    startAt: "2026-07-14T08:00:00.000Z",
    endAt: "2026-07-14T10:00:00.000Z",
    jobId: "job-1",
    jobReadableId: "J000001",
    operationId: "op-1",
    operationDescription: "CNC Route",
    hasConflict: false,
    conflictReason: null,
    unschedulable: false,
    ...overrides
  };
  // Each reservation is its own operation unless a test deliberately links a
  // machine hold and an operator segment by passing the same operationId.
  if (overrides.operationId === undefined)
    merged.operationId = `op-${merged.id}`;
  return merged;
}

describe("buildResourceTimeline", () => {
  it("groups reservations into one lane per resource with per-job child rows", () => {
    const result = buildResourceTimeline({
      locationName: "Austin Plant",
      reservations: [
        reservation({}),
        reservation({
          id: "res-2",
          jobId: "job-2",
          jobReadableId: "J000009",
          startAt: "2026-07-14T10:00:00.000Z",
          endAt: "2026-07-14T12:00:00.000Z"
        })
      ]
    });

    // Root row is titled by the location and carries the location icon
    const root = result.events.find((e) => e.id === "resources-root")!;
    expect(root.data.message).toBe("Austin Plant");
    expect(root.data.style?.icon).toBe("location");

    const lane = result.events.find((e) => e.id === "lane:WorkCenter:wc-1")!;
    expect(lane.parentId).toBe("resources-root");
    expect(lane.children).toEqual(["res-1", "res-2"]);
    expect(lane.data.message).toBe("CNC Router");
    // lane bar spans min start → max end of its reservations
    expect(lane.data.offset).toBe(0);
    expect(lane.data.duration).toBe(4 * HOUR);

    const child = result.events.find((e) => e.id === "res-2")!;
    expect(child.parentId).toBe(lane.id);
    // The operation node reads "{job} · {op}" under its station.
    expect(child.data.message).toBe("J000009 · CNC Route");
    expect(child.data.offset).toBe(2 * HOUR);
    expect(child.data.duration).toBe(2 * HOUR);
  });

  it("interleaves reservations and maintenance by start within a lane", () => {
    const result = buildResourceTimeline({
      reservations: [
        // Inserted first, but starts LAST (14:00).
        reservation({
          id: "res-late",
          startAt: "2026-07-14T14:00:00.000Z",
          endAt: "2026-07-14T16:00:00.000Z"
        }),
        // Starts FIRST (08:00).
        reservation({
          id: "res-early",
          startAt: "2026-07-14T08:00:00.000Z",
          endAt: "2026-07-14T09:00:00.000Z"
        })
      ],
      // Starts in the MIDDLE (10:00) — must sort between the two reservations.
      maintenance: [
        {
          id: "maint-mid",
          workCenterId: "wc-1",
          name: "MAIN000001",
          startAt: "2026-07-14T10:00:00.000Z",
          endAt: "2026-07-14T11:00:00.000Z"
        }
      ]
    });

    const lane = result.events.find((e) => e.id === "lane:WorkCenter:wc-1")!;
    // Top-to-bottom reads first-to-last by start time, jobs and downtime mixed.
    expect(lane.children).toEqual(["res-early", "maint-mid", "res-late"]);

    // The maintenance child is an amber downtime bar on the same lane.
    const maint = result.events.find((e) => e.id === "maint-mid")!;
    expect(maint.parentId).toBe(lane.id);
    expect(maint.data.style?.variant).toBe("maintenance");
  });

  it("orders work-center lanes alphabetically before operator-pool lanes", () => {
    const result = buildResourceTimeline({
      reservations: [
        reservation({
          id: "res-pool",
          resourceKind: "OperatorPool",
          resourceId: "ab-1",
          resourceName: "Welding"
        }),
        reservation({
          id: "res-b",
          resourceId: "wc-2",
          resourceName: "Weld Cell 1"
        }),
        reservation({ id: "res-a" }) // CNC Router
      ]
    });

    const laneIds = result.events
      .filter((e) => e.parentId === "resources-root")
      .map((e) => e.data.message);
    expect(laneIds).toEqual(["CNC Router", "Weld Cell 1", "Welding operators"]);
  });

  it("nests operators under the OPERATION they staffed (WC > Op > People)", () => {
    const result = buildResourceTimeline({
      reservations: [
        // The Clean op runs on Timesaver (machine hold) …
        reservation({
          id: "res-machine",
          resourceId: "wc-ts",
          resourceName: "Timesaver",
          operationId: "op-clean",
          operationDescription: "Clean"
        }),
        // … staffed by Brad (attended segment) — same operationId.
        reservation({
          id: "res-emp",
          resourceKind: "Employee",
          resourceId: "emp-1",
          resourceName: "Brad Barbin",
          operationId: "op-clean",
          operationDescription: "Clean"
        }),
        reservation({ id: "res-a" }) // CNC Router (unrelated WorkCenter)
      ]
    });

    // Top-level lanes are WORK CENTERS only — no peer "Brad Barbin" row.
    const topLevel = result.events
      .filter((e) => e.parentId === "resources-root")
      .map((e) => e.data.message);
    expect(topLevel).toEqual(["CNC Router", "Timesaver"]);

    // Timesaver's child is the OPERATION node (the machine hold).
    const timesaver = result.events.find(
      (e) => e.id === "lane:WorkCenter:wc-ts"
    )!;
    expect(timesaver.children).toEqual(["res-machine"]);
    const op = result.events.find((e) => e.id === "res-machine")!;
    expect(op.parentId).toBe(timesaver.id);
    expect(op.data.message).toBe("J000001 · Clean");
    expect(op.level).toBe(2);

    // Brad's attended segment nests UNDER the operation (level 3), a person row.
    expect(op.children).toEqual(["res-emp"]);
    const brad = result.events.find((e) => e.id === "res-emp")!;
    expect(brad.parentId).toBe("res-machine");
    expect(brad.level).toBe(3);
    expect(brad.data.message).toBe("Brad Barbin");
    expect(brad.data.style?.icon).toBe("person");
    // Depth-first: the operator segment immediately trails its operation node.
    const ids = result.events.map((e) => e.id);
    expect(ids.indexOf("res-emp")).toBe(ids.indexOf("res-machine") + 1);
  });

  it("falls back to a top-level operator lane when the op has no machine reservation", () => {
    // An Employee reservation whose op has no WorkCenter reservation can't be
    // located under a work center — its hours must not be dropped.
    const result = buildResourceTimeline({
      reservations: [
        reservation({
          id: "res-orphan",
          resourceKind: "Employee",
          resourceId: "emp-9",
          resourceName: "Pat Lee",
          operationId: "op-unmatched"
        })
      ]
    });

    const lane = result.events.find((e) => e.id === "lane:Employee:emp-9")!;
    expect(lane.parentId).toBe("resources-root");
    expect(lane.data.message).toBe("Pat Lee");
    expect(lane.children).toEqual(["res-orphan"]);
  });

  it("keeps the events array depth-first so every subtree is contiguous", () => {
    const result = buildResourceTimeline({
      reservations: [
        reservation({}),
        reservation({
          id: "res-2",
          resourceId: "wc-2",
          resourceName: "Drill Press"
        }),
        reservation({ id: "res-3" }) // second CNC Router row
      ]
    });

    const ids = result.events.map((e) => e.id);
    const byId = new Map(result.events.map((e) => [e.id, e]));
    for (const e of result.events) {
      if (e.parentId) {
        expect(ids.indexOf(e.parentId)).toBeLessThan(ids.indexOf(e.id));
      }
    }
    // rows between a lane and the next lane all belong to that lane
    const cncIndex = ids.indexOf("lane:WorkCenter:wc-1");
    const drillIndex = ids.indexOf("lane:WorkCenter:wc-2");
    expect(cncIndex).toBeLessThan(drillIndex);
    for (const id of ids.slice(cncIndex + 1, drillIndex)) {
      expect(byId.get(id)?.parentId).toBe("lane:WorkCenter:wc-1");
    }
  });

  it("bubbles conflicts from reservations to the lane and root", () => {
    const result = buildResourceTimeline({
      reservations: [
        reservation({}),
        reservation({
          id: "res-2",
          hasConflict: true,
          conflictReason:
            "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for a qualified operator, queued behind J000001 (1 op)"
        })
      ]
    });

    const child = result.events.find((e) => e.id === "res-2")!;
    const lane = result.events.find((e) => e.id === "lane:WorkCenter:wc-1")!;
    const root = result.events.find((e) => e.id === "resources-root")!;
    expect(child.data.isError).toBe(true);
    expect(lane.data.isError).toBe(true);
    expect(root.data.isError).toBe(true);
    expect(result.detailsById["res-2"].conflictReason).toContain(
      "queued behind J000001"
    );
  });

  it("flags an unschedulable placeholder on the op row, its lane, and its detail", () => {
    const result = buildResourceTimeline({
      workCenters: [{ id: "wc-1", name: "CNC Router" }],
      reservations: [
        reservation({
          id: "res-blocked",
          hasConflict: true,
          conflictReason: "No qualified operator for Timesaver",
          unschedulable: true
        })
      ]
    });

    const child = result.events.find((e) => e.id === "res-blocked")!;
    const lane = result.events.find((e) => e.id === "lane:WorkCenter:wc-1")!;
    // Same red bar (isError), but the stronger "can't be scheduled" alert rides
    // isUnschedulable on BOTH the op row and its work-center lane.
    expect(child.data.isError).toBe(true);
    expect(child.data.isUnschedulable).toBe(true);
    expect(lane.data.isUnschedulable).toBe(true);
    expect(result.detailsById["res-blocked"].unschedulable).toBe(true);
  });

  it("carries each reservation's owning job into its detail", () => {
    const result = buildResourceTimeline({
      reservations: [
        reservation({ id: "res-2", jobId: "job-9", jobReadableId: "J000009" })
      ]
    });

    const detail = result.detailsById["res-2"];
    expect(detail.jobId).toBe("job-9");
    expect(detail.jobReadableId).toBe("J000009");
    expect(detail.kind).toBe("reservation");
    expect(detail.workCenterName).toBe("CNC Router");
  });

  it("computes the window from all reservations", () => {
    const result = buildResourceTimeline({
      reservations: [
        reservation({}),
        reservation({
          id: "res-2",
          resourceId: "wc-2",
          resourceName: "Drill Press",
          startAt: "2026-07-15T08:00:00.000Z",
          endAt: "2026-07-15T09:00:00.000Z"
        })
      ]
    });

    expect(result.windowStart?.toISOString()).toBe("2026-07-14T08:00:00.000Z");
    expect(result.totalDuration).toBe(25 * HOUR);
  });

  it("returns an empty-window timeline when there are no reservations", () => {
    const result = buildResourceTimeline({ reservations: [] });
    expect(result.windowStart).toBeUndefined();
    expect(result.totalDuration).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe("resources-root");
  });

  it("pins the axis to an explicit window instead of the data extent", () => {
    const start = Date.parse("2026-07-14T00:00:00.000Z");
    const end = Date.parse("2026-07-15T00:00:00.000Z");
    const result = buildResourceTimeline({
      reservations: [reservation({})], // 08:00–10:00
      window: { start, end }
    });

    expect(result.windowStart?.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    expect(result.totalDuration).toBe(24 * HOUR);
    const child = result.events.find((e) => e.id === "res-1")!;
    expect(child.data.offset).toBe(8 * HOUR); // 08:00 measured from midnight
    expect(child.data.duration).toBe(2 * HOUR);
  });

  it("clips a reservation that spills past the window edges, keeping real detail times", () => {
    const start = Date.parse("2026-07-14T06:00:00.000Z");
    const end = Date.parse("2026-07-14T12:00:00.000Z");
    const result = buildResourceTimeline({
      reservations: [
        reservation({
          startAt: "2026-07-14T04:00:00.000Z", // before the window
          endAt: "2026-07-14T14:00:00.000Z" // after the window
        })
      ],
      window: { start, end }
    });

    // Bar geometry is clamped to the window: [06:00, 12:00) → offset 0, 6h.
    const child = result.events.find((e) => e.id === "res-1")!;
    expect(child.data.offset).toBe(0);
    expect(child.data.duration).toBe(6 * HOUR);

    // The detail panel still reports the true reservation span.
    const detail = result.detailsById["res-1"];
    expect(detail.start).toBe("2026-07-14T04:00:00.000Z");
    expect(detail.end).toBe("2026-07-14T14:00:00.000Z");
    expect(detail.durationMs).toBe(10 * HOUR);
  });
});
