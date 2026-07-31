import { describe, expect, it } from "vitest";
import type { PlannedRun } from "./matcher";
import {
  MAX_DUE_PER_WAKE,
  OVERFLOW_WAKE_MS,
  PREVIOUS_RUN_ACTIVE,
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
