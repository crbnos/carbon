import type { GanttEvent } from "~/components/Gantt";
import type { TimelineNodeDetail } from "./timeline";

/**
 * Pure mapping from cross-job capacity reservations to the Gantt's event
 * model, as a `Location > Work Center > Operation > People` tree. A staffed
 * operation reserves TWO finite resources — the work center (machine hold, the
 * op's full span including off-shift gaps) and the operator (only the attended
 * segments) — so the engine writes two reservations for one op. The OPERATION is
 * the anchor: its machine hold is the op node, and the operators who worked it
 * nest beneath, recovered via the shared operationId:
 *
 *   Location
 *   └─ Work Center
 *      └─ Operation (machine hold — the op's full span)
 *         └─ Person (attended segment — who worked it, and when)
 *
 * So the op appears once (not as separate machine + person peers), each station
 * reads as "these ops run here, worked by these people", and a person on two
 * stations appears under each op they staffed. A machine-only or unschedulable
 * op simply has no people beneath it. The Gantt renders strictly one bar per
 * row, so every node is its own row.
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
  /**
   * The operation this reservation serves. The machine (WorkCenter) reservation
   * and the operator (Employee) reservation for the same op share it — that's
   * how an operator segment is re-homed under the work center of its op.
   */
  operationId: string;
  operationDescription: string | null;
  hasConflict: boolean;
  conflictReason: string | null;
  /**
   * Non-binding placeholder for an operation the scheduler could not place — its
   * bar marks "where it would run" so the job doesn't silently end after its last
   * placeable op. Rendered distinctly (blocked icon) and never holds capacity.
   */
  unschedulable: boolean;
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

/**
 * One operation at a work center: its machine hold (the WorkCenter reservation,
 * the op's full span) and the operator segments worked on it (Employee
 * reservations). The op is the anchor — the operators nest under it.
 */
type OpGroup = {
  machine: ResourceTimelineReservation;
  workers: ResourceTimelineReservation[];
};

type Lane = {
  id: string;
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceName: string;
  /** WorkCenter lanes: operationId → its machine hold + operator segments. */
  ops: Map<string, OpGroup>;
  /** Fallback lanes (legacy OperatorPool / orphan operator): their own bars. */
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

  // Each operation's work center, recovered from its machine reservation — the
  // key that re-homes an operator's segment under the op it staffed.
  const opToWorkCenter = new Map<string, string>();
  for (const r of reservations) {
    if (r.resourceKind === "WorkCenter") {
      opToWorkCenter.set(r.operationId, r.resourceId);
    }
  }

  // Work-center lanes, seeded for every plant station so idle ones still show.
  const wcLaneByKey = new Map<string, Lane>();
  const getWcLane = (workCenterId: string, name?: string): Lane => {
    const key = `WorkCenter:${workCenterId}`;
    let lane = wcLaneByKey.get(key);
    if (!lane) {
      lane = {
        id: `lane:${key}`,
        resourceKind: "WorkCenter",
        resourceName: name ?? "Work Center",
        ops: new Map(),
        reservations: [],
        maintenance: []
      };
      wcLaneByKey.set(key, lane);
    } else if (name && lane.resourceName === "Work Center") {
      lane.resourceName = name;
    }
    return lane;
  };
  for (const workCenter of workCenters) {
    getWcLane(workCenter.id, workCenter.name);
  }

  // Each machine hold defines an OPERATION node under its work-center lane.
  for (const r of reservations) {
    if (r.resourceKind === "WorkCenter") {
      getWcLane(r.resourceId, r.resourceName).ops.set(r.operationId, {
        machine: r,
        workers: []
      });
    }
  }
  // Maintenance outages — same lane as the machine they take offline.
  for (const m of maintenance) {
    getWcLane(m.workCenterId).maintenance.push(m);
  }

  // Operator segments nest under their OPERATION. An Employee reservation with
  // no locatable machine reservation (should not happen — the op always has
  // one) and legacy OperatorPool rows fall back to a top-level lane so their
  // hours are never dropped.
  const fallbackLaneByKey = new Map<string, Lane>();
  const getFallbackLane = (
    kind: "Employee" | "OperatorPool",
    id: string,
    name: string
  ): Lane => {
    const key = `${kind}:${id}`;
    let lane = fallbackLaneByKey.get(key);
    if (!lane) {
      lane = {
        id: `lane:${key}`,
        resourceKind: kind,
        resourceName: name,
        ops: new Map(),
        reservations: [],
        maintenance: []
      };
      fallbackLaneByKey.set(key, lane);
    }
    return lane;
  };
  for (const r of reservations) {
    if (r.resourceKind === "Employee") {
      const workCenterId = opToWorkCenter.get(r.operationId);
      const op = workCenterId
        ? getWcLane(workCenterId).ops.get(r.operationId)
        : undefined;
      if (op) {
        op.workers.push(r);
      } else {
        getFallbackLane(
          "Employee",
          r.resourceId,
          r.resourceName
        ).reservations.push(r);
      }
    } else if (r.resourceKind === "OperatorPool") {
      getFallbackLane(
        "OperatorPool",
        r.resourceId,
        r.resourceName
      ).reservations.push(r);
    }
  }

  // Work centers alpha, then fallback lanes (operators before legacy pools).
  const kindRank = { WorkCenter: 0, Employee: 1, OperatorPool: 2 } as const;
  const lanes = [
    ...Array.from(wcLaneByKey.values()).sort((a, b) =>
      a.resourceName.localeCompare(b.resourceName)
    ),
    ...Array.from(fallbackLaneByKey.values()).sort((a, b) =>
      a.resourceKind !== b.resourceKind
        ? kindRank[a.resourceKind] - kindRank[b.resourceKind]
        : a.resourceName.localeCompare(b.resourceName)
    )
  ];

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

  const byStart = (
    a: ResourceTimelineReservation,
    b: ResourceTimelineReservation
  ) => Date.parse(a.startAt) - Date.parse(b.startAt);

  const spanOf = (starts: number[], ends: number[]) => ({
    start: starts.length
      ? clamp(Math.min(...starts), windowStart, windowEnd)
      : windowStart,
    end: ends.length
      ? clamp(Math.max(...ends), windowStart, windowEnd)
      : windowStart
  });

  // A reservation → its Gantt bar (+ detail). Reused for operation nodes (the
  // machine hold), operator segments, and legacy pool / orphan rows. The detail
  // panel keeps the full "job · operation" label whatever the bar is titled.
  const buildReservationBar = (
    r: ResourceTimelineReservation,
    parentId: string,
    level: number,
    opts?: { message?: string; icon?: string }
  ): GanttEvent => {
    const rawStart = Date.parse(r.startAt);
    const rawEnd = Date.parse(r.endAt);
    const barStart = clamp(rawStart, windowStart, windowEnd);
    const barEnd = clamp(rawEnd, windowStart, windowEnd);
    detailsById[r.id] = {
      kind: "reservation",
      title: r.operationDescription
        ? `${r.jobReadableId} · ${r.operationDescription}`
        : r.jobReadableId,
      start: new Date(rawStart).toISOString(),
      end: new Date(rawEnd).toISOString(),
      durationMs: Math.max(rawEnd - rawStart, 0),
      approximate: false,
      resourceKind: r.resourceKind,
      workCenterName: r.resourceKind === "WorkCenter" ? r.resourceName : null,
      employeeName: r.resourceKind === "Employee" ? r.resourceName : null,
      conflictReason: r.hasConflict ? r.conflictReason : null,
      unschedulable: r.unschedulable,
      scheduleNote: r.scheduleNote ?? null,
      workMs: r.workHours ? r.workHours * 3_600_000 : undefined,
      jobId: r.jobId,
      jobReadableId: r.jobReadableId
    };
    return {
      id: r.id,
      parentId,
      children: [],
      hasChildren: false,
      level,
      data: {
        duration: Math.max(barEnd - barStart, 0),
        offset: barStart - windowStart,
        message: opts?.message ?? r.jobReadableId,
        isRoot: false,
        isError: r.hasConflict,
        // An unplaceable op's placeholder reads distinctly from a placed-but-late
        // op: same red bar (isError), but a "can't be scheduled" alert in the
        // status column instead of the generic conflict triangle.
        isUnschedulable: r.unschedulable,
        isPartial: false,
        isCancelled: false,
        // Always TRACE: only TRACE nodes render as duration bars.
        level: "TRACE" as GanttEvent["data"]["level"],
        style: { icon: opts?.icon ?? "operation", variant: "primary" }
      }
    };
  };

  // Built depth-first (lane → operation nodes → their operator segments) — the
  // TreeView renders the array as a pre-flattened depth-first list.
  for (const lane of lanes) {
    // Operation nodes (the machine hold) with operator segments nested under
    // each. The op is the anchor bar; a machine-only or unschedulable op simply
    // has no operators beneath it. Titled "{job} · {op}" so the op reads clearly
    // under its station.
    const opNodes = [...lane.ops.values()]
      .sort((a, b) => byStart(a.machine, b.machine))
      .map((op) => {
        const node = buildReservationBar(op.machine, lane.id, 2, {
          message: op.machine.operationDescription
            ? `${op.machine.jobReadableId} · ${op.machine.operationDescription}`
            : op.machine.jobReadableId
        });
        const workerBars = [...op.workers].sort(byStart).map((w) =>
          buildReservationBar(w, op.machine.id, 3, {
            message: w.resourceName,
            icon: "person"
          })
        );
        node.children = workerBars.map((b) => b.id);
        node.hasChildren = workerBars.length > 0;
        return { node, workerBars };
      });

    // Fallback-lane direct bars (orphan operator / legacy pool).
    const directBars = [...lane.reservations]
      .sort(byStart)
      .map((r) => buildReservationBar(r, lane.id, 2));

    // Maintenance outages — amber "downtime" bars on the machine's lane.
    const maintenanceBars: GanttEvent[] = [];
    for (const m of [...lane.maintenance].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
    )) {
      const rawStart = Date.parse(m.startAt);
      const rawEnd = Date.parse(m.endAt);
      const barStart = clamp(rawStart, windowStart, windowEnd);
      const barEnd = clamp(rawEnd, windowStart, windowEnd);
      if (barEnd <= barStart) continue; // outage entirely outside the view
      maintenanceBars.push({
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

    // Level-2 children interleave by start: operation nodes, fallback bars,
    // maintenance. Each operation's operator segments trail it (below).
    const level2 = [
      ...opNodes.map((o) => o.node),
      ...directBars,
      ...maintenanceBars
    ].sort((a, b) => a.data.offset - b.data.offset);
    const workerBarsByOp = new Map(
      opNodes.map((o) => [o.node.id, o.workerBars])
    );

    // Lane span + conflict rollups cover every op (machine + operator segments)
    // and fallback bar. Placeholders are machine-side only, so the stronger
    // "can't be scheduled" rollup keys off the operation nodes.
    const opMachines = [...lane.ops.values()].map((o) => o.machine);
    const opWorkers = [...lane.ops.values()].flatMap((o) => o.workers);
    const rollupRes = [...opMachines, ...opWorkers, ...lane.reservations];
    const laneSpan = spanOf(
      [
        ...rollupRes.map((r) => Date.parse(r.startAt)),
        ...lane.maintenance.map((m) => Date.parse(m.startAt))
      ],
      [
        ...rollupRes.map((r) => Date.parse(r.endAt)),
        ...lane.maintenance.map((m) => Date.parse(m.endAt))
      ]
    );
    const laneTitle =
      lane.resourceKind === "OperatorPool"
        ? `${lane.resourceName} operators` // legacy ability-pool rows
        : lane.resourceName;
    const laneIcon =
      lane.resourceKind === "WorkCenter"
        ? "workCenter"
        : lane.resourceKind === "Employee"
          ? "person"
          : "wait";

    const laneEvent: GanttEvent = {
      id: lane.id,
      parentId: ROOT_ID,
      children: level2.map((e) => e.id),
      hasChildren: level2.length > 0,
      level: 1,
      data: {
        duration: Math.max(laneSpan.end - laneSpan.start, 0),
        offset: laneSpan.start - windowStart,
        message: laneTitle,
        isRoot: false,
        isError: rollupRes.some((r) => r.hasConflict),
        isUnschedulable: opMachines.some((r) => r.unschedulable),
        isPartial: false,
        isCancelled: false,
        level: "TRACE" as GanttEvent["data"]["level"],
        style: { icon: laneIcon, variant: "primary" }
      }
    };
    root.children.push(lane.id);
    root.hasChildren = true;
    detailsById[lane.id] = {
      kind: "resource",
      title: laneTitle,
      start: new Date(laneSpan.start).toISOString(),
      end: new Date(laneSpan.end).toISOString(),
      durationMs: Math.max(laneSpan.end - laneSpan.start, 0),
      approximate: false,
      resourceKind: lane.resourceKind
    };
    events.push(laneEvent);
    // Depth-first: each level-2 node, immediately followed by an operation
    // node's operator segments (fallback bars / maintenance have none).
    for (const node of level2) {
      events.push(node, ...(workerBarsByOp.get(node.id) ?? []));
    }
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
