import {
  type LadderShiftRow,
  resolveLocationWindows,
  subtractIntervals
} from "@carbon/ee/planning";

/** The `shift` rows returned by getShiftsWithTimes (weekday flags + times). */
type ShiftRow = {
  startTime: string | null;
  endTime: string | null;
  monday: boolean | null;
  tuesday: boolean | null;
  wednesday: boolean | null;
  thursday: boolean | null;
  friday: boolean | null;
  saturday: boolean | null;
  sunday: boolean | null;
};

// dayOfWeek 0 = Sunday .. 6 = Saturday — the ladder's convention, matching the
// scheduler's own location-shift mapping (master-data-provider.expandShiftDays).
const WEEKDAY_FLAGS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

/**
 * Non-working intervals inside [windowStartMs, windowEndMs) for the forecast
 * board's shading — the complement of the plant's operating hours. Uses the
 * SAME availability ladder the scheduler uses (the location's shifts if any,
 * else the stock Mon–Fri 08:00–16:00 week in the plant timezone), so the bars
 * and the shaded background can never disagree. Location-level, not
 * per-work-center: one plant calendar behind every lane. Per-WC shifts /
 * `alwaysOn` are a deliberate follow-up (see #3b).
 */
export function getForecastNonWorkingIntervals(args: {
  timeZone: string;
  shifts: ShiftRow[];
  windowStartMs: number;
  windowEndMs: number;
}): { start: number; end: number }[] {
  const { timeZone, shifts, windowStartMs, windowEndMs } = args;

  const locationShiftRows: LadderShiftRow[] = [];
  for (const shift of shifts) {
    if (!shift.startTime || !shift.endTime) continue;
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const flag = WEEKDAY_FLAGS[dayOfWeek];
      if (!flag || !shift[flag]) continue;
      locationShiftRows.push({
        dayOfWeek,
        startTime: String(shift.startTime),
        endTime: String(shift.endTime),
        timezone: timeZone
      });
    }
  }

  const working = resolveLocationWindows({
    timezone: timeZone,
    locationShiftRows,
    rangeStart: windowStartMs,
    rangeEnd: windowEndMs
  });

  return subtractIntervals(
    [{ start: windowStartMs, end: windowEndMs }],
    working
  ).map((w) => ({ start: w.start, end: w.end }));
}
