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

/** The lane-id prefix for a work-center row: `lane:WorkCenter:<workCenterId>`. */
const WORK_CENTER_LANE_PREFIX = "lane:WorkCenter:";

/**
 * Recover a work center's id from its lane node id (built as
 * `lane:WorkCenter:<id>` below), or null for any other row. Lets the tree
 * renderer attach per-work-center UI (e.g. the availability popover) keyed off
 * the node it already has.
 */
export function workCenterIdFromLaneId(laneId: string): string | null {
  return laneId.startsWith(WORK_CENTER_LANE_PREFIX)
    ? laneId.slice(WORK_CENTER_LANE_PREFIX.length)
    : null;
}

/** An open maintenance outage that takes a work center offline for a window. */
export type ResourceMaintenanceWindow = {
  id: string;
  workCenterId: string;
  /** Human-readable dispatch id (e.g. MAIN000001) — titles the row. */
  name: string;
  startAt: string;
  endAt: string;
};

type Lane = {
  id: string;
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceName: string;
  reservations: ResourceTimelineReservation[];
  maintenance: ResourceMaintenanceWindow[];
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
   * The location being viewed — its name titles the root row (with a location
   * icon) so the board reads as a plant, not a generic "Resources" bucket.
   */
  locationName?: string;
  /**
   * Explicit [start, end) window (epoch ms) for the day/week/shift views. When
   * given, it fixes the axis (instead of deriving it from the reservation
   * min/max) and bars are clipped to its edges. Omit for the auto-fit window.
   */
  window?: { start: number; end: number };
  /**
   * Open maintenance outages (work centers taken offline). Drawn as amber bars
   * on the affected work-center lane so downtime is visible, not just implied by
   * the gap it leaves in the job schedule.
   */
  maintenance?: ResourceMaintenanceWindow[];
}): ResourceTimeline {
  const {
    reservations,
    workCenters = [],
    locationName,
    window,
    maintenance = []
  } = input;
  const rootTitle = locationName ?? "Resources";

  const detailsById: Record<string, TimelineNodeDetail> = {};

  if (
    reservations.length === 0 &&
    workCenters.length === 0 &&
    maintenance.length === 0
  ) {
    const root = makeRootEvent(0, false, rootTitle);
    detailsById[ROOT_ID] = {
      kind: "resource",
      title: rootTitle,
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

  const timestamps = [
    ...reservations.flatMap((r) => [
      Date.parse(r.startAt),
      Date.parse(r.endAt)
    ]),
    ...maintenance.flatMap((m) => [Date.parse(m.startAt), Date.parse(m.endAt)])
  ];
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
      reservations: [],
      maintenance: []
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
        reservations: [],
        maintenance: []
      };
      laneByKey.set(key, lane);
    }
    lane.reservations.push(r);
  }
  // Attach each outage to its work-center lane (seeding the lane if the plant
  // list somehow missed it), so downtime draws on the machine it takes offline.
  for (const m of maintenance) {
    const key = `WorkCenter:${m.workCenterId}`;
    let lane = laneByKey.get(key);
    if (!lane) {
      lane = {
        id: `lane:${key}`,
        resourceKind: "WorkCenter",
        resourceName: "Work Center",
        reservations: [],
        maintenance: []
      };
      laneByKey.set(key, lane);
    }
    lane.maintenance.push(m);
  }
  const kindRank = { WorkCenter: 0, Employee: 1, OperatorPool: 2 } as const;
  const lanes = Array.from(laneByKey.values()).sort((a, b) => {
    if (a.resourceKind !== b.resourceKind) {
      return kindRank[a.resourceKind] - kindRank[b.resourceKind];
    }
    return a.resourceName.localeCompare(b.resourceName);
  });

  const anyConflict = reservations.some((r) => r.hasConflict);
  // The root reads gray across the whole span and turns red ONLY over the
  // windows a conflicted reservation actually occupies (clipped to the view) —
  // so one late op no longer paints the entire location rollup red.
  const conflictSegments = reservations
    .filter((r) => r.hasConflict)
    .map((r) => {
      const start = clamp(Date.parse(r.startAt), windowStart, windowEnd);
      const end = clamp(Date.parse(r.endAt), windowStart, windowEnd);
      return {
        offset: start - windowStart,
        duration: Math.max(end - start, 0)
      };
    })
    .filter((segment) => segment.duration > 0);
  const root = makeRootEvent(
    totalDuration,
    anyConflict,
    rootTitle,
    conflictSegments
  );
  const events: GanttEvent[] = [root];
  detailsById[ROOT_ID] = {
    kind: "resource",
    title: rootTitle,
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
    const sortedMaintenance = [...lane.maintenance].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
    );
    // Lane span covers both reservations AND maintenance outages. An empty lane
    // (no work, no downtime) collapses to the window start with zero duration —
    // a labeled row with no bar. Spans are clipped to the window so an item
    // straddling the edge draws to the boundary instead of overflowing the axis.
    const laneStartCandidates = [
      ...sorted.map((r) => Date.parse(r.startAt)),
      ...sortedMaintenance.map((m) => Date.parse(m.startAt))
    ];
    const laneEndCandidates = [
      ...sorted.map((r) => Date.parse(r.endAt)),
      ...sortedMaintenance.map((m) => Date.parse(m.endAt))
    ];
    const laneStart =
      laneStartCandidates.length > 0
        ? clamp(Math.min(...laneStartCandidates), windowStart, windowEnd)
        : windowStart;
    const laneEnd =
      laneEndCandidates.length > 0
        ? clamp(Math.max(...laneEndCandidates), windowStart, windowEnd)
        : windowStart;
    const laneConflict = sorted.some((r) => r.hasConflict);
    // Child rows (reservations + maintenance) are collected here, then sorted by
    // start time so the lane reads top-to-bottom, first to last.
    const laneChildEvents: GanttEvent[] = [];
    const laneTitle =
      lane.resourceKind === "OperatorPool"
        ? `${lane.resourceName} operators` // legacy ability-pool rows
        : lane.resourceName; // work center, or a named person (Employee)

    const laneEvent: GanttEvent = {
      id: lane.id,
      parentId: ROOT_ID,
      children: [],
      hasChildren: false,
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
      // The row is titled by the job id alone — the parent lane already names
      // the work center / process, so repeating it here is noise. The detail
      // panel keeps the full "job · operation" label.
      const title = r.operationDescription
        ? `${r.jobReadableId} · ${r.operationDescription}`
        : r.jobReadableId;
      const isError = r.hasConflict;

      laneChildEvents.push({
        id: r.id,
        parentId: lane.id,
        children: [],
        hasChildren: false,
        level: 2,
        data: {
          duration: Math.max(barEnd - barStart, 0),
          offset: barStart - windowStart,
          message: r.jobReadableId,
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

    // Maintenance outages — amber "downtime" bars on the same lane. The
    // scheduler already keeps jobs out of these windows, so they slot into the
    // gap; drawing them makes the machine's downtime explicit.
    for (const m of sortedMaintenance) {
      const rawStart = Date.parse(m.startAt);
      const rawEnd = Date.parse(m.endAt);
      const barStart = clamp(rawStart, windowStart, windowEnd);
      const barEnd = clamp(rawEnd, windowStart, windowEnd);
      if (barEnd <= barStart) continue; // outage falls entirely outside the view

      laneChildEvents.push({
        id: m.id,
        parentId: lane.id,
        children: [],
        hasChildren: false,
        level: 2,
        data: {
          duration: barEnd - barStart,
          offset: barStart - windowStart,
          message: m.name,
          isRoot: false,
          isError: false,
          isPartial: false,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: { icon: "maintenance", variant: "maintenance" }
        }
      });
      detailsById[m.id] = {
        kind: "resource",
        title: `Maintenance · ${m.name}`,
        start: new Date(rawStart).toISOString(),
        end: new Date(rawEnd).toISOString(),
        durationMs: Math.max(rawEnd - rawStart, 0),
        approximate: false,
        resourceKind: "WorkCenter"
      };
    }

    // Interleave reservations and maintenance by start (offset) so the lane
    // reads first-to-last, top-to-bottom; emit the children in that order.
    laneChildEvents.sort((a, b) => a.data.offset - b.data.offset);
    laneEvent.children = laneChildEvents.map((event) => event.id);
    laneEvent.hasChildren = laneChildEvents.length > 0;
    events.push(...laneChildEvents);
  }

  return {
    events,
    totalDuration,
    windowStart: new Date(windowStart),
    detailsById
  };
}

function makeRootEvent(
  totalDuration: number,
  isError: boolean,
  title: string,
  conflictSegments: { offset: number; duration: number }[] = []
): GanttEvent {
  return {
    id: ROOT_ID,
    parentId: undefined,
    children: [],
    hasChildren: false,
    level: 0,
    data: {
      duration: totalDuration,
      offset: 0,
      message: title,
      isRoot: false, // the Gantt's isRoot badge is job-specific
      isError,
      isPartial: false,
      isCancelled: false,
      level: "TRACE" as GanttEvent["data"]["level"],
      style: { icon: "location" },
      conflictSegments:
        conflictSegments.length > 0 ? conflictSegments : undefined
    }
  };
}
