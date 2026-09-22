import { fnv1a64 } from "@carbon/utils";
import {
  fromAbsolute,
  getDayOfWeek,
  type ZonedDateTime
} from "@internationalized/date";
import type { Schedule } from "./types";

/** Widest spread applied to a schedule's wall time, in seconds. */
const SPREAD_SECONDS = 300;

/** Weekday numbers are 0 = Sunday, so the locale is pinned — getDayOfWeek is locale-relative. */
const WEEKDAY_LOCALE = "en-US";

/** Searching more than this many candidates means the schedule is unsatisfiable. */
const MAX_DAY_STEPS = 8;
const MAX_MONTH_STEPS = 60;

function atWallTime(date: ZonedDateTime, schedule: Schedule): ZonedDateTime {
  return date.set(
    {
      hour: schedule.hour,
      minute: schedule.minute,
      second: 0,
      millisecond: 0
    },
    "compatible"
  );
}

/**
 * The next wall-clock occurrence of `schedule` strictly after `after`, in the schedule's zone.
 * Always recomputed from the wall clock, never by adding 24 hours to an instant — that would
 * leave every US and EU schedule an hour off after a daylight-saving change.
 */
export function nextOccurrenceAfter(schedule: Schedule, after: Date): Date {
  const afterMs = after.getTime();
  const start = atWallTime(fromAbsolute(afterMs, schedule.tz), schedule);

  if (schedule.freq === "Daily") {
    return start.toDate().getTime() > afterMs
      ? start.toDate()
      : atWallTime(start.add({ days: 1 }), schedule).toDate();
  }

  if (schedule.freq === "Weekly") {
    const weekdays = schedule.weekdays ?? [];
    let candidate = start;
    for (let step = 0; step < MAX_DAY_STEPS; step++) {
      if (
        weekdays.includes(getDayOfWeek(candidate, WEEKDAY_LOCALE)) &&
        candidate.toDate().getTime() > afterMs
      ) {
        return candidate.toDate();
      }
      candidate = atWallTime(candidate.add({ days: 1 }), schedule);
    }
    throw new Error("Weekly schedule has no satisfiable weekday");
  }

  // Monthly. A month that does not contain the chosen day is SKIPPED, never clamped:
  // clamping would silently turn a "31st" schedule into a "last day of month" schedule.
  let month = atWallTime(start.set({ day: 1 }), schedule);
  for (let step = 0; step < MAX_MONTH_STEPS; step++) {
    const daysInMonth = month.calendar.getDaysInMonth(month);
    const target = schedule.day === "last" ? daysInMonth : (schedule.day ?? 1);
    if (target <= daysInMonth) {
      const occurrence = atWallTime(month.set({ day: target }), schedule);
      if (occurrence.toDate().getTime() > afterMs) return occurrence.toDate();
    }
    month = atWallTime(month.add({ months: 1 }).set({ day: 1 }), schedule);
  }
  throw new Error("Monthly schedule has no satisfiable day");
}

/**
 * A stable 0–299 second offset per workflow. Customers pick round times, so hundreds of
 * schedules land on exactly 9:00; spreading them is what the disclosed lateness buys us.
 * `fnv1a64` returns hex, so no BigInt literal is needed — this package compiles at ES2019.
 */
export function scheduleOffsetSeconds(workflowId: string): number {
  return parseInt(fnv1a64(workflowId).slice(-6), 16) % SPREAD_SECONDS;
}

/** `nextOccurrenceAfter` with the spread applied. This is what writes `workflow.nextRunAt`. */
export function nextRunAfter(
  schedule: Schedule,
  workflowId: string,
  after: Date
): Date {
  const offsetMs = scheduleOffsetSeconds(workflowId) * 1000;
  const base = nextOccurrenceAfter(
    schedule,
    new Date(after.getTime() - offsetMs)
  );
  return new Date(base.getTime() + offsetMs);
}
