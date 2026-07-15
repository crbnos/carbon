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
  resourceKind: "WorkCenter" | "OperatorPool";
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
  resourceKind: "WorkCenter" | "OperatorPool";
  resourceName: string;
  reservations: ResourceTimelineReservation[];
};

export function buildResourceTimeline(input: {
  reservations: ResourceTimelineReservation[];
}): ResourceTimeline {
  const { reservations } = input;

  const detailsById: Record<string, TimelineNodeDetail> = {};

  if (reservations.length === 0) {
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
  const windowStart = Math.min(...timestamps);
  const windowEnd = Math.max(...timestamps);
  const totalDuration = Math.max(windowEnd - windowStart, 1);

  // One lane per resource; work centers first, each group alphabetical
  const laneByKey = new Map<string, Lane>();
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
  const lanes = Array.from(laneByKey.values()).sort((a, b) => {
    if (a.resourceKind !== b.resourceKind) {
      return a.resourceKind === "WorkCenter" ? -1 : 1;
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
    const laneStart = Math.min(...sorted.map((r) => Date.parse(r.startAt)));
    const laneEnd = Math.max(...sorted.map((r) => Date.parse(r.endAt)));
    const laneConflict = sorted.some((r) => r.hasConflict);
    const laneTitle =
      lane.resourceKind === "WorkCenter"
        ? lane.resourceName
        : `${lane.resourceName} operators`;

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
      const rStart = Date.parse(r.startAt);
      const rEnd = Date.parse(r.endAt);
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
          duration: Math.max(rEnd - rStart, 0),
          offset: rStart - windowStart,
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
        start: new Date(rStart).toISOString(),
        end: new Date(rEnd).toISOString(),
        durationMs: Math.max(rEnd - rStart, 0),
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
