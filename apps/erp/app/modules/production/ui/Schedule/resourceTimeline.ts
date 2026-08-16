import type { GanttEvent } from "~/components/Gantt";
import type { TimelineNodeDetail } from "./timeline";

/**
 * Pure mapping from cross-job capacity reservations to the Gantt's event
 * model, grouped by RESOURCE instead of by job: one lane per work center
 * (then per operator pool), one child row per reservation. This is how
 * cross-job contention on a machine becomes visible — the single-job view
 * can't show who else is queued on it.
 *
 * The Gantt renders strictly one bar per row, so lanes are parent rows and
 * each reservation is its own child row (same shape as the job view's
 * operation → reservation nesting).
 */

export type ResourceTimelineReservation = {
  id: string;
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceId: string;
  resourceName: string;
  startAt: string;
  endAt: string;
  jobId: string;
  jobReadableId: string;
  operationDescription: string | null;
  hasConflict: boolean;
  conflictReason: string | null;
  /** Engine's plain-words reason for the placement timing */
  scheduleNote?: string | null;
  /** Actual work content (hours) inside the interval, excluding pauses */
  workHours?: number | null;
};

export type ResourceTimeline = {
  events: GanttEvent[];
  totalDuration: number;
  windowStart: Date | undefined;
  detailsById: Record<string, TimelineNodeDetail>;
};

const ROOT_ID = "resources-root";

type Lane = {
  id: string;
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceName: string;
  reservations: ResourceTimelineReservation[];
};

const clamp = (value: number, lo: number, hi: number) =>
  Math.min(Math.max(value, lo), hi);

export function buildResourceTimeline(input: {
  reservations: ResourceTimelineReservation[];
  /**
   * Every work center in the plant — seeded as an empty lane so the board
   * shows a station even when nothing is scheduled on it. Without this the
   * Gantt only surfaces resources that already carry a reservation.
   */
  workCenters?: { id: string; name: string }[];
  /**
   * Explicit [start, end) window (epoch ms) for the day/week/shift views. When
   * given, it fixes the axis (instead of deriving it from the reservation
   * min/max) and bars are clipped to its edges. Omit for the auto-fit window.
   */
  window?: { start: number; end: number };
}): ResourceTimeline {
  const { reservations, workCenters = [], window } = input;

  const detailsById: Record<string, TimelineNodeDetail> = {};

  if (reservations.length === 0 && workCenters.length === 0) {
    const root = makeRootEvent(0, false);
    detailsById[ROOT_ID] = {
      kind: "resource",
      title: "Resources",
      start: null,
      end: null,
      durationMs: 0,
      approximate: true
    };
    return {
      events: [root],
      totalDuration: 0,
      windowStart: undefined,
      detailsById
    };
  }

  const timestamps = reservations.flatMap((r) => [
    Date.parse(r.startAt),
    Date.parse(r.endAt)
  ]);
  // An explicit window (day/week/shift) fixes the axis; otherwise auto-fit to
  // the data. With no reservations and no window there is no real span, so fall
  // back to a one-day span from "now" so empty lanes still have a time axis.
  const windowStart = window
    ? window.start
    : timestamps.length > 0
      ? Math.min(...timestamps)
      : Date.now();
  const windowEnd = window
    ? window.end
    : timestamps.length > 0
      ? Math.max(...timestamps)
      : windowStart + 86_400_000;
  const totalDuration = Math.max(windowEnd - windowStart, 1);

  // One lane per resource; work centers first, each group alphabetical. Seed a
  // lane for every plant work center up front, then attach reservations —
  // stations with no scheduled work keep an empty lane.
  const laneByKey = new Map<string, Lane>();
  for (const workCenter of workCenters) {
    const key = `WorkCenter:${workCenter.id}`;
    laneByKey.set(key, {
      id: `lane:${key}`,
      resourceKind: "WorkCenter",
      resourceName: workCenter.name,
      reservations: []
    });
  }
  for (const r of reservations) {
    const key = `${r.resourceKind}:${r.resourceId}`;
    let lane = laneByKey.get(key);
    if (!lane) {
      lane = {
        id: `lane:${key}`,
        resourceKind: r.resourceKind,
        resourceName: r.resourceName,
        reservations: []
      };
      laneByKey.set(key, lane);
    }
    lane.reservations.push(r);
  }
  const kindRank = { WorkCenter: 0, Employee: 1, OperatorPool: 2 } as const;
  const lanes = Array.from(laneByKey.values()).sort((a, b) => {
    if (a.resourceKind !== b.resourceKind) {
      return kindRank[a.resourceKind] - kindRank[b.resourceKind];
    }
    return a.resourceName.localeCompare(b.resourceName);
  });

  const anyConflict = reservations.some((r) => r.hasConflict);
  const root = makeRootEvent(totalDuration, anyConflict);
  const events: GanttEvent[] = [root];
  detailsById[ROOT_ID] = {
    kind: "resource",
    title: "Resources",
    start: new Date(windowStart).toISOString(),
    end: new Date(windowEnd).toISOString(),
    durationMs: totalDuration,
    approximate: false
  };

  // Built depth-first (lane, then its reservations) — the TreeView renders
  // the array as a pre-flattened depth-first list
  for (const lane of lanes) {
    const sorted = [...lane.reservations].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
    );
    // An empty lane (station with no scheduled work) collapses to the window
    // start with zero duration — it renders as a labeled row with no bar.
    // Spans are clipped to the window so a reservation straddling the edge
    // draws to the boundary instead of overflowing the fixed axis.
    const laneStart =
      sorted.length > 0
        ? clamp(
            Math.min(...sorted.map((r) => Date.parse(r.startAt))),
            windowStart,
            windowEnd
          )
        : windowStart;
    const laneEnd =
      sorted.length > 0
        ? clamp(
            Math.max(...sorted.map((r) => Date.parse(r.endAt))),
            windowStart,
            windowEnd
          )
        : windowStart;
    const laneConflict = sorted.some((r) => r.hasConflict);
    const laneTitle =
      lane.resourceKind === "OperatorPool"
        ? `${lane.resourceName} operators` // legacy ability-pool rows
        : lane.resourceName; // work center, or a named person (Employee)

    const laneEvent: GanttEvent = {
      id: lane.id,
      parentId: ROOT_ID,
      children: sorted.map((r) => r.id),
      hasChildren: sorted.length > 0,
      level: 1,
      data: {
        duration: Math.max(laneEnd - laneStart, 0),
        offset: laneStart - windowStart,
        message: laneTitle,
        isRoot: false,
        isError: laneConflict,
        isPartial: false,
        isCancelled: false,
        level: "TRACE" as GanttEvent["data"]["level"],
        style: {
          icon: lane.resourceKind === "WorkCenter" ? "workCenter" : "wait",
          variant: "primary"
        }
      }
    };
    root.children.push(lane.id);
    root.hasChildren = true;
    events.push(laneEvent);
    detailsById[lane.id] = {
      kind: "resource",
      title: laneTitle,
      start: new Date(laneStart).toISOString(),
      end: new Date(laneEnd).toISOString(),
      durationMs: Math.max(laneEnd - laneStart, 0),
      approximate: false,
      resourceKind: lane.resourceKind
    };

    for (const r of sorted) {
      const rawStart = Date.parse(r.startAt);
      const rawEnd = Date.parse(r.endAt);
      // Bar geometry is clipped to the window; the detail panel keeps the real
      // reservation times below.
      const barStart = clamp(rawStart, windowStart, windowEnd);
      const barEnd = clamp(rawEnd, windowStart, windowEnd);
      const title = r.operationDescription
        ? `${r.jobReadableId} · ${r.operationDescription}`
        : r.jobReadableId;
      const isError = r.hasConflict;

      events.push({
        id: r.id,
        parentId: lane.id,
        children: [],
        hasChildren: false,
        level: 2,
        data: {
          duration: Math.max(barEnd - barStart, 0),
          offset: barStart - windowStart,
          message: title,
          isRoot: false,
          isError,
          isPartial: false,
          isCancelled: false,
          // Always TRACE: only TRACE nodes render as duration bars; the
          // conflict signal rides on isError (red bar + triangle icon)
          level: "TRACE" as GanttEvent["data"]["level"],
          style: {
            icon: "operation",
            variant: "primary"
          }
        }
      });
      detailsById[r.id] = {
        kind: "reservation",
        title,
        start: new Date(rawStart).toISOString(),
        end: new Date(rawEnd).toISOString(),
        durationMs: Math.max(rawEnd - rawStart, 0),
        approximate: false,
        resourceKind: r.resourceKind,
        workCenterName: r.resourceKind === "WorkCenter" ? r.resourceName : null,
        conflictReason: r.hasConflict ? r.conflictReason : null,
        scheduleNote: r.scheduleNote ?? null,
        workMs: r.workHours ? r.workHours * 3_600_000 : undefined,
        jobId: r.jobId,
        jobReadableId: r.jobReadableId
      };
    }
  }

  return {
    events,
    totalDuration,
    windowStart: new Date(windowStart),
    detailsById
  };
}

function makeRootEvent(totalDuration: number, isError: boolean): GanttEvent {
  return {
    id: ROOT_ID,
    parentId: undefined,
    children: [],
    hasChildren: false,
    level: 0,
    data: {
      duration: totalDuration,
      offset: 0,
      message: "Resources",
      isRoot: false, // the Gantt's isRoot badge is job-specific
      isError,
      isPartial: false,
      isCancelled: false,
      level: "TRACE" as GanttEvent["data"]["level"],
      style: { icon: "workCenter" }
    }
  };
}
