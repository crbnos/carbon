import { describe, expect, it } from "vitest";
import type { PlannedRun } from "./matcher";
import {
  type DueWorkflow,
  MAX_DUE_PER_WAKE,
  OVERFLOW_WAKE_MS,
  PREVIOUS_RUN_ACTIVE,
  planClaims,
  planWakeAt,
  SCHEDULE_EVENT_ID,
  STALE_AFTER_MS,
  TOO_LATE,
  WAKE_CEILING_MS
} from "./scheduler";

// ---- planWakeAt ----

describe("planWakeAt", () => {
  const now = new Date("2026-08-01T10:00:00Z");

  it("returns ceiling when earliestFuture is far out", () => {
    const fiveHoursOut = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    expect(
      planWakeAt({ now, earliestFuture: fiveHoursOut, overflow: false })
    ).toBe(now.getTime() + WAKE_CEILING_MS);
  });

  it("returns earliestFuture when it is 90 seconds out", () => {
    const ninetySecondsOut = new Date(now.getTime() + 90 * 1000);
    expect(
      planWakeAt({ now, earliestFuture: ninetySecondsOut, overflow: false })
    ).toBe(ninetySecondsOut.getTime());
  });

  it("returns ceiling when there is no future run", () => {
    expect(planWakeAt({ now, earliestFuture: null, overflow: false })).toBe(
      now.getTime() + WAKE_CEILING_MS
    );
  });

  it("returns overflow delay when overflow is true, ignoring earliestFuture", () => {
    const oneSecondOut = new Date(now.getTime() + 1000);
    expect(
      planWakeAt({ now, earliestFuture: oneSecondOut, overflow: true })
    ).toBe(now.getTime() + OVERFLOW_WAKE_MS);
  });

  it("floors earliestFuture to at least now + 1s", () => {
    const past = new Date(now.getTime() - 1000);
    const result = planWakeAt({ now, earliestFuture: past, overflow: false });
    expect(result).toBeGreaterThanOrEqual(now.getTime() + 1000);
  });
});

// ---- PlannedRun shape ----

describe("PlannedRun", () => {
  it("has the expected flat shape fields", () => {
    const plan: PlannedRun = {
      workflowId: "wf_1",
      workflowVersionId: "wfv_1",
      eventId: SCHEDULE_EVENT_ID,
      ownerId: "usr_1",
      status: "Queued",
      statusReason: null,
      rootRunId: null,
      causedByRunId: null,
      depth: 0,
      path: []
    };
    expect(plan.eventId).toBe("schedule");
    expect(plan.depth).toBe(0);
    expect(plan.path).toEqual([]);
  });

  it("accepts Skipped status (not available in matcher's MatchPlan)", () => {
    const plan: PlannedRun = {
      workflowId: "wf_1",
      workflowVersionId: "wfv_1",
      eventId: SCHEDULE_EVENT_ID,
      ownerId: "usr_1",
      status: "Skipped",
      statusReason: PREVIOUS_RUN_ACTIVE,
      rootRunId: null,
      causedByRunId: null,
      depth: 0,
      path: []
    };
    expect(plan.status).toBe("Skipped");
    expect(plan.statusReason).toBe(PREVIOUS_RUN_ACTIVE);
  });
});

// ---- constant values ----

describe("scheduler constants", () => {
  it("STALE_AFTER_MS is one hour", () => {
    expect(STALE_AFTER_MS).toBe(60 * 60 * 1000);
  });

  it("MAX_DUE_PER_WAKE is 200", () => {
    expect(MAX_DUE_PER_WAKE).toBe(200);
  });

  it("TOO_LATE message is defined", () => {
    expect(typeof TOO_LATE).toBe("string");
    expect(TOO_LATE.length).toBeGreaterThan(0);
  });

  it("PREVIOUS_RUN_ACTIVE message is defined", () => {
    expect(typeof PREVIOUS_RUN_ACTIVE).toBe("string");
    expect(PREVIOUS_RUN_ACTIVE.length).toBeGreaterThan(0);
  });
});

// ---- planClaims ----

describe("planClaims", () => {
  const now = new Date("2026-08-01T10:00:00Z");

  const dueRow = (id: string, nodes: unknown): DueWorkflow => ({
    id,
    companyId: "cmp_1",
    ownerId: "usr_1",
    activeVersionId: "wfv_1",
    nextRunAt: new Date("2026-08-01T09:00:00Z"),
    nodes
  });

  const scheduledNodes = [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        events: [],
        schedule: { freq: "Daily", hour: 9, minute: 0, tz: "UTC" }
      }
    }
  ];

  const eventNodes = [
    {
      id: "trigger",
      name: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { events: ["purchaseOrder.status.changed"] }
    }
  ];

  it("re-books a scheduled workflow from now, not from its due time", () => {
    const { claims, unscheduled } = planClaims(
      [dueRow("wf_1", scheduledNodes)],
      now
    );
    expect(unscheduled).toEqual([]);
    expect(claims).toHaveLength(1);
    // Computed from `now`, so a long outage cannot queue a cascade of catch-ups.
    expect(new Date(claims[0]!.recomputed).getTime()).toBeGreaterThan(
      now.getTime()
    );
  });

  it("clears a workflow whose promoted version is no longer scheduled", () => {
    const { claims, unscheduled } = planClaims(
      [dueRow("wf_2", eventNodes)],
      now
    );
    expect(claims).toEqual([]);
    expect(unscheduled.map((row) => row.id)).toEqual(["wf_2"]);
  });

  it("keeps both kinds apart in one wake", () => {
    const { claims, unscheduled } = planClaims(
      [dueRow("wf_1", scheduledNodes), dueRow("wf_2", eventNodes)],
      now
    );
    expect(claims.map((claim) => claim.row.id)).toEqual(["wf_1"]);
    expect(unscheduled.map((row) => row.id)).toEqual(["wf_2"]);
  });
});
