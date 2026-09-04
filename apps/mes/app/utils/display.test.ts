import { describe, expect, it } from "vitest";
import type { DisplayDispatch, DisplaySchedule } from "./display";
import {
  formatElapsed,
  formatRelativeDue,
  getInitials,
  getMaintenanceDisplayState,
  getMaintenanceScoreboard,
  getProgress,
  getWorkDisplayState,
  isDispatchOverdue
} from "./display";

const NOW = new Date("2026-08-04T12:00:00.000Z");

const hoursFromNow = (hours: number) =>
  new Date(NOW.getTime() + hours * 3600_000).toISOString();
const daysFromNow = (days: number) => hoursFromNow(days * 24);

const dispatch = (
  overrides: Partial<DisplayDispatch> = {}
): DisplayDispatch => ({
  id: "md-1",
  maintenanceDispatchId: "PM-000001",
  status: "Open",
  source: "Scheduled",
  oeeImpact: "No Impact",
  plannedStartTime: null,
  plannedEndTime: null,
  completedAt: null,
  createdAt: NOW.toISOString(),
  ...overrides
});

const schedule = (
  overrides: Partial<DisplaySchedule> = {}
): DisplaySchedule => ({
  id: "ms-1",
  name: "Weekly lube",
  frequency: "Weekly",
  active: true,
  nextDueAt: null,
  ...overrides
});

const noLastCompleted = { completedAt: null, by: null };

describe("isDispatchOverdue", () => {
  it("uses planned end when present", () => {
    expect(
      isDispatchOverdue(dispatch({ plannedEndTime: hoursFromNow(-1) }), NOW)
    ).toBe(true);
    expect(
      isDispatchOverdue(dispatch({ plannedEndTime: hoursFromNow(1) }), NOW)
    ).toBe(false);
  });

  it("falls back to planned start when there is no planned end", () => {
    expect(
      isDispatchOverdue(dispatch({ plannedStartTime: hoursFromNow(-2) }), NOW)
    ).toBe(true);
  });

  it("prefers planned end over planned start", () => {
    // Started late but still inside its window — not overdue.
    expect(
      isDispatchOverdue(
        dispatch({
          plannedStartTime: hoursFromNow(-3),
          plannedEndTime: hoursFromNow(3)
        }),
        NOW
      )
    ).toBe(false);
  });

  it("ignores dispatches that are already finished", () => {
    expect(
      isDispatchOverdue(
        dispatch({ status: "Completed", plannedEndTime: hoursFromNow(-5) }),
        NOW
      )
    ).toBe(false);
    expect(
      isDispatchOverdue(
        dispatch({ status: "Cancelled", plannedEndTime: hoursFromNow(-5) }),
        NOW
      )
    ).toBe(false);
  });

  it("never marks unscheduled reactive work overdue", () => {
    expect(isDispatchOverdue(dispatch({ source: "Reactive" }), NOW)).toBe(
      false
    );
  });
});

describe("getMaintenanceDisplayState", () => {
  it("is green with nothing outstanding", () => {
    expect(getMaintenanceDisplayState([], [], NOW)).toEqual({
      status: "ok",
      reasons: []
    });
  });

  it("goes red on unplanned downtime", () => {
    const state = getMaintenanceDisplayState(
      [dispatch({ status: "In Progress", oeeImpact: "Down" })],
      [],
      NOW
    );
    expect(state.status).toBe("alert");
    expect(state.reasons).toContain("unplanned-downtime");
  });

  it("goes red on planned downtime", () => {
    const state = getMaintenanceDisplayState(
      [dispatch({ status: "In Progress", oeeImpact: "Planned" })],
      [],
      NOW
    );
    expect(state.reasons).toContain("planned-downtime");
  });

  it("goes red on scheduled maintenance that was not done", () => {
    const state = getMaintenanceDisplayState(
      [dispatch({ plannedEndTime: hoursFromNow(-1) })],
      [],
      NOW
    );
    expect(state.reasons).toContain("overdue-maintenance");
  });

  it("goes red on a lapsed schedule with no dispatch cut", () => {
    const state = getMaintenanceDisplayState(
      [],
      [schedule({ nextDueAt: daysFromNow(-2) })],
      NOW
    );
    expect(state.reasons).toContain("overdue-schedule");
  });

  it("ignores lapsed schedules that are inactive", () => {
    const state = getMaintenanceDisplayState(
      [],
      [schedule({ active: false, nextDueAt: daysFromNow(-2) })],
      NOW
    );
    expect(state.status).toBe("ok");
  });

  it("stays green for maintenance that is merely due soon", () => {
    const state = getMaintenanceDisplayState(
      [dispatch({ plannedEndTime: daysFromNow(3) })],
      [schedule({ nextDueAt: daysFromNow(5) })],
      NOW
    );
    expect(state.status).toBe("ok");
  });

  it("stays green while maintenance runs without stopping the machine", () => {
    const state = getMaintenanceDisplayState(
      [
        dispatch({
          status: "In Progress",
          oeeImpact: "No Impact",
          plannedEndTime: hoursFromNow(4)
        })
      ],
      [],
      NOW
    );
    expect(state.status).toBe("ok");
  });

  it("reports every reason that applies", () => {
    const state = getMaintenanceDisplayState(
      [
        dispatch({ id: "a", status: "In Progress", oeeImpact: "Down" }),
        dispatch({ id: "b", plannedEndTime: hoursFromNow(-6) })
      ],
      [schedule({ nextDueAt: daysFromNow(-1) })],
      NOW
    );
    expect(state.reasons).toEqual([
      "unplanned-downtime",
      "overdue-maintenance",
      "overdue-schedule"
    ]);
  });
});

describe("getWorkDisplayState", () => {
  it("is green while work is running", () => {
    expect(
      getWorkDisplayState({ activeEventCount: 2, isBlocked: false })
    ).toEqual({ status: "ok", reasons: [] });
  });

  it("goes red when nothing is active", () => {
    const state = getWorkDisplayState({
      activeEventCount: 0,
      isBlocked: false
    });
    expect(state.status).toBe("alert");
    expect(state.reasons).toEqual(["idle"]);
  });

  it("names maintenance ahead of idleness when both apply", () => {
    const state = getWorkDisplayState({
      activeEventCount: 0,
      isBlocked: true
    });
    expect(state.reasons).toEqual(["blocked", "idle"]);
  });

  it("goes red when maintenance blocks the work center mid-run", () => {
    const state = getWorkDisplayState({ activeEventCount: 1, isBlocked: true });
    expect(state.status).toBe("alert");
    expect(state.reasons).toEqual(["blocked"]);
  });
});

describe("getMaintenanceScoreboard", () => {
  it("counts overdue dispatches and lapsed schedules together", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [dispatch({ plannedEndTime: hoursFromNow(-3) })],
      schedules: [schedule({ nextDueAt: daysFromNow(-1) })],
      unplannedCost: 0,
      lastCompleted: noLastCompleted,
      now: NOW
    });
    expect(board.overdue.count).toBe(2);
    expect(board.overdue.ids).toEqual(["PM-000001"]);
  });

  it("keeps overdue work out of the due-today count", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [dispatch({ plannedEndTime: hoursFromNow(-3) })],
      schedules: [],
      unplannedCost: 0,
      lastCompleted: noLastCompleted,
      now: NOW
    });
    expect(board.overdue.count).toBe(1);
    expect(board.dueToday.count).toBe(0);
  });

  it("counts work still due later today", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [dispatch({ plannedEndTime: hoursFromNow(2) })],
      schedules: [],
      unplannedCost: 0,
      lastCompleted: noLastCompleted,
      now: NOW
    });
    expect(board.dueToday.count).toBe(1);
    expect(board.dueSoon.count).toBe(0);
  });

  it("counts work due inside the ten day window, not beyond it", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [
        dispatch({ id: "a", plannedEndTime: daysFromNow(4) }),
        dispatch({ id: "b", plannedEndTime: daysFromNow(30) })
      ],
      schedules: [schedule({ nextDueAt: daysFromNow(9) })],
      unplannedCost: 0,
      lastCompleted: noLastCompleted,
      now: NOW
    });
    expect(board.dueSoon.count).toBe(2);
    expect(board.dueSoon.days).toBe(10);
  });

  it("flags the dispatch that has the machine down", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [
        dispatch({
          status: "In Progress",
          oeeImpact: "Down",
          maintenanceDispatchId: "PM-000042"
        })
      ],
      schedules: [],
      unplannedCost: 0,
      lastCompleted: noLastCompleted,
      now: NOW
    });
    expect(board.downNow).toEqual({ active: true, dispatchId: "PM-000042" });
  });

  it("counts unplanned work in the last 30 days only", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [
        dispatch({ id: "a", source: "Reactive", createdAt: daysFromNow(-5) }),
        dispatch({
          id: "b",
          source: "Non-Conformance",
          createdAt: daysFromNow(-29)
        }),
        dispatch({ id: "c", source: "Reactive", createdAt: daysFromNow(-45) }),
        dispatch({ id: "d", source: "Scheduled", createdAt: daysFromNow(-2) })
      ],
      schedules: [],
      unplannedCost: 0,
      lastCompleted: noLastCompleted,
      now: NOW
    });
    expect(board.unplannedCount.count).toBe(2);
    expect(board.unplannedCount.days).toBe(30);
  });

  it("passes through the unplanned cost and who closed the last one", () => {
    const board = getMaintenanceScoreboard({
      dispatches: [],
      schedules: [],
      unplannedCost: 1234.5,
      lastCompleted: { completedAt: daysFromNow(-7), by: "Jane Boyle" },
      now: NOW
    });
    expect(board.unplannedCost).toEqual({ total: 1234.5, days: 90 });
    expect(board.lastCompleted.by).toBe("Jane Boyle");
  });
});

describe("formatElapsed", () => {
  it("zero-pads to a fixed HH:MM:SS width", () => {
    expect(
      formatElapsed(
        new Date(
          NOW.getTime() - 9 * 3600_000 - 25 * 60_000 - 55_000
        ).toISOString(),
        NOW
      )
    ).toBe("09:25:55");
    expect(
      formatElapsed(new Date(NOW.getTime() - 5_000).toISOString(), NOW)
    ).toBe("00:00:05");
  });

  it("clamps a future start to zero rather than going negative", () => {
    expect(formatElapsed(hoursFromNow(1), NOW)).toBe("00:00:00");
  });

  it("degrades to placeholder digits on an unparseable start", () => {
    expect(formatElapsed("not-a-date", NOW)).toBe("--:--:--");
  });
});

describe("formatRelativeDue", () => {
  it("labels future work", () => {
    expect(formatRelativeDue(hoursFromNow(3), NOW)).toBe("in 3h");
    expect(formatRelativeDue(daysFromNow(3), NOW)).toBe("in 3d");
    expect(formatRelativeDue(daysFromNow(21), NOW)).toBe("in 3w");
  });

  it("labels overdue work", () => {
    expect(formatRelativeDue(hoursFromNow(-2), NOW)).toBe("2h overdue");
  });

  it("returns null with no due date", () => {
    expect(formatRelativeDue(null, NOW)).toBeNull();
  });
});

describe("getInitials", () => {
  it("takes first and last initials", () => {
    expect(getInitials("Jane Boyle")).toBe("JB");
    expect(getInitials("Ada Byron Lovelace")).toBe("AL");
  });

  it("handles a single name", () => {
    expect(getInitials("Prince")).toBe("P");
  });

  it("returns null with no name", () => {
    expect(getInitials(null)).toBeNull();
    expect(getInitials("   ")).toBeNull();
  });
});

describe("getProgress", () => {
  it("returns a clamped ratio", () => {
    expect(getProgress(5, 10)).toBe(0.5);
    expect(getProgress(20, 10)).toBe(1);
    expect(getProgress(-1, 10)).toBe(0);
  });

  it("returns null when there is no quantity to measure against", () => {
    expect(getProgress(5, 0)).toBeNull();
    expect(getProgress(5, null)).toBeNull();
  });
});
