/**
 * Slot allocator — places one operation into the earliest feasible interval.
 * Work centers do NOT limit concurrency: anyone qualified can work at a
 * station, so the only finite resource is PEOPLE. When the operation's
 * process requires an ability, work accumulates only while at least one
 * qualified pool member is on shift AND not already reserved elsewhere;
 * operations without an ability requirement place at their earliest start
 * unconditionally. Pure given preloaded data: no DB access, fully testable
 * with fixtures.
 */

import {
  type CalendarWindow,
  countOverlaps,
  coversInstant,
  findSlot,
  unionWindows,
} from "./calendar-utils.ts";
import { toIsoDateInTimeZone } from "./date-utils.ts";

export type ReservationInterval = {
  startAt: Date;
  endAt: Date;
  /**
   * Readable job number (e.g. J000001) of the job holding this reservation.
   * Set on live rows loaded from the DB (other jobs); in-run pushes for the
   * job being scheduled stay untagged, which is what excludes them from
   * blocker attribution in conflict messages.
   */
  readableJobId?: string;
};

export type ResourceCapacityData = {
  workCenter: { id: string };
  windows: CalendarWindow[]; // the scheduling horizon (always open)
  reservations: ReservationInterval[]; // other jobs + earlier ops this run
};

export type PoolMember = {
  employeeId: string;
  windows: CalendarWindow[]; // from the person's shifts; 24/7 when unassigned
};

export type OperatorPool = {
  abilityId: string;
  abilityName: string;
  members: PoolMember[]; // eligibility already applied by the caller
  reservations: ReservationInterval[]; // existing OperatorPool reservations
};

export type AllocationSuccess = { start: Date; end: Date };
export type AllocationConflict = { conflict: string };
export type AllocationResult = AllocationSuccess | AllocationConflict;

export function isConflict(r: AllocationResult): r is AllocationConflict {
  return "conflict" in r;
}

/**
 * Name the jobs whose reservations occupy [from, to) — the region that
 * delayed an operation — so conflict messages can say WHO is ahead in the
 * queue, not just how late the finish is. Only intervals tagged with a
 * readableJobId count (untagged = the job being scheduled itself). Returns
 * e.g. "queued behind J000001 (3 ops), J000007 (1 op)", or null when no
 * other job's work overlaps the region.
 */
export function formatBlockingJobs(
  reservations: ReservationInterval[],
  from: Date,
  to: Date
): string | null {
  const f = from.getTime();
  const t = to.getTime();
  if (t <= f) return null;

  const opCountByJob = new Map<string, number>();
  for (const r of reservations) {
    if (!r.readableJobId) continue;
    if (r.startAt.getTime() < t && r.endAt.getTime() > f) {
      opCountByJob.set(
        r.readableJobId,
        (opCountByJob.get(r.readableJobId) ?? 0) + 1
      );
    }
  }
  if (opCountByJob.size === 0) return null;

  const ranked = Array.from(opCountByJob.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const MAX_JOBS = 3;
  const parts = ranked
    .slice(0, MAX_JOBS)
    .map(([jobId, count]) => `${jobId} (${count} ${count === 1 ? "op" : "ops"})`);
  const overflow = ranked.length - MAX_JOBS;
  if (overflow > 0) {
    parts.push(`+${overflow} more`);
  }
  return `queued behind ${parts.join(", ")}`;
}

/**
 * Pool freeness of [start, end): at every instant covered by a member's
 * shift window, the number of concurrent pool reservations must stay below
 * the number of members on shift. Instants no member covers are non-working
 * time for this operation (the accumulation windows exclude them), so they
 * need no operator.
 */
function poolIsFree(
  pool: OperatorPool,
  start: Date,
  end: Date
): { free: boolean; nextTryAfter?: Date } {
  const s = start.getTime();
  const e = end.getTime();

  // coverage can only change at member-window or reservation boundaries
  const samplePoints = new Set<number>([s]);
  for (const m of pool.members) {
    for (const w of m.windows) {
      const ws = w.start.getTime();
      const we = w.end.getTime();
      if (ws > s && ws < e) samplePoints.add(ws);
      if (we > s && we < e) samplePoints.add(we);
    }
  }
  for (const r of pool.reservations) {
    const rs = r.startAt.getTime();
    const re = r.endAt.getTime();
    if (rs > s && rs < e) samplePoints.add(rs);
    if (re > s && re < e) samplePoints.add(re);
  }

  for (const point of samplePoints) {
    const onShift = pool.members.filter((m) =>
      coversInstant(m.windows, point)
    ).length;
    if (onShift === 0) continue; // gap — no work accumulates here
    const at = new Date(point);
    const busy = countOverlaps(pool.reservations, at, new Date(point + 1));
    if (busy >= onShift) {
      const candidates = pool.reservations
        .filter((r) => r.startAt.getTime() <= point && r.endAt.getTime() > point)
        .map((r) => r.endAt.getTime());
      const nextTry = candidates.length > 0 ? Math.min(...candidates) : null;
      return {
        free: false,
        nextTryAfter: nextTry !== null ? new Date(nextTry) : undefined,
      };
    }
  }
  return { free: true };
}

/**
 * Allocate one operation. Walks forward from `earliestStart` to the first
 * interval where the work center is free AND (when the process requires an
 * ability) a qualified pool member is on shift and unreserved. For gated
 * operations the accumulation windows are the UNION of the pool members'
 * shift windows — work pauses while nobody qualified is on shift.
 */
export function allocateOperation(args: {
  durationHours: number;
  earliestStart: Date;
  horizonEnd: Date; // never walk unbounded
  capacity: ResourceCapacityData;
  operatorPool?: OperatorPool | null;
  /** IANA zone used to word dates in conflict messages (factory time) */
  timeZone?: string;
}): AllocationResult {
  const { durationHours, earliestStart, horizonEnd, capacity } = args;
  const pool = args.operatorPool ?? null;
  const timeZone = args.timeZone ?? "UTC";

  // A pool with zero eligible members can never free up — immediate skill conflict
  if (pool && pool.members.length === 0) {
    return {
      conflict: `No qualified operator for ${pool.abilityName}`,
    };
  }

  // Accumulation windows: the pool's on-shift time for gated operations,
  // else the work center's always-open horizon. Clip to the horizon.
  const baseWindows = pool
    ? unionWindows(pool.members.map((m) => m.windows))
    : capacity.windows;
  const windows = baseWindows.filter(
    (w) => w.start.getTime() < horizonEnd.getTime()
  );
  if (windows.length === 0) {
    return {
      conflict: pool
        ? `No qualified operator on shift for ${pool.abilityName} before ${
            toIsoDateInTimeZone(horizonEnd, timeZone)
          }`
        : `No working time available at work center before ${
            toIsoDateInTimeZone(horizonEnd, timeZone)
          }`,
    };
  }

  const slot = findSlot({
    windows,
    durationHours,
    earliestStart,
    isFree: (start, end) => {
      if (end.getTime() > horizonEnd.getTime()) {
        return { free: false }; // past the horizon; findSlot will exhaust
      }
      // Work centers do NOT limit concurrency — anyone qualified can work
      // at a station, so the only finite resource is the operator pool.
      // Ungated operations (no required ability) place at their earliest
      // start unconditionally.
      return pool ? poolIsFree(pool, start, end) : { free: true };
    },
  });

  if (!slot) {
    const cause = pool
      ? "No qualified operator availability"
      : "No working time";
    return {
      conflict: `${cause} available before ${
        toIsoDateInTimeZone(horizonEnd, timeZone)
      }`,
    };
  }

  return slot;
}
