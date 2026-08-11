import { DAY_MS } from "@carbon/utils";
import type { GanttEvent } from "~/components/Gantt";

/**
 * Pure mapping from scheduling data (job operations, capacity reservations,
 * production events) to the Gantt trace-viewer's event model. All date math
 * lives here so it can be unit-tested without a loader.
 *
 * Time semantics:
 * - Reservations and production events carry clock-precise timestamps.
 * - Operation startDate/dueDate are date-only; dueDate is an INCLUSIVE end
 *   date, so a date-derived span ends at dueDate + 1 day. Date-derived spans
 *   are marked isPartial (approximate).
 */

export type TimelineJob = {
  id: string;
  readableId: string;
  status: string | null;
};

export type TimelineOperation = {
  id: string;
  description: string | null;
  order: number;
  status: string | null;
  startDate: string | null;
  dueDate: string | null;
  hasConflict: boolean | null;
  conflictReason: string | null;
  assigneeName: string | null;
  workCenterName: string | null;
  /** Grouping key for the work-center view; name alone is not unique */
  workCenterId?: string | null;
  makeMethodId: string | null;
  makeMethodParentMaterialId: string | null;
  /** The make method that owns parentMaterialId — links subassembly → parent */
  makeMethodParentMakeMethodId?: string | null;
  /** BOM line order of parentMaterialId — stable sibling order across jobs */
  makeMethodParentMaterialOrder?: number | null;
  makeMethodItemReadableId: string | null;
};

export type TimelineReservation = {
  id: string;
  operationId: string;
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceName: string;
  startAt: string;
  endAt: string;
  /** Earliest the op could have started; startAt - earliestStartAt = queue time */
  earliestStartAt?: string | null;
  /** Engine's plain-words reason for the placement timing */
  scheduleNote?: string | null;
  /** Actual work content (hours) inside the interval, excluding off-shift pauses */
  workHours?: number | null;
};

export type TimelineProductionEvent = {
  id: string;
  operationId: string;
  type: string | null;
  employeeName: string | null;
  startTime: string;
  endTime: string | null;
};

export type TimelineNodeDetail = {
  kind:
    | "job"
    | "assembly"
    | "operation"
    | "reservation"
    | "productionEvent"
    | "resource";
  title: string;
  start: string | null; // ISO
  end: string | null; // ISO
  durationMs: number;
  approximate: boolean;
  status?: string | null;
  workCenterName?: string | null;
  assigneeName?: string | null;
  employeeName?: string | null;
  resourceKind?: "WorkCenter" | "OperatorPool" | "Employee";
  conflictReason?: string | null;
  /** Why the row starts when it does (queue, predecessor, operator) */
  scheduleNote?: string | null;
  /** Time spent waiting for capacity before the start */
  waitMs?: number;
  /**
   * Actual work content in ms when it differs from durationMs — a gated op's
   * span includes off-shift pauses ("6h of work across 22h").
   */
  workMs?: number;
  /**
   * Owning job for rows in the cross-job resource view, where each
   * reservation belongs to a different job. The single-job view leaves these
   * unset and links to the route's job instead.
   */
  jobId?: string;
  jobReadableId?: string;
};

export type JobTimeline = {
  events: GanttEvent[];
  totalDuration: number;
  windowStart: Date | undefined;
  detailsById: Record<string, TimelineNodeDetail>;
};

type Span = { start: number; end: number; approximate: boolean };

function parseDateOnly(date: string): number {
  return Date.parse(date);
}

function operationSpan(
  op: TimelineOperation,
  reservations: TimelineReservation[],
  fallbackStart: number,
  now: number
): Span {
  if (reservations.length > 0) {
    const start = Math.min(...reservations.map((r) => Date.parse(r.startAt)));
    const end = Math.max(...reservations.map((r) => Date.parse(r.endAt)));
    return { start, end: Math.max(end, start), approximate: false };
  }

  if (op.startDate) {
    const start = parseDateOnly(op.startDate);
    const end = op.dueDate ? parseDateOnly(op.dueDate) + DAY_MS : start;
    return { start, end: Math.max(end, start), approximate: true };
  }

  if (op.dueDate) {
    const end = parseDateOnly(op.dueDate) + DAY_MS;
    return { start: end - DAY_MS, end, approximate: true };
  }

  return { start: fallbackStart, end: fallbackStart, approximate: true };
}

export type TimelineGroupBy = "assembly" | "workCenter";

export function buildJobTimeline(input: {
  job: TimelineJob;
  operations: TimelineOperation[];
  reservations: TimelineReservation[];
  productionEvents: TimelineProductionEvent[];
  /**
   * Row grouping: "assembly" nests operations under the BOM structure;
   * "workCenter" groups them under the stations they run on (flat, in order
   * of first activity — the job read as a walk across the floor).
   */
  groupBy?: TimelineGroupBy;
  now?: Date;
}): JobTimeline {
  const { job, operations, reservations, productionEvents } = input;
  const groupBy = input.groupBy ?? "assembly";
  const now = (input.now ?? new Date()).getTime();

  const reservationsByOperation = new Map<string, TimelineReservation[]>();
  for (const r of reservations) {
    const list = reservationsByOperation.get(r.operationId) ?? [];
    list.push(r);
    reservationsByOperation.set(r.operationId, list);
  }

  const eventsByOperation = new Map<string, TimelineProductionEvent[]>();
  for (const e of productionEvents) {
    const list = eventsByOperation.get(e.operationId) ?? [];
    list.push(e);
    eventsByOperation.set(e.operationId, list);
  }

  // Window = min/max over PRECISE timestamps only (reservations, production
  // events, wait-ghost starts). Date-only columns are coarse fallbacks — an
  // unplaced/conflicted op keeps stale backward-pass dates (possibly weeks in
  // the past) and outside ops round to UTC midnight — letting them size the
  // window stretches the chart with dead space. Date-only spans render
  // CLAMPED into the window instead; they only size the window when the job
  // has nothing precise at all (never scheduled).
  const preciseTimestamps: number[] = [];
  for (const r of reservations) {
    preciseTimestamps.push(Date.parse(r.startAt), Date.parse(r.endAt));
    // The wait ghost extends left of the bar to when the op COULD have
    // started — the window must cover it
    if (r.earliestStartAt) {
      preciseTimestamps.push(Date.parse(r.earliestStartAt));
    }
  }
  for (const e of productionEvents) {
    preciseTimestamps.push(Date.parse(e.startTime));
    preciseTimestamps.push(e.endTime ? Date.parse(e.endTime) : now);
  }
  const dateOnlyTimestamps: number[] = [];
  for (const op of operations) {
    if (reservationsByOperation.has(op.id)) continue;
    if (op.startDate) dateOnlyTimestamps.push(parseDateOnly(op.startDate));
    if (op.dueDate) dateOnlyTimestamps.push(parseDateOnly(op.dueDate) + DAY_MS);
  }
  const timestamps =
    preciseTimestamps.length > 0 ? preciseTimestamps : dateOnlyTimestamps;

  const events: GanttEvent[] = [];
  const detailsById: Record<string, TimelineNodeDetail> = {};

  if (timestamps.length === 0) {
    const root: GanttEvent = {
      id: job.id,
      parentId: undefined,
      children: [],
      hasChildren: false,
      level: 0,
      data: {
        duration: 0,
        offset: 0,
        message: job.readableId,
        isRoot: true,
        isError: false,
        isPartial: false,
        isEstimated: true,
        isCancelled: false,
        level: "TRACE" as GanttEvent["data"]["level"],
        style: { icon: "job" }
      }
    };
    detailsById[job.id] = {
      kind: "job",
      title: job.readableId,
      start: null,
      end: null,
      durationMs: 0,
      approximate: true,
      status: job.status
    };
    return {
      events: [root],
      totalDuration: 0,
      windowStart: undefined,
      detailsById
    };
  }

  const windowStart = Math.min(...timestamps);
  const windowEnd = Math.max(...timestamps);
  const totalDuration = Math.max(windowEnd - windowStart, 1);

  const spanByOperation = new Map<string, Span>();
  for (const op of operations) {
    spanByOperation.set(
      op.id,
      operationSpan(
        op,
        reservationsByOperation.get(op.id) ?? [],
        windowStart,
        now
      )
    );
  }

  const sortedOperations = [...operations].sort((a, b) => {
    const sa = spanByOperation.get(a.id)!.start;
    const sb = spanByOperation.get(b.id)!.start;
    if (sa !== sb) return sa - sb;
    return a.order - b.order;
  });

  // Assembly grouping only when the job spans multiple make methods
  const makeMethodIds = new Set(
    operations.map((op) => op.makeMethodId).filter(Boolean)
  );
  const useAssemblies = groupBy === "assembly" && makeMethodIds.size > 1;

  const anyConflict = operations.some((op) => !!op.hasConflict);

  const root: GanttEvent = {
    id: job.id,
    parentId: undefined,
    children: [],
    hasChildren: false,
    level: 0,
    data: {
      duration: totalDuration,
      offset: 0,
      message: job.readableId,
      isRoot: true,
      isError: anyConflict,
      isPartial: false,
      isCancelled: false,
      level: "TRACE" as GanttEvent["data"]["level"],
      style: { icon: "job" }
    }
  };
  events.push(root);
  detailsById[job.id] = {
    kind: "job",
    title: job.readableId,
    start: new Date(windowStart).toISOString(),
    end: new Date(windowEnd).toISOString(),
    durationMs: totalDuration,
    approximate: false,
    status: job.status
  };

  const assemblyNodeByMakeMethod = new Map<string, GanttEvent>();
  if (useAssemblies) {
    // Discover methods in chronological order (keeps sibling order by first
    // activity), but NEST them by the BOM: a subassembly hangs under the
    // make method that consumes it, so the parent item reads top-down even
    // though its own (final assembly) operations start last.
    const methods: {
      id: string;
      label: string;
      parentMethodId: string | null;
      materialOrder: number;
      discoveryIndex: number;
    }[] = [];
    const seenMethods = new Set<string>();
    for (const op of sortedOperations) {
      if (!op.makeMethodId || seenMethods.has(op.makeMethodId)) continue;
      seenMethods.add(op.makeMethodId);
      methods.push({
        id: op.makeMethodId,
        label: op.makeMethodItemReadableId ?? job.readableId,
        parentMethodId: op.makeMethodParentMakeMethodId ?? null,
        materialOrder:
          op.makeMethodParentMaterialOrder ?? Number.MAX_SAFE_INTEGER,
        discoveryIndex: methods.length
      });
    }

    // Sibling order = BOM line order on the parent method (stable across
    // jobs of the same item); chronological discovery only breaks ties.
    // Bar positions on the time axis still show who runs first.
    methods.sort(
      (a, b) =>
        a.materialOrder - b.materialOrder || a.discoveryIndex - b.discoveryIndex
    );

    // Create every node first — a parent method's first operation starts
    // AFTER its children's, so it is discovered later
    for (const m of methods) {
      const node: GanttEvent = {
        id: m.id,
        parentId: job.id,
        children: [],
        hasChildren: false,
        level: 1,
        data: {
          duration: 0,
          offset: Number.MAX_SAFE_INTEGER,
          message: m.label,
          isRoot: false,
          isError: false,
          isPartial: false,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: { icon: "assembly", variant: "primary" }
        }
      };
      assemblyNodeByMakeMethod.set(m.id, node);
      events.push(node);
    }

    // Link child → parent method; unknown/missing parents attach to the job
    for (const m of methods) {
      const node = assemblyNodeByMakeMethod.get(m.id)!;
      const parentNode = m.parentMethodId
        ? assemblyNodeByMakeMethod.get(m.parentMethodId)
        : undefined;
      if (parentNode && parentNode !== node) {
        node.parentId = parentNode.id;
        parentNode.children.push(node.id);
        parentNode.hasChildren = true;
      } else {
        root.children.push(node.id);
        root.hasChildren = true;
      }
    }

    // Depth = distance from the job root (cycle-guarded)
    for (const m of methods) {
      const node = assemblyNodeByMakeMethod.get(m.id)!;
      let depth = 1;
      const visited = new Set<string>([m.id]);
      let cursor = node;
      while (cursor.parentId && cursor.parentId !== job.id) {
        if (visited.has(cursor.parentId)) break;
        visited.add(cursor.parentId);
        const up = assemblyNodeByMakeMethod.get(cursor.parentId);
        if (!up) break;
        depth++;
        cursor = up;
      }
      node.level = depth;
    }
  }

  // Work-center grouping: one flat group per station, discovered in order of
  // first activity so the tree reads chronologically down the floor
  const workCenterNodeByKey = new Map<string, GanttEvent>();
  const workCenterKey = (op: TimelineOperation) =>
    `wc:${op.workCenterId ?? "unassigned"}`;
  if (groupBy === "workCenter") {
    for (const op of sortedOperations) {
      const key = workCenterKey(op);
      if (workCenterNodeByKey.has(key)) continue;
      const node: GanttEvent = {
        id: key,
        parentId: job.id,
        children: [],
        hasChildren: false,
        level: 1,
        data: {
          duration: 0,
          offset: Number.MAX_SAFE_INTEGER,
          message: op.workCenterId
            ? (op.workCenterName ?? "Work Center")
            : "Unassigned",
          isRoot: false,
          isError: false,
          isPartial: false,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: { icon: "workCenter", variant: "primary" }
        }
      };
      workCenterNodeByKey.set(key, node);
      root.children.push(key);
      root.hasChildren = true;
      events.push(node);
    }
  }

  // How many conflicted operations sit under each group node — feeds the
  // group's side-panel entry so a bubbled-up red row explains itself
  const conflictCountByGroup = new Map<string, number>();

  // Rows within an assembly group follow the ROUTING (method order), not who
  // got a machine slot first — matches the BOM/method view; the bars'
  // horizontal positions still show actual timing. Groups are per-parent, so
  // a global sort by routing order gives each group its own ops correctly
  // ordered. Work-center groups instead read chronologically: within a
  // station the queue order IS the story.
  const routedOperations = [...operations].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return spanByOperation.get(a.id)!.start - spanByOperation.get(b.id)!.start;
  });
  const rowOperations =
    groupBy === "workCenter" ? sortedOperations : routedOperations;

  for (const op of rowOperations) {
    const span = spanByOperation.get(op.id)!;
    // Date-only spans don't size the window — clamp their BARS into it so an
    // unplaced op pins to the nearest edge as a sliver instead of stretching
    // the chart. The side panel keeps the real (unclamped) dates.
    const renderStart = span.approximate
      ? Math.min(Math.max(span.start, windowStart), windowEnd)
      : span.start;
    const renderEnd = span.approximate
      ? Math.min(Math.max(span.end, windowStart), windowEnd)
      : span.end;
    const parent =
      groupBy === "workCenter"
        ? (workCenterNodeByKey.get(workCenterKey(op)) ?? root)
        : (useAssemblies &&
            op.makeMethodId &&
            assemblyNodeByMakeMethod.get(op.makeMethodId)) ||
          root;
    const level = parent.level + 1;
    const isError = !!op.hasConflict;

    // Wait ghost + note come from the op's work-center reservation: how long
    // it queued before its slot, and the engine's reason in plain words
    const wcReservations = (reservationsByOperation.get(op.id) ?? [])
      .filter((r) => r.resourceKind === "WorkCenter")
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    const scheduleNote =
      wcReservations.find((r) => r.scheduleNote)?.scheduleNote ?? null;
    const earliestStartAt = wcReservations[0]?.earliestStartAt;
    const waitMs = earliestStartAt
      ? Math.max(span.start - Date.parse(earliestStartAt), 0)
      : 0;

    // In the work-center view, same-named steps from different subassemblies
    // sit adjacent under one station ("Drill", "Drill", "Drill") — carry the
    // assembly item in the label, the context the BOM nesting used to give
    const rowLabel =
      groupBy === "workCenter" &&
      makeMethodIds.size > 1 &&
      op.makeMethodItemReadableId
        ? `${op.description ?? op.id} — ${op.makeMethodItemReadableId}`
        : (op.description ?? op.id);

    // Who is booked by name for the attended window(s) — in booking order,
    // deduped (a shift relay books the same op to two people back to back)
    const operatorNames = [
      ...new Set(
        (reservationsByOperation.get(op.id) ?? [])
          .filter((r) => r.resourceKind === "Employee")
          .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
          .map((r) => r.resourceName)
      )
    ];

    const opEvent: GanttEvent = {
      id: op.id,
      parentId: parent.id,
      children: [],
      hasChildren: false,
      level,
      data: {
        duration: Math.max(renderEnd - renderStart, 0),
        offset: renderStart - windowStart,
        message: rowLabel,
        isRoot: false,
        isError,
        isPartial: false,
        isEstimated: span.approximate,
        isCancelled: false,
        // Always TRACE: only TRACE nodes render as duration bars; the
        // conflict signal rides on isError (red bar + triangle icon)
        level: "TRACE" as GanttEvent["data"]["level"],
        ...(waitMs > 0
          ? {
              wait: {
                offset: span.start - windowStart - waitMs,
                duration: waitMs,
                reason: scheduleNote
              }
            }
          : {}),
        style: {
          icon: "operation",
          variant: "primary",
          ...(op.assigneeName
            ? {
                accessory: {
                  style: "person" as const,
                  items: [{ text: op.assigneeName }]
                }
              }
            : {})
        }
      }
    };
    parent.children.push(op.id);
    parent.hasChildren = true;
    events.push(opEvent);
    detailsById[op.id] = {
      kind: "operation",
      title: rowLabel,
      start: new Date(span.start).toISOString(),
      end: new Date(span.end).toISOString(),
      durationMs: Math.max(span.end - span.start, 0),
      approximate: span.approximate,
      status: op.status,
      workCenterName: op.workCenterName,
      assigneeName: op.assigneeName,
      employeeName: operatorNames.length > 0 ? operatorNames.join(", ") : null,
      conflictReason: op.hasConflict ? op.conflictReason : null,
      scheduleNote,
      waitMs,
      workMs: wcReservations[0]?.workHours
        ? wcReservations[0].workHours * 3_600_000
        : undefined
    };

    // Grow the assembly node — and every ancestor assembly — to cover this
    // operation, and bubble the conflict flag up the chain. Grow both EDGES
    // independently: lowering the offset must not re-anchor the old duration
    // (that silently pulled the right edge left of already-covered ops).
    let ancestor: GanttEvent | null = parent === root ? null : parent;
    const growVisited = new Set<string>();
    while (ancestor && !growVisited.has(ancestor.id)) {
      growVisited.add(ancestor.id);
      const startOffset = renderStart - windowStart;
      const endOffset = renderEnd - windowStart;
      if (ancestor.data.offset === Number.MAX_SAFE_INTEGER) {
        ancestor.data.offset = startOffset;
        ancestor.data.duration = Math.max(endOffset - startOffset, 0);
      } else {
        const grownEnd = Math.max(
          ancestor.data.offset + ancestor.data.duration,
          endOffset
        );
        ancestor.data.offset = Math.min(ancestor.data.offset, startOffset);
        ancestor.data.duration = grownEnd - ancestor.data.offset;
      }
      if (isError) {
        ancestor.data.isError = true;
        conflictCountByGroup.set(
          ancestor.id,
          (conflictCountByGroup.get(ancestor.id) ?? 0) + 1
        );
      }
      ancestor =
        ancestor.parentId && ancestor.parentId !== job.id
          ? (assemblyNodeByMakeMethod.get(ancestor.parentId) ??
            workCenterNodeByKey.get(ancestor.parentId) ??
            null)
          : null;
    }

    // Child rows: reservations (machine + operator pool)
    for (const r of reservationsByOperation.get(op.id) ?? []) {
      const rStart = Date.parse(r.startAt);
      const rEnd = Date.parse(r.endAt);
      const child: GanttEvent = {
        id: r.id,
        parentId: op.id,
        children: [],
        hasChildren: false,
        level: level + 1,
        data: {
          duration: Math.max(rEnd - rStart, 0),
          offset: rStart - windowStart,
          message: r.resourceName,
          isRoot: false,
          isError: false,
          isPartial: false,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: {
            icon: r.resourceKind === "WorkCenter" ? "operation" : "wait",
            variant: "primary"
          }
        }
      };
      opEvent.children.push(child.id);
      opEvent.hasChildren = true;
      events.push(child);
      detailsById[r.id] = {
        kind: "reservation",
        title: r.resourceName,
        start: new Date(rStart).toISOString(),
        end: new Date(rEnd).toISOString(),
        durationMs: Math.max(rEnd - rStart, 0),
        approximate: false,
        resourceKind: r.resourceKind,
        scheduleNote: r.scheduleNote ?? null,
        workMs: r.workHours ? r.workHours * 3_600_000 : undefined
      };
    }

    // Child rows: actual production events (timecards)
    for (const e of eventsByOperation.get(op.id) ?? []) {
      const eStart = Date.parse(e.startTime);
      const eEnd = e.endTime ? Date.parse(e.endTime) : now;
      const child: GanttEvent = {
        id: e.id,
        parentId: op.id,
        children: [],
        hasChildren: false,
        level: level + 1,
        data: {
          duration: Math.max(eEnd - eStart, 0),
          offset: eStart - windowStart,
          message: e.type ?? "Timecard",
          isRoot: false,
          isError: false,
          isPartial: !e.endTime,
          isCancelled: false,
          level: "TRACE" as GanttEvent["data"]["level"],
          style: {
            icon: "timecard",
            variant: "primary",
            ...(e.employeeName
              ? {
                  accessory: {
                    style: "person" as const,
                    items: [{ text: e.employeeName }]
                  }
                }
              : {})
          }
        }
      };
      opEvent.children.push(child.id);
      opEvent.hasChildren = true;
      events.push(child);
      detailsById[e.id] = {
        kind: "productionEvent",
        title: e.type ?? "Timecard",
        start: new Date(eStart).toISOString(),
        end: e.endTime ? new Date(eEnd).toISOString() : null,
        durationMs: Math.max(eEnd - eStart, 0),
        approximate: !e.endTime,
        employeeName: e.employeeName
      };
    }
  }

  // Group detail entries — written after the operation loop so they use the
  // FINAL grown spans (a group covers all descendant operations)
  for (const node of assemblyNodeByMakeMethod.values()) {
    const hasSpan = node.data.offset !== Number.MAX_SAFE_INTEGER;
    const conflictCount = conflictCountByGroup.get(node.id) ?? 0;
    detailsById[node.id] = {
      kind: "assembly",
      title: node.data.message,
      start: hasSpan
        ? new Date(windowStart + node.data.offset).toISOString()
        : null,
      end: hasSpan
        ? new Date(
            windowStart + node.data.offset + node.data.duration
          ).toISOString()
        : null,
      durationMs: hasSpan ? node.data.duration : 0,
      approximate: false,
      conflictReason:
        conflictCount > 0
          ? conflictCount === 1
            ? "1 operation in this assembly has a scheduling conflict"
            : `${conflictCount} operations in this assembly have scheduling conflicts`
          : null
    };
  }
  for (const node of workCenterNodeByKey.values()) {
    const hasSpan = node.data.offset !== Number.MAX_SAFE_INTEGER;
    const conflictCount = conflictCountByGroup.get(node.id) ?? 0;
    detailsById[node.id] = {
      kind: "resource",
      title: node.data.message,
      start: hasSpan
        ? new Date(windowStart + node.data.offset).toISOString()
        : null,
      end: hasSpan
        ? new Date(
            windowStart + node.data.offset + node.data.duration
          ).toISOString()
        : null,
      durationMs: hasSpan ? node.data.duration : 0,
      approximate: false,
      workCenterName: node.data.message,
      conflictReason:
        conflictCount > 0
          ? conflictCount === 1
            ? "1 operation at this work center has a scheduling conflict"
            : `${conflictCount} operations at this work center have scheduling conflicts`
          : null
    };
  }

  // The TreeView renders the array as a pre-flattened depth-first list, so
  // every node's subtree must be contiguous — reorder from the parent/children
  // relationships (assemblies were appended before their operations above).
  const eventById = new Map(events.map((e) => [e.id, e]));
  const ordered: GanttEvent[] = [];
  const seen = new Set<string>();
  const visit = (e: GanttEvent) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    ordered.push(e);
    for (const childId of e.children) {
      const child = eventById.get(childId);
      if (child) visit(child);
    }
  };
  visit(root);
  for (const e of events) {
    visit(e); // safety net: keep any unreachable node visible
  }

  return {
    events: ordered,
    totalDuration,
    windowStart: new Date(windowStart),
    detailsById
  };
}
