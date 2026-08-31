/**
 * Slot allocator — places one operation into the earliest feasible interval
 * on a work center. Work centers are always finite with capacity 1: one
 * operation at a time, decided purely by actual reservation intervals.
 *
 * Labor is attended-window based: a person is hands-on only for the ATTENDED
 * portion (setup + labor) at the start of the operation; the remaining
 * machine run accumulates on calendar time with nobody present (lights-out).
 * Attended time accumulates whenever ANY eligible person is on shift and not
 * already booked; each contiguous stretch is booked to a specific person and
 * the work hands off at shift boundaries (relay). When nobody is available
 * the work pauses — the machine stays occupied — and resumes with the next
 * free qualified person. Pure given preloaded data: no DB access, fully
 * testable with fixtures.
 *
 * Timeline instants (starts, ends, reservation bounds, "now") are carried as
 * epoch-milliseconds `number`s — timezone-agnostic absolute instants, per
 * `.claude/rules/date-handling.md`.
 */

import {
  addWorkingTime,
  type CalendarWindow,
  coversInstant,
  findSlot
} from "./calendar-utils.ts";
import type { WaitAttribution } from "./conflict-messages.ts";
import { businessDayFromMs, HOUR_MS } from "./date-utils.ts";

export type ReservationInterval = {
  /** epoch-ms */
  startAt: number;
  /** epoch-ms */
  endAt: number;
  /**
   * Readable job number (e.g. J000001) of the job holding this reservation.
   * Set on live rows loaded from the DB (other jobs); in-run pushes for the
   * job being scheduled stay untagged, which is what excludes them from
   * blocker attribution in conflict messages.
   */
  readableJobId?: string;
};

export type ResourceCapacityData = {
  /** `alwaysOn` = a lights-out (24×7 unattended) station; exempt from the
   * require-staffing policy's machine-only-fallback removal. */
  workCenter: { id: string; alwaysOn?: boolean };
  windows: CalendarWindow[]; // the scheduling horizon (always open)
  reservations: ReservationInterval[]; // other jobs + earlier ops this run
};

/** A qualified person the caller has already eligibility-filtered. */
export type EligibleMember = {
  employeeId: string;
  windows: CalendarWindow[]; // from the person's shifts; 24/7 when unassigned
};

/** One person's contiguous stretch of hands-on work on an operation. */
export type AttendedSegment = {
  employeeId: string;
  /** epoch-ms */
  startAt: number;
  /** epoch-ms */
  endAt: number;
};

export type AllocationSuccess = {
  /** epoch-ms */
  start: number;
  /** epoch-ms */
  end: number;
  /** Why the start sits past `earliestStart`; null when nothing waited. */
  wait: WaitAttribution | null;
};

export type AttendedAllocationSuccess = {
  /** First attended instant (op start; == earliest feasible when no wait). epoch-ms */
  start: number;
  /** When hands-on work completes (== start when attendedHours is 0). epoch-ms */
  attendedEnd: number;
  /** attendedEnd + the unattended remainder on calendar time. epoch-ms */
  end: number;
  /** Person-by-person booking of the attended window; empty when 0h. */
  segments: AttendedSegment[];
  wait: WaitAttribution | null;
};

export type AllocationConflict = { conflict: string };
export type AllocationResult = AllocationSuccess | AllocationConflict;

export function isConflict(
  r: AllocationResult | AttendedAllocationSuccess | AllocationConflict
): r is AllocationConflict {
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
  from: number,
  to: number
): string | null {
  if (to <= from) return null;

  const opCountByJob = new Map<string, number>();
  for (const r of reservations) {
    if (!r.readableJobId) continue;
    if (r.startAt < to && r.endAt > from) {
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
    .map(
      ([jobId, count]) => `${jobId} (${count} ${count === 1 ? "op" : "ops"})`
    );
  const overflow = ranked.length - MAX_JOBS;
  if (overflow > 0) {
    parts.push(`+${overflow} more`);
  }
  return `queued behind ${parts.join(", ")}`;
}

/**
 * Machine freeness of [start, end): capacity is 1, so any overlapping
 * reservation makes the interval busy. Returns the earliest overlapping
 * reservation end as the retry hint.
 */
function machineIsFree(
  capacity: ResourceCapacityData,
  start: number,
  end: number
): { free: boolean; nextTryAfter?: number } {
  let earliestEnd: number | null = null;
  for (const r of capacity.reservations) {
    if (r.startAt < end && r.endAt > start) {
      const re = r.endAt;
      if (earliestEnd === null || re < earliestEnd) {
        earliestEnd = re;
      }
    }
  }
  if (earliestEnd !== null) {
    return { free: false, nextTryAfter: earliestEnd };
  }
  return { free: true };
}

/** A member is available at instant t when on shift and not already booked. */
function memberAvailableAt(
  member: EligibleMember,
  busy: ReservationInterval[],
  t: number
): boolean {
  if (!coversInstant(member.windows, t)) return false;
  return !busy.some((r) => r.startAt <= t && r.endAt > t);
}

/**
 * Accumulate `attendedHours` of hands-on work starting no earlier than
 * `from`, booking whoever is available per stretch (relay). Availability can
 * only change at member window or busy-interval boundaries, so the walk is
 * event-driven over those points. Continuity: the incumbent keeps the work
 * while available; otherwise the least-loaded available member takes over
 * (tie → employeeId, for determinism). Returns null when the horizon
 * exhausts before the attended work completes.
 */
function simulateAttended(args: {
  from: number;
  attendedHours: number;
  members: EligibleMember[];
  busyByEmployee: Map<string, ReservationInterval[]>;
  horizonEnd: number;
}): { segments: AttendedSegment[]; start: number; attendedEnd: number } | null {
  const { from, attendedHours, members, busyByEmployee, horizonEnd } = args;
  if (attendedHours <= 0) {
    return { segments: [], start: from, attendedEnd: from };
  }

  const fromMs = from;
  const horizonMs = horizonEnd;
  const busyOf = (id: string) => busyByEmployee.get(id) ?? [];
  const busyLoadMs = new Map<string, number>();
  for (const m of members) {
    busyLoadMs.set(
      m.employeeId,
      busyOf(m.employeeId).reduce((sum, r) => sum + (r.endAt - r.startAt), 0)
    );
  }

  // Availability change points: window and busy boundaries in (from, horizon)
  const boundaries = new Set<number>([fromMs]);
  for (const m of members) {
    for (const w of m.windows) {
      const ws = w.start;
      const we = w.end;
      if (ws > fromMs && ws < horizonMs) boundaries.add(ws);
      if (we > fromMs && we < horizonMs) boundaries.add(we);
    }
    for (const r of busyOf(m.employeeId)) {
      const rs = r.startAt;
      const re = r.endAt;
      if (rs > fromMs && rs < horizonMs) boundaries.add(rs);
      if (re > fromMs && re < horizonMs) boundaries.add(re);
    }
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);
  points.push(horizonMs);

  // Round to whole ms so fractional hours (5 min = 1/12 h) don't drift a
  // millisecond under floating point
  const attendedMs = Math.round(attendedHours * HOUR_MS);
  let accumulatedMs = 0;
  const segments: AttendedSegment[] = [];
  let incumbent: string | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const stretchStart = points[i]!;
    const stretchEnd = points[i + 1]!;
    if (stretchStart >= horizonMs) break;

    const available = members.filter((m) =>
      memberAvailableAt(m, busyOf(m.employeeId), stretchStart)
    );
    if (available.length === 0) continue; // pause — nobody free here

    const person: EligibleMember =
      (incumbent && available.find((m) => m.employeeId === incumbent)) ||
      available.reduce((best, m) => {
        const load = busyLoadMs.get(m.employeeId) ?? 0;
        const bestLoad = busyLoadMs.get(best.employeeId) ?? 0;
        if (load < bestLoad) return m;
        if (load === bestLoad && m.employeeId < best.employeeId) return m;
        return best;
      });

    const takeMs = Math.min(
      stretchEnd - stretchStart,
      attendedMs - accumulatedMs
    );
    const segEnd = stretchStart + takeMs;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.employeeId === person.employeeId &&
      last.endAt === stretchStart
    ) {
      last.endAt = segEnd;
    } else {
      segments.push({
        employeeId: person.employeeId,
        startAt: stretchStart,
        endAt: segEnd
      });
    }
    accumulatedMs += takeMs;
    incumbent = person.employeeId;

    if (accumulatedMs >= attendedMs) {
      return {
        segments,
        start: segments[0]!.startAt,
        attendedEnd: segEnd
      };
    }
  }
  return null; // horizon exhausted before attended work completed
}

/**
 * TEAM variant of the attended simulation: the station's whole people works the
 * SAME operation together. Every member available in a stretch is booked on
 * it (overlapping segments). Setup accumulates at 1x (a second pair of hands
 * doesn't speed up setup), labor accumulates at n x wall-clock where n is the
 * people present in that stretch — two welders finish 12h of weld labor in 6
 * wall-clock hours; if one leaves mid-op the rate drops to 1x. Returns the
 * wall-clock spent in the labor phase so the caller can credit the machine's
 * concurrent run. With one member this is behavior-identical to
 * simulateAttended (same rate, same bookings).
 */
function simulateAttendedTeam(args: {
  from: number;
  setupHours: number;
  laborHours: number;
  members: EligibleMember[];
  busyByEmployee: Map<string, ReservationInterval[]>;
  horizonEnd: number;
}): {
  segments: AttendedSegment[];
  start: number;
  attendedEnd: number;
  laborActiveWallMs: number;
} | null {
  const { from, setupHours, laborHours, members, busyByEmployee, horizonEnd } =
    args;
  const setupMs = Math.round(setupHours * HOUR_MS);
  const laborMs = Math.round(laborHours * HOUR_MS);
  if (setupMs + laborMs <= 0) {
    return {
      segments: [],
      start: from,
      attendedEnd: from,
      laborActiveWallMs: 0
    };
  }

  const fromMs = from;
  const horizonMs = horizonEnd;
  const busyOf = (id: string) => busyByEmployee.get(id) ?? [];

  // Availability change points: window and busy boundaries in (from, horizon)
  const boundaries = new Set<number>([fromMs]);
  for (const m of members) {
    for (const w of m.windows) {
      const ws = w.start;
      const we = w.end;
      if (ws > fromMs && ws < horizonMs) boundaries.add(ws);
      if (we > fromMs && we < horizonMs) boundaries.add(we);
    }
    for (const r of busyOf(m.employeeId)) {
      const rs = r.startAt;
      const re = r.endAt;
      if (rs > fromMs && rs < horizonMs) boundaries.add(rs);
      if (re > fromMs && re < horizonMs) boundaries.add(re);
    }
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);
  points.push(horizonMs);

  let setupDoneMs = 0;
  let laborDoneMs = 0;
  let laborActiveWallMs = 0;
  const segments: AttendedSegment[] = [];
  const lastSegmentByEmployee = new Map<string, AttendedSegment>();
  const bookAll = (
    available: EligibleMember[],
    startMs: number,
    endMs: number
  ) => {
    for (const m of available) {
      const last = lastSegmentByEmployee.get(m.employeeId);
      if (last && last.endAt === startMs) {
        last.endAt = endMs;
      } else {
        const segment: AttendedSegment = {
          employeeId: m.employeeId,
          startAt: startMs,
          endAt: endMs
        };
        segments.push(segment);
        lastSegmentByEmployee.set(m.employeeId, segment);
      }
    }
  };

  for (let i = 0; i < points.length - 1; i++) {
    let cursor = points[i]!;
    const stretchEnd = points[i + 1]!;
    if (cursor >= horizonMs) break;

    // Availability is constant within a stretch (all window/busy edges are
    // boundary points)
    const available = members.filter((m) =>
      memberAvailableAt(m, busyOf(m.employeeId), cursor)
    );
    if (available.length === 0) continue; // pause — nobody free here

    while (cursor < stretchEnd) {
      if (setupDoneMs < setupMs) {
        // Setup: one pair of hands' worth of progress; the whole present
        // people is at the station with the op regardless
        const take = Math.min(stretchEnd - cursor, setupMs - setupDoneMs);
        bookAll(available, cursor, cursor + take);
        setupDoneMs += take;
        cursor += take;
      } else if (laborDoneMs < laborMs) {
        const n = available.length;
        const wallNeeded = Math.ceil((laborMs - laborDoneMs) / n);
        const take = Math.min(stretchEnd - cursor, wallNeeded);
        bookAll(available, cursor, cursor + take);
        laborDoneMs = Math.min(laborMs, laborDoneMs + take * n);
        laborActiveWallMs += take;
        cursor += take;
      }
      if (setupDoneMs >= setupMs && laborDoneMs >= laborMs) {
        return {
          segments,
          start: segments[0]!.startAt,
          attendedEnd: cursor,
          laborActiveWallMs
        };
      }
    }
  }
  return null; // horizon exhausted before attended work completed
}

/**
 * Allocate a person-gated operation: the machine is held for the whole span
 * while people are booked only for the attended window (relay across
 * shifts). Walks forward from `earliestStart`; each machine collision hops
 * to the blocking reservation's end and the attended simulation re-runs.
 *
 * With `team` set (assigned stations), the members work the operation
 * TOGETHER: everyone present is booked on it, labor is parallelized across
 * the present people, setup and machine time are not (see
 * simulateAttendedTeam). The end is then derived from the machine hours
 * minus the machine run concurrent with the labor phase — `totalHours` (a
 * fixed setup + max(labor, machine)) would overstate the span when labor
 * compresses.
 */
export function allocateAttendedOperation(args: {
  attendedHours: number;
  totalHours: number; // >= attendedHours; remainder runs unattended
  earliestStart: number;
  horizonEnd: number; // never walk unbounded
  capacity: ResourceCapacityData;
  members: EligibleMember[]; // eligibility already applied by the caller
  busyByEmployee: Map<string, ReservationInterval[]>;
  /** IANA zone used to word dates in conflict messages (factory time) */
  timeZone?: string;
  /** People team mode: the members man the station together (see above). */
  team?: { setupHours: number; laborHours: number; machineHours: number };
}): AttendedAllocationSuccess | AllocationConflict {
  const {
    attendedHours,
    totalHours,
    earliestStart,
    horizonEnd,
    capacity,
    members,
    busyByEmployee,
    team
  } = args;
  const timeZone = args.timeZone ?? "UTC";

  const handsOnHours = team ? team.setupHours + team.laborHours : attendedHours;

  // No eligible people can never free up — immediate skill conflict (the
  // selector normally pre-empts this with a message naming the ability)
  if (handsOnHours > 0 && members.length === 0) {
    return { conflict: "No qualified operator available" };
  }

  const remainderMs = Math.round(
    Math.max(0, totalHours - attendedHours) * HOUR_MS
  );
  const exhausted = {
    conflict:
      handsOnHours > 0
        ? `No slot with both an open work center and a qualified operator available before ${businessDayFromMs(
            horizonEnd,
            timeZone
          )}`
        : `No work center capacity available before ${businessDayFromMs(
            horizonEnd,
            timeZone
          )}`
  };

  let cursor = earliestStart;
  let machineHopped = false;

  for (let guard = 0; guard < 100_000; guard++) {
    if (cursor >= horizonEnd) {
      return exhausted; // machine hops walked past the horizon
    }
    let sim: {
      segments: AttendedSegment[];
      start: number;
      attendedEnd: number;
    } | null;
    let laborActiveWallMs = 0;
    if (team) {
      const teamSim = simulateAttendedTeam({
        from: cursor,
        setupHours: team.setupHours,
        laborHours: team.laborHours,
        members,
        busyByEmployee,
        horizonEnd
      });
      sim = teamSim;
      laborActiveWallMs = teamSim?.laborActiveWallMs ?? 0;
    } else {
      sim = simulateAttended({
        from: cursor,
        attendedHours,
        members,
        busyByEmployee,
        horizonEnd
      });
    }
    if (!sim) {
      return {
        conflict: `No qualified operator availability before ${businessDayFromMs(
          horizonEnd,
          timeZone
        )}`
      };
    }

    // Unattended machine remainder: in team mode the machine gets credit for
    // its run concurrent with the (possibly compressed) labor wall-clock. The
    // remainder accumulates on the machine's OWN windows — a shift-bound
    // machine pauses overnight and resumes next window; an alwaysOn machine
    // (one continuous window) runs straight through. Zero remainder finishes
    // exactly at attendedEnd.
    const unattendedMs = team
      ? Math.max(0, Math.round(team.machineHours * HOUR_MS) - laborActiveWallMs)
      : remainderMs;
    const end = addWorkingTime(sim.attendedEnd, unattendedMs, capacity.windows);
    if (end === null || end > horizonEnd) {
      return exhausted; // machine windows run out (or finish past the horizon)
    }

    const machine = machineIsFree(capacity, sim.start, end);
    if (!machine.free) {
      machineHopped = true;
      const next = machine.nextTryAfter;
      cursor = next !== undefined && next > cursor ? next : cursor + 60_000; // defensive forward progress
      continue;
    }

    const waitedMs = sim.start - earliestStart;
    let wait: WaitAttribution | null = null;
    if (waitedMs > 0) {
      // Last blocker wins: if people pushed the start past the final machine
      // hop (sim.start > cursor), the operator side was binding; otherwise
      // the machine queue was.
      const resource: "machine" | "operator" =
        sim.start > cursor || !machineHopped ? "operator" : "machine";
      const source =
        resource === "machine"
          ? capacity.reservations
          : members.flatMap((m) => busyByEmployee.get(m.employeeId) ?? []);
      wait = {
        resource,
        blockers: formatBlockingJobs(source, earliestStart, sim.start),
        ownJobAhead: source.some(
          (r) =>
            !r.readableJobId && r.startAt < sim.start && r.endAt > earliestStart
        )
      };
    }

    return {
      start: sim.start,
      attendedEnd: sim.attendedEnd,
      end,
      segments: sim.segments,
      wait
    };
  }
  return exhausted;
}

/**
 * Allocate an UNGATED operation (no required ability): only the machine
 * gates. Walks forward from `earliestStart` to the first interval where the
 * work center is free (capacity 1) for the full duration.
 */
export function allocateOperation(args: {
  durationHours: number;
  earliestStart: number;
  horizonEnd: number; // never walk unbounded
  capacity: ResourceCapacityData;
  /** IANA zone used to word dates in conflict messages (factory time) */
  timeZone?: string;
}): AllocationResult {
  const { durationHours, earliestStart, horizonEnd, capacity } = args;
  const timeZone = args.timeZone ?? "UTC";

  const windows = capacity.windows.filter((w) => w.start < horizonEnd);
  if (windows.length === 0) {
    return {
      conflict: `No working time available at work center before ${businessDayFromMs(
        horizonEnd,
        timeZone
      )}`
    };
  }

  const slot = findSlot({
    windows,
    durationHours,
    earliestStart,
    isFree: (start, end) => {
      if (end > horizonEnd) {
        return { free: false }; // past the horizon; findSlot will exhaust
      }
      return machineIsFree(capacity, start, end);
    }
  });

  if (!slot) {
    return {
      conflict: `No work center capacity available before ${businessDayFromMs(
        horizonEnd,
        timeZone
      )}`
    };
  }

  const waitedMs = slot.start - earliestStart;
  let wait: WaitAttribution | null = null;
  if (waitedMs > 0) {
    wait = {
      resource: "machine",
      blockers: formatBlockingJobs(
        capacity.reservations,
        earliestStart,
        slot.start
      ),
      ownJobAhead: capacity.reservations.some(
        (r) =>
          !r.readableJobId && r.startAt < slot.start && r.endAt > earliestStart
      )
    };
  }

  return { start: slot.start, end: slot.end, wait };
}
