import { describe, expect, it } from "vitest";
import type { ResourceTimelineReservation } from "./resourceTimeline";
import { buildResourceTimeline } from "./resourceTimeline";

const HOUR = 3_600_000;

function reservation(
  overrides: Partial<ResourceTimelineReservation>
): ResourceTimelineReservation {
  return {
    id: "res-1",
    resourceKind: "WorkCenter",
    resourceId: "wc-1",
    resourceName: "CNC Router",
    startAt: "2026-07-14T08:00:00.000Z",
    endAt: "2026-07-14T10:00:00.000Z",
    jobId: "job-1",
    jobReadableId: "J000001",
    operationDescription: "CNC Route",
    hasConflict: false,
    conflictReason: null,
    ...overrides
  };
}

describe("buildResourceTimeline", () => {
  it("groups reservations into one lane per resource with per-job child rows", () => {
    const result = buildResourceTimeline({
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

    const lane = result.events.find((e) => e.id === "lane:WorkCenter:wc-1")!;
    expect(lane.parentId).toBe("resources-root");
    expect(lane.children).toEqual(["res-1", "res-2"]);
    expect(lane.data.message).toBe("CNC Router");
    // lane bar spans min start → max end of its reservations
    expect(lane.data.offset).toBe(0);
    expect(lane.data.duration).toBe(4 * HOUR);

    const child = result.events.find((e) => e.id === "res-2")!;
    expect(child.parentId).toBe(lane.id);
    expect(child.data.message).toBe("J000009 · CNC Route");
    expect(child.data.offset).toBe(2 * HOUR);
    expect(child.data.duration).toBe(2 * HOUR);
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
            "Finishes 2026-07-20 but the job is due 2026-07-17 — waited for the work center, queued behind J000001 (1 op)"
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
});
