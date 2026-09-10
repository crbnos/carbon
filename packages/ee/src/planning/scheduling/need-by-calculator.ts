/**
 * Backward need-by (demand-anchored target) calculator.
 * Pure functions — no DB access, no writes, no conflict flags.
 *
 * Revives origin/main's `BackwardSchedulingStrategy` walk as a TARGET
 * calculator (spec .ai/specs/2026-08-15-dual-dates-due-vs-projected.md):
 * reverse topological order from the job's due date, each operation due at the
 * earliest dependent constraint (dependent's need-by start minus that
 * dependent's `operationLeadTime`, minus `assemblyLeadTime` at assembly
 * edges), with two upgrades over main:
 *
 * 1. Real day lengths — duration-in-days uses the work center's calendar
 *    (`calendarHoursPerDay`), not a hardcoded 8h business day, and the
 *    day walk skips that calendar's zero-hour days (`workingDayTest`), not a
 *    hardcoded Sat/Sun.
 * 2. No conflict flags — lateness verdicts come from comparing the forward
 *    projection against these targets, never from this pass.
 *
 * HARD RULE: the result is written to `jobOperation.dueDate` and read by
 * NOTHING in the placement path. Targets never floor, delay, or otherwise
 * influence forward placement.
 *
 * All date math is pure calendar arithmetic on "YYYY-MM-DD" strings via
 * `@internationalized/date` — never local-timezone JS Date semantics.
 */

import { getDayOfWeek, parseDate } from "@internationalized/date";
import type { CalendarWindow } from "./calendar-utils.ts";
import { businessDayFromMs, MINUTE_MS } from "./date-utils.ts";
import type { DependencyGraph, ScheduledOperation } from "./types.ts";

/**
 * Defensive termination for the working-day walk: a calendar that yields no
 * working day for a full year is treated as always-open from there. Keeps the
 * walk total when a target chain runs past the availability horizon (dates
 * with no loaded windows test as non-working).
 */
const MAX_CONSECUTIVE_CLOSED_DAYS = 366;

/** Floor for a calendar's working-day length (avoids division by zero). */
const MIN_HOURS_PER_DAY = 1;

/**
 * Subtract `days` WORKING days from a "YYYY-MM-DD" date — one day at a time,
 * counting only days where `isWorkingDay` is true (main's hardcoded Sat/Sun
 * skip, generalized to the calendar). Fractional day counts subtract like
 * main's `subtractBusinessDays` (`while (remaining > 0) remaining--`): 1.5
 * days costs 2 working days.
 */
function subtractWorkingDays(
  isoDate: string,
  days: number,
  isWorkingDay: (isoDate: string) => boolean
): string {
  let date = parseDate(isoDate);
  let remaining = days;
  let consecutiveClosed = 0;

  while (remaining > 0) {
    date = date.subtract({ days: 1 });
    if (
      consecutiveClosed >= MAX_CONSECUTIVE_CLOSED_DAYS ||
      isWorkingDay(date.toString())
    ) {
      remaining--;
      if (consecutiveClosed < MAX_CONSECUTIVE_CLOSED_DAYS) {
        consecutiveClosed = 0;
      }
    } else {
      consecutiveClosed++;
    }
  }

  return date.toString();
}

/**
 * Compute the demand-anchored need-by DUE date per operation.
 *
 * - `jobDueDate` null → every operation maps to null (nothing is "due"; no
 *   `today` fallback — that was main's forecast leak).
 * - Leaf operations (no dependents) are due on the job due date.
 * - An operation with dependents is due at the EARLIEST dependent constraint:
 *   the dependent's need-by START, minus that dependent's `operationLeadTime`
 *   working days, minus this op's `assemblyLeadTime` working days when the
 *   edge crosses make methods (a subassembly's output feeding its parent).
 * - Need-by start = due minus `ceil(durationHours / calendarHoursPerDay(wc))`
 *   working days (min 1 day) on the op's own calendar.
 * - "With Previous" operations copy their partner's target dates (the nearest
 *   preceding non-"With Previous" op by `order` in the same make method — in
 *   the dependency graph the pair are SIBLINGS sharing the same dependents,
 *   so the partner is found by the same order scan
 *   `buildOperationDependencies` uses, not via graph edges).
 * - A `manuallyScheduled` op with a stored `dueDate` is a pin: the map returns
 *   the stored value unchanged AND upstream ops derive their constraints from
 *   it (the pin propagates).
 */
export function computeNeedByDates(args: {
  operations: ScheduledOperation[];
  graph: DependencyGraph;
  jobDueDate: string | null;
  calendarHoursPerDay: (workCenterId: string | null) => number;
  workingDayTest: (workCenterId: string | null, isoDate: string) => boolean;
}): Map<string, string | null> {
  const { operations, graph, jobDueDate, calendarHoursPerDay, workingDayTest } =
    args;
  const result = new Map<string, string | null>();

  if (!jobDueDate) {
    for (const op of operations) {
      result.set(op.id, null);
    }
    return result;
  }
  const anchor = jobDueDate.slice(0, 10);

  const operationMap = new Map<string, ScheduledOperation>();
  for (const op of operations) {
    operationMap.set(op.id, op);
  }

  type Target = { dueDate: string; startDate: string };
  const targets = new Map<string, Target>();
  // Re-entrancy guard: the graph is a DAG in practice, but the "With Previous"
  // partner copy resolves ahead of the topological order — a malformed cyclic
  // graph must degrade (skip the edge), not hang.
  const visiting = new Set<string>();

  const isWorkingDayFor =
    (workCenterId: string | null | undefined) => (isoDate: string) =>
      workingDayTest(workCenterId ?? null, isoDate);

  const durationDaysFor = (op: ScheduledOperation): number => {
    const hoursPerDay = calendarHoursPerDay(op.workCenterId ?? null);
    if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0) {
      return 1;
    }
    return Math.max(Math.ceil(op.durationHours / hoursPerDay), 1);
  };

  /**
   * The op a "With Previous" operation runs with: the nearest preceding
   * non-"With Previous" operation by `order` within the same make method
   * (mirrors `buildOperationDependencies`'s adjusted-order scan).
   */
  const partnerOf = (op: ScheduledOperation): ScheduledOperation | null => {
    const siblings = operations
      .filter(
        (candidate) =>
          (candidate.jobMakeMethodId ?? null) === (op.jobMakeMethodId ?? null)
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = siblings.findIndex((candidate) => candidate.id === op.id);
    for (let i = index - 1; i >= 0; i--) {
      if (siblings[i]!.operationOrder !== "With Previous") {
        return siblings[i]!;
      }
    }
    return null;
  };

  const resolveTarget = (opId: string): Target | null => {
    const known = targets.get(opId);
    if (known) return known;
    const op = operationMap.get(opId);
    if (!op) return null;
    if (visiting.has(opId)) return null;

    visiting.add(opId);
    try {
      const target = computeTarget(op);
      targets.set(opId, target);
      return target;
    } finally {
      visiting.delete(opId);
    }
  };

  const computeTarget = (op: ScheduledOperation): Target => {
    // Manual pin: the stored due date is taken as-is; the start is still
    // derived so upstream operations chain off the pin.
    if (op.manuallyScheduled && op.dueDate) {
      const dueDate = op.dueDate.slice(0, 10);
      return {
        dueDate,
        startDate: subtractWorkingDays(
          dueDate,
          durationDaysFor(op),
          isWorkingDayFor(op.workCenterId)
        )
      };
    }

    // "With Previous": runs concurrently with its partner — same target dates.
    if (op.operationOrder === "With Previous") {
      const partner = partnerOf(op);
      if (partner) {
        const copied = resolveTarget(partner.id);
        if (copied) {
          return { ...copied };
        }
      }
    }

    // Due date: job due date for leaves, else the earliest dependent
    // constraint (ported from main's BackwardSchedulingStrategy).
    const dependents = graph.getDependents(op.id);
    let dueDate = anchor;
    if (dependents.length > 0) {
      const constraints: string[] = [];
      for (const dependentId of dependents) {
        const dependentOp = operationMap.get(dependentId);
        const dependentTarget = resolveTarget(dependentId);
        if (!dependentTarget) continue;

        let constraint = dependentTarget.startDate;

        // Operation-level lead time on the consuming (dependent) operation:
        // how early this input must be ready before that operation starts —
        // counted on the dependent's calendar (its start anchors the gap).
        const operationLeadTime = dependentOp?.operationLeadTime ?? 0;
        if (operationLeadTime > 0) {
          constraint = subtractWorkingDays(
            constraint,
            operationLeadTime,
            isWorkingDayFor(dependentOp?.workCenterId)
          );
        }

        // Assembly boundary: this op is a subassembly's operation feeding a
        // parent make method's operation. Pull the target back by the
        // subassembly item's manufacturing lead time so the whole subassembly
        // targets finishing that many days early.
        const isAssemblyEdge =
          !!op.jobMakeMethodId &&
          !!dependentOp?.jobMakeMethodId &&
          op.jobMakeMethodId !== dependentOp.jobMakeMethodId;
        const assemblyLeadTime = op.assemblyLeadTime ?? 0;
        if (isAssemblyEdge && assemblyLeadTime > 0) {
          constraint = subtractWorkingDays(
            constraint,
            assemblyLeadTime,
            isWorkingDayFor(op.workCenterId)
          );
        }

        constraints.push(constraint);
      }
      if (constraints.length > 0) {
        // Earliest constraint wins — "YYYY-MM-DD" compares lexicographically.
        dueDate = constraints.reduce((a, b) => (a < b ? a : b));
      }
    }

    return {
      dueDate,
      startDate: subtractWorkingDays(
        dueDate,
        durationDaysFor(op),
        isWorkingDayFor(op.workCenterId)
      )
    };
  };

  // Main's reverse-topological walk (leaves first). `resolveTarget` memoizes,
  // so the "With Previous" partner copy — a sibling that may sit later in the
  // same wave — resolves on demand without disturbing the order.
  for (const opId of graph.topologicalSort("reverse")) {
    resolveTarget(opId);
  }

  for (const op of operations) {
    result.set(op.id, resolveTarget(op.id)?.dueDate ?? null);
  }

  return result;
}

/**
 * Adapt the availability ladder's resolved windows (the same shape
 * `getWorkCenterAvailability` / `getLocationCalendarWindows` return) into the
 * two calendar callbacks `computeNeedByDates` takes. Pure — no DB access.
 *
 * - `calendarHoursPerDay`: hours in one WORKING day for that work center's
 *   calendar — per-weekday average window minutes across the horizon, then
 *   the mean over weekdays that have any minutes, floored at 1h to avoid
 *   division by zero. (A 16h two-shift center halves the day count of an 8h
 *   center for the same work content.)
 * - `workingDayTest`: true iff that work center's windows contain any minutes
 *   on that local calendar date (`timezone` decides which instants fall on
 *   which date). Zero-hour days — weekends, a center closed Fridays, downtime
 *   already subtracted from the windows — test false.
 * - `locationWindows` serve ops with a null work center AND any work center
 *   id missing from the map (same fallback the placement ladder uses).
 */
export function calendarAdapters(
  windowsByWorkCenter: Map<string, CalendarWindow[]>,
  locationWindows: CalendarWindow[],
  timezone: string
): {
  calendarHoursPerDay: (workCenterId: string | null) => number;
  workingDayTest: (workCenterId: string | null, isoDate: string) => boolean;
} {
  type CalendarProfile = {
    minutesByDate: Map<string, number>;
    hoursPerDay: number;
    /**
     * Which weekdays (0=Sun..6=Sat) this calendar is open on, derived from the
     * average minutes per weekday across the covered span. The WEEKLY PATTERN
     * — not literal window presence — is what the working-day walk tests:
     * windows only cover [now, horizon], but backward targets can land at or
     * before today, and a literal per-date test reads every past day as
     * closed, walking the target years into the past (the runaway the
     * MAX_CONSECUTIVE_CLOSED_DAYS guard then compounds). The pattern extends
     * infinitely in both directions and also keeps targets invariant to
     * date-specific capacity loss (downtime), which is the demand-anchored
     * semantic the spec wants.
     */
    openWeekdays: boolean[];
  };

  const utcWeekday = (isoDate: string): number =>
    getDayOfWeek(parseDate(isoDate), "en-US");

  const buildProfile = (windows: CalendarWindow[]): CalendarProfile => {
    // Slice every window at local midnight boundaries and bucket the minutes
    // by the local calendar date they fall on (DST-correct via the tz).
    const minutesByDate = new Map<string, number>();
    for (const window of windows) {
      let cursor = window.start;
      const endMs = window.end;
      let guard = 0;
      while (cursor < endMs && guard++ < 100_000) {
        const date = businessDayFromMs(cursor, timezone);
        const nextMidnight = parseDate(date)
          .add({ days: 1 })
          .toDate(timezone)
          .getTime();
        const sliceEnd = Math.min(endMs, Math.max(nextMidnight, cursor + 1));
        minutesByDate.set(
          date,
          (minutesByDate.get(date) ?? 0) + (sliceEnd - cursor) / MINUTE_MS
        );
        cursor = sliceEnd;
      }
    }

    // Average minutes per weekday across the covered span, then the mean of
    // the weekdays that are open at all = this calendar's working-day length.
    let hoursPerDay = MIN_HOURS_PER_DAY;
    const openWeekdays = new Array<boolean>(7).fill(false);
    const dates = [...minutesByDate.keys()].sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first && last) {
      const weekdayMinutes = new Array<number>(7).fill(0);
      const weekdayCounts = new Array<number>(7).fill(0);
      let cursor = parseDate(first);
      const end = parseDate(last);
      let guard = 0;
      while (cursor.compare(end) <= 0 && guard++ < 10_000) {
        const isoDate = cursor.toString();
        const weekday = utcWeekday(isoDate);
        weekdayCounts[weekday]!++;
        weekdayMinutes[weekday]! += minutesByDate.get(isoDate) ?? 0;
        cursor = cursor.add({ days: 1 });
      }
      const openWeekdayAverages: number[] = [];
      for (let weekday = 0; weekday < 7; weekday++) {
        if (weekdayCounts[weekday]! === 0) continue;
        const average = weekdayMinutes[weekday]! / weekdayCounts[weekday]!;
        if (average > 0) {
          openWeekdayAverages.push(average);
          openWeekdays[weekday] = true;
        }
      }
      if (openWeekdayAverages.length > 0) {
        const meanMinutes =
          openWeekdayAverages.reduce((a, b) => a + b, 0) /
          openWeekdayAverages.length;
        hoursPerDay = Math.max(meanMinutes / 60, MIN_HOURS_PER_DAY);
      }
    }

    return { minutesByDate, hoursPerDay, openWeekdays };
  };

  const profiles = new Map<string, CalendarProfile>();
  const profileFor = (workCenterId: string | null): CalendarProfile => {
    const key = workCenterId ?? "";
    let profile = profiles.get(key);
    if (!profile) {
      const windows =
        workCenterId === null
          ? locationWindows
          : (windowsByWorkCenter.get(workCenterId) ?? locationWindows);
      profile = buildProfile(windows);
      profiles.set(key, profile);
    }
    return profile;
  };

  return {
    calendarHoursPerDay: (workCenterId) => profileFor(workCenterId).hoursPerDay,
    // Weekly-pattern test, NOT literal window presence — see CalendarProfile.
    workingDayTest: (workCenterId, isoDate) =>
      profileFor(workCenterId).openWeekdays[
        utcWeekday(isoDate.slice(0, 10))
      ] === true
  };
}
